#!/usr/bin/env python3
"""Checks how a consignment leaves the building, and what the firm is told.

A transport company issues an LR. A great deal of this trade does not work that
way: the bundle is handed to the conductor of the evening bus, and the bus
number, the driver's phone, the loading time, the photographs and the estimated
arrival at the customer's own town are the consignment note. Each is required
where it is the only handle on the goods, and refused where it is not.

    python3 scripts/check_dispatch.py [API_BASE] [USERNAME] [PASSWORD]

It books and dispatches an order, so point it at a development database.
"""
import base64
import datetime
import json
import sys
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


def iso(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


s, r = call("POST", "/api/auth/login", {"username": USER, "password": PASS})
T = r["accessToken"]


def staged_order():
    """Book an order and walk it to the dispatch bay."""
    s, cards = call("GET", "/api/items?line=L1", tok=T)
    card = next(c for c in cards["items"] if c["available"] >= max(c["moq"], 50))
    q = max(card["moq"], 50)
    s, cs = call("GET", "/api/customers", tok=T)
    cust = next(c for c in cs if not c["blockReason"])
    s, o = call("POST", "/api/orders", {"customerId": cust["id"], "lines": [{"itemId": card["id"], "qty": q}], "overrideReason": "dispatch check"}, tok=T)
    oid = o["id"]
    call("POST", f"/api/orders/{oid}/approve", {"reason": "dispatch check"}, tok=T)
    call("POST", f"/api/orders/{oid}/reserve", tok=T)
    s, oo = call("GET", f"/api/orders/{oid}", tok=T)
    call("POST", f"/api/orders/{oid}/allocate", {"alloc": {l["itemId"]: l["alloc"] for l in oo["lines"]}}, tok=T)
    for to in ("PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH"):
        call("POST", f"/api/orders/{oid}/status", {"to": to}, tok=T)
    return oid, card["id"], q, cust


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
SHOT = "data:image/png;base64," + base64.b64encode(PNG).decode()

# ── A bus: the number and the driver are the only handle on the goods ──────
oid, item, qty, cust = staged_order()
s, x = call("POST", f"/api/orders/{oid}/dispatch", {"ship": {item: qty}, "mode": "BUS", "transporter": "Evening service", "driverPhone": "98290 00000"}, tok=T)
ck("a bus with no bus number is refused", s == 400, x)
s, x = call("POST", f"/api/orders/{oid}/dispatch", {"ship": {item: qty}, "mode": "BUS", "transporter": "Evening service", "busNo": "RJ 07 PA 4412"}, tok=T)
ck("a bus with no driver's phone is refused", s == 400, x)
s, x = call("POST", f"/api/orders/{oid}/dispatch", {"ship": {item: qty}, "mode": "TRANSPORT", "transporter": "Somebody", "lr": ""}, tok=T)
ck("a transporter with no LR is refused", s == 400, x)

LOADED = datetime.datetime(2026, 9, 24, 18, 30)
ARRIVES = LOADED + datetime.timedelta(hours=8)
s, d = call("POST", f"/api/orders/{oid}/dispatch", {
    "ship": {item: qty}, "mode": "BUS", "transporter": "Jodhpur–Bikaner evening",
    "busNo": "RJ 07 PA 4412", "driverPhone": "98290 00000",
    "loadedAt": LOADED.isoformat(), "arrivesAt": ARRIVES.isoformat(),
    "photos": [SHOT], "packages": 2, "freight": 250,
}, tok=T)
ck("the bus consignment is accepted", s == 200, d)

s, b = call("GET", f"/api/orders/{oid}/dispatches", tok=T)
dd = next(x for x in b["dispatches"] if x["id"] == d["dispatchId"])
ck("it is recorded as a bus", dd["mode"] == "BUS", dd["mode"])
ck("the bus number is kept", dd["busNo"] == "RJ 07 PA 4412", dd["busNo"])
ck("the driver's phone is kept", dd["driverPhone"].strip() == "98290 00000", dd["driverPhone"])
ck("the photograph is stored and given a url", len(dd["photos"]) == 1 and dd["photos"][0].startswith(("/api/uploads/", "https://")), dd["photos"])
# The clock, not the calendar: eight hours is eight hours whatever the timezone.
ck("the estimated arrival is eight hours after loading",
   (iso(dd["arrivesAt"]) - iso(dd["loadedAt"])).total_seconds() == 8 * 3600,
   f"{dd['loadedAt']} -> {dd['arrivesAt']}")
ck("the destination travels with the consignment", bool(b["customer"].get("tehsil")), b["customer"])
ck("the firm's numbers come with it, to send to", isinstance(b["customer"]["contacts"], list), b["customer"].get("contacts"))
ck("a bill was raised", bool(dd["invoiceNo"]), dd)
ck("nothing has been sent yet", dd["sentCount"] == 0, dd["sentCount"])

phone = (b["customer"]["contacts"][0]["phone"] if b["customer"]["contacts"] else b["customer"]["phone"])
s, sh = call("POST", f"/api/orders/{oid}/dispatch/{dd['id']}/share", {"channel": "WHATSAPP", "toName": "Owner", "toPhone": phone}, tok=T)
ck("sending it is recorded", s == 201, sh)
s, b2 = call("GET", f"/api/orders/{oid}/dispatches", tok=T)
dd2 = next(x for x in b2["dispatches"] if x["id"] == d["dispatchId"])
ck("and counted against the consignment", dd2["sentCount"] == 1 and dd2["lastSent"], dd2)

s, oo = call("GET", f"/api/orders/{oid}", tok=T)
ck("the order's history says how it went", any("bus RJ 07 PA 4412" in (e["why"] or "") for e in oo["events"]), [e["why"] for e in oo["events"]])

# ── A transporter: an LR and no bus fields ─────────────────────────────────
oid2, item2, qty2, _ = staged_order()
s, d2 = call("POST", f"/api/orders/{oid2}/dispatch", {"ship": {item2: qty2}, "mode": "TRANSPORT", "transporter": "Rajasthan Roadways Cargo", "lr": "LR-55021", "packages": 1, "freight": 400}, tok=T)
ck("a transporter consignment is accepted", s == 200, d2)
s, b3 = call("GET", f"/api/orders/{oid2}/dispatches", tok=T)
d3 = next(x for x in b3["dispatches"] if x["id"] == d2["dispatchId"])
ck("it is recorded as transport", d3["mode"] == "TRANSPORT", d3["mode"])
ck("with its LR and no bus number", d3["lr"] == "LR-55021" and not d3["busNo"], d3)
ck("an arrival time is optional", d3["arrivesAt"] is None, d3["arrivesAt"])

print()
print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: " + ", ".join(FAILS))
sys.exit(1 if FAILS else 0)
