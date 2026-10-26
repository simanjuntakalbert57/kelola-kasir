"""Schemathesis hooks: authenticate every operation according to its OpenAPI `security`."""

import json
import os

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


@schemathesis.hook
def before_call(context, case, **kwargs):
    operation_id = context.operation.definition.raw.get("operationId")
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
