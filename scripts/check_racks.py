#!/usr/bin/env python3
"""Checks that a rack is written down rather than chosen from a list.

Racks began as a master you had to create in Settings before you could put
anything on one, which is ceremony at exactly the wrong moment: the man with the
carton in his hands knows it is going on rack 7 and should be able to write 7.
So whatever is typed at a receipt is accepted, and the godown learns it — a code
the firm has not used before turns up as a suggestion the next time.

"7/B" means shelf B of rack 7, and both halves are learnt.

    python3 scripts/check_racks.py [API_BASE] [USERNAME] [PASSWORD]

It posts a goods receipt, so point it at a development database.
"""
import json
import random
import sys
import time
import urllib.error
import urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4199"
USER = sys.argv[2] if len(sys.argv) > 2 else "admin"
PASS = sys.argv[3] if len(sys.argv) > 3 else "demo123"
FAILS = []


def call(m, p, body=None, tok=None):
    d = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + p, data=d, method=m, headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + tok} if tok else {})})
    try:
        with urllib.request.urlopen(r, timeout=60) as f:
            return f.status, json.loads(f.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def ck(n, c, e=""):
    print(("PASS " if c else "FAIL ") + n + (" :: " + str(e) if e and not c else ""))
    if not c:
        FAILS.append(n)


s, r = call("POST", "/api/auth/login", {"username": USER, "password": PASS})
T = r["accessToken"]
STAMP = f"{int(time.time()) % 10000}{random.randint(10, 99)}"
NEW, SHELF, AGAIN = f"Z{STAMP}", f"Z{STAMP}/B", f"Y{STAMP}"

s, gds = call("GET", "/api/masters/godowns", tok=T)
gid = gds[0]["id"]
ck("the godown has not seen this rack before", not any(r["code"] == NEW for r in gds[0]["racks"]), [r["code"] for r in gds[0]["racks"]])

s, items = call("GET", "/api/items?line=L1", tok=T)
it = items["items"][0]
s, v = call("GET", "/api/masters/vendors", tok=T)
s, po = call("POST", "/api/purchases", {
    "vendorId": v[0]["id"], "invNo": f"RACKLEARN-{STAMP}", "freight": 0, "status": "POSTED",
    "lines": [{"itemId": it["id"], "qty": 8, "rate": 10, "places": [
        {"godownId": gid, "rack": NEW, "qty": 5}, {"godownId": gid, "rack": SHELF, "qty": 3}]}],
}, tok=T)
ck("a receipt onto a rack nobody created is accepted", s == 201, po)

s, gds2 = call("GET", "/api/masters/godowns", tok=T)
g2 = next(x for x in gds2 if x["id"] == gid)
rk = [r for r in g2["racks"] if r["code"] == NEW]
ck("the godown has learnt the rack", bool(rk), [r["code"] for r in g2["racks"]])
ck("and the shelf written on it", bool(rk) and any(sr["code"] == "B" for sr in rk[0]["subRacks"]), rk[0]["subRacks"] if rk else None)

s, iv = call("GET", f"/api/items/{it['id']}", tok=T)
gs = next(x for x in iv["godowns"] if x["godownId"] == gid)
locs = {x["rack"]: x["onHand"] for x in gs["racks"]}
ck("the stock sits exactly where it was written", locs.get(NEW, 0) >= 5 and locs.get(SHELF, 0) >= 3, locs)

s, po2 = call("POST", "/api/purchases", {
    "vendorId": v[0]["id"], "invNo": f"RACKLEARN2-{STAMP}", "freight": 0, "status": "POSTED",
    "lines": [{"itemId": it["id"], "qty": 2, "rate": 10, "places": [{"godownId": gid, "rack": AGAIN, "qty": 2}]}],
}, tok=T)
ck("what it learnt is a suggestion, not a constraint", s == 201, po2)

# A rack that holds stock is still protected from being renumbered or retired.
if rk:
    s, x = call("DELETE", f"/api/masters/racks/{rk[0]['id']}", tok=T)
    ck("a rack holding stock still refuses retirement", s == 400, x)

# And the settlement still works for a supplier with no UPI id — the QR is a
# convenience, not a requirement.
s, vends = call("GET", "/api/masters/vendors", tok=T)
owed = [x for x in vends if x["outstanding"] > 500 and not x.get("upiId")]
if owed:
    s, cs = call("GET", "/api/customers", tok=T)
    c = [x for x in cs if x["gate"]["out"] > 500]
    if c:
        s, pay = call("POST", "/api/ledger/payments", {"customerId": c[0]["id"], "amount": 100, "method": "UPI", "toVendorId": owed[0]["id"]}, tok=T)
        ck("a direct settlement posts with no UPI id on the supplier", s == 201 and pay.get("settlementId"), pay)

print()
print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: " + ", ".join(FAILS))
sys.exit(1 if FAILS else 0)
