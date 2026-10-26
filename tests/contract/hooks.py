"""Schemathesis hooks: authenticate every operation according to its OpenAPI `security`."""

import itertools
import json
import os
import uuid
from datetime import datetime, timezone

import requests
import schemathesis

with open(os.environ["CONTRACT_SESSION_FILE"], encoding="utf-8") as fh:
    SESSION = json.load(fh)

BASE_URL = SESSION["base_url"]
_employee_token = {"value": SESSION["employee_token"]}


def _employee_login():
    res = requests.post(
        f"{BASE_URL}/auth/pin-login",
        json={"employee_id": SESSION["employee_id"], "pin": SESSION["employee_pin"]},
        headers={"X-Device-Token": SESSION["device_token"]},
        timeout=10,
    )
    res.raise_for_status()
    return res.json()["access_token"]


def _owner_refresh_cookie():
    res = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": SESSION["owner_email"], "password": SESSION["owner_password"]},
        timeout=10,
    )
    res.raise_for_status()
    return res.cookies["kk_refresh"]


_calls = {}
_sale_seq = itertools.count(100)


def _owner_headers():
    return {"Authorization": f"Bearer {SESSION['owner_token']}"}


def _employee_headers():
    return {
        "Authorization": f"Bearer {_employee_token['value']}",
        "X-Device-Token": SESSION["device_token"],
    }


def _post(path, headers, body):
    res = requests.post(f"{BASE_URL}{path}", json=body, headers=headers, timeout=10)
    res.raise_for_status()
    return res.json()


def _fresh_category():
    return _post("/categories", _owner_headers(), {"name": f"Fuzz {uuid.uuid4().hex[:8]}"})["id"]


def _fresh_product():
    return _post(
        "/products",
        _owner_headers(),
        {"category_id": SESSION["category_id"], "name": f"Fuzz {uuid.uuid4().hex[:8]}", "price": 5000},
    )["id"]


def _fresh_qris_payment():
    """A pending QRIS payment that confirm/cancel may consume."""
    total = 15000
    body = {
        "id": str(uuid.uuid4()),
        "shift_id": SESSION["shift_id"],
        "number": f"{SESSION['outlet_code']}-{SESSION['device_code']}-261026-{next(_sale_seq):04d}",
        "client_created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "items": [
            {
                "id": str(uuid.uuid4()),
                "product_id": SESSION["sale_product_id"],
                "product_name": SESSION["sale_product_name"],
                "unit_price": total,
                "quantity": 1,
                "line_total": total,
            }
        ],
        "subtotal": total,
        "discount_amount": 0,
        "tax_amount": 0,
        "total": total,
        "payment": {"id": str(uuid.uuid4()), "method": "qris"},
    }
    res = requests.post(f"{BASE_URL}/transactions", json=body, headers=_employee_headers(), timeout=10)
    if res.status_code == 503:
        # A fuzzed PATCH /settings may have cleared the shop's QRIS payload; restore it and retry.
        restore = requests.patch(
            f"{BASE_URL}/settings",
            json={"qris_static_payload": SESSION["qris_payload"]},
            headers=_owner_headers(),
            timeout=10,
        )
        restore.raise_for_status()
        res = requests.post(f"{BASE_URL}/transactions", json=body, headers=_employee_headers(), timeout=10)
    res.raise_for_status()
    return res.json()["payments"][0]["id"]


# Purely random ids always 404, so path-parameter operations would never reach their logic. Every other
# call of such an operation gets a real resource (a fresh one where the call consumes it).
_REAL_IDS = {
    ("getTransaction", "transaction_id"): lambda: SESSION["transaction_id"],
    ("getReceipt", "transaction_id"): lambda: SESSION["transaction_id"],
    ("getPayment", "payment_id"): lambda: SESSION["qris_payment_id"],
    ("confirmPayment", "payment_id"): _fresh_qris_payment,
    ("cancelPayment", "payment_id"): _fresh_qris_payment,
    ("getProduct", "product_id"): lambda: SESSION["product_id"],
    ("updateProduct", "product_id"): lambda: SESSION["product_id"],
    ("setProductAvailability", "product_id"): lambda: SESSION["product_id"],
    ("deleteProduct", "product_id"): _fresh_product,
    ("updateCategory", "category_id"): lambda: SESSION["category_id"],
    ("deleteCategory", "category_id"): _fresh_category,
    ("getShiftSummary", "shift_id"): lambda: SESSION["shift_id"],
}


def _use_real_resource(operation_id, case):
    if _employee_token.get("stale"):
        _employee_token["value"] = _employee_login()
        _employee_token["stale"] = False
    count = _calls[operation_id] = _calls.get(operation_id, 0) + 1
    if count % 2:
        return
    params = case.path_parameters or {}
    for (op, name), factory in _REAL_IDS.items():
        if op == operation_id and name in params:
            params[name] = factory()
    case.path_parameters = params


@schemathesis.hook
def before_call(context, case, **kwargs):
    operation_id = context.operation.definition.raw.get("operationId")
    _use_real_resource(operation_id, case)
    security = context.operation.definition.raw.get("security") or []
    schemes = set()
    for requirement in security:
        schemes.update(requirement.keys())
    headers = case.headers or {}
    # Negative tests may deliberately break auth headers; only fill in what the generator left out.
    if "ownerAuth" in schemes:
        headers.setdefault("Authorization", f"Bearer {SESSION['owner_token']}")
    if "employeeAuth" in schemes:
        # pin-logout revokes the employee session, so every later employee call needs a fresh one.
        if _employee_token.get("stale"):
            _employee_token["value"] = _employee_login()
            _employee_token["stale"] = False
        headers.setdefault("Authorization", f"Bearer {_employee_token['value']}")
        headers.setdefault("X-Device-Token", SESSION["device_token"])
    if "deviceAuth" in schemes:
        headers.setdefault("X-Device-Token", SESSION["device_token"])
    if operation_id == "employeePinLogout":
        _employee_token["stale"] = True
    if operation_id == "ownerRefresh":
        # The refresh token is an HttpOnly cookie that rotates on use.
        headers.setdefault("Cookie", f"kk_refresh={_owner_refresh_cookie()}")
    case.headers = headers


# Error responses every operation may return (ADR: errors are application/problem+json). The draft spec
# does not list them on each operation yet, so they are added here in memory; each one is still
# validated against the Problem schema. Remove an entry once the spec documents it everywhere.
DEFAULT_ERROR_RESPONSES = {
    "400": "BadRequest",
    "401": "Unauthorized",
    "403": "Forbidden",
    "404": "NotFound",
}


@schemathesis.hook
def before_load_schema(context, raw_schema):
    components = raw_schema.get("components", {}).get("responses", {})
    for item in raw_schema.get("paths", {}).values():
        for method, operation in item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            responses = operation.setdefault("responses", {})
            for status, name in DEFAULT_ERROR_RESPONSES.items():
                if status not in responses and name in components:
                    responses[status] = {"$ref": f"#/components/responses/{name}"}
