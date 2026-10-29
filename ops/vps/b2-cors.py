#!/usr/bin/env python3
# One-off: set the CORS rule that lets the dashboard PUT presigned uploads into the private B2 media bucket
# (the B2 web UI can only create download rules). Usage: B2_APPLICATION_KEY_ID=... B2_APPLICATION_KEY=... python3 b2-cors.py
import base64, json, os, urllib.error, urllib.request
kid, key = os.environ["B2_APPLICATION_KEY_ID"], os.environ["B2_APPLICATION_KEY"]
def req(url, body=None, auth=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers={"Authorization": auth})
    try:
        return json.load(urllib.request.urlopen(r, timeout=30))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"GAGAL {e.code}: {e.read().decode()}")
a = req("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", auth="Basic " + base64.b64encode(f"{kid}:{key}".encode()).decode())
api, tok, acct = a["apiInfo"]["storageApi"]["apiUrl"], a["authorizationToken"], a["accountId"]
call = lambda name, body: req(f"{api}/b2api/v3/{name}", body, tok)
buckets = call("b2_list_buckets", {"accountId": acct, "bucketName": "kelola-kasir-media"})["buckets"]
if not buckets: raise SystemExit("GAGAL: bucket kelola-kasir-media tidak terlihat oleh key ini")
r = call("b2_update_bucket", {"accountId": acct, "bucketId": buckets[0]["bucketId"], "corsRules": [{
    "corsRuleName": "dashboardUpload", "allowedOrigins": ["https://kelola-kasir.pages.dev"],
    "allowedOperations": ["s3_put"], "allowedHeaders": ["content-type"], "maxAgeSeconds": 3600}]})
print("BERHASIL:", r["bucketType"], json.dumps(r["corsRules"]))
