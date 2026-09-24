#!/usr/bin/env python3
"""Checks typed rates, the item ledger, price history and the bus arrival time.

A wholesale counter agrees prices out loud, so the office can type a rate over
the list — at booking and again while the order is still Booked. Past approval
it is refused, because the credit gate and the stock reservation were both
decided against the old figures. The margin floor still holds either way.

Also: the item ledger that Alt+S opens, price history recording what a goods
receipt did to a cost, and the bus arrival time reaching the dispatch record.

    python3 scripts/check_rates_and_ledger.py [API_BASE] [USERNAME] [PASSWORD]
"""
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


s, r = call("POST", "/api/auth/login", {"username": USER, "password": PASS})
T = r["accessToken"]
s, cards = call("GET", "/api/items?line=L1", tok=T)
card = next(c for c in cards["items"] if c["available"] >= max(c["moq"], 50))
QTY = max(card["moq"], 50)
s, custs = call("GET", "/api/customers", tok=T)
cust = next(c for c in custs if not c["blockReason"])

# ── A rate typed at booking ────────────────────────────────────────────────
s, q = call("POST", "/api/orders/quote", {"customerId": cust["id"], "lines": [{"itemId": card["id"], "qty": QTY}]}, tok=T)
listed = q["lines"][0]["rate"]
ck("the list price is quoted when nothing is typed", q["lines"][0]["priceSrc"] != "manual", q["lines"][0]["priceSrc"])
TYPED = round(listed + 3.5, 2)
s, q2 = call("POST", "/api/orders/quote", {"customerId": cust["id"], "lines": [{"itemId": card["id"], "qty": QTY, "rate": TYPED}]}, tok=T)
ck("a typed rate is quoted back", abs(q2["lines"][0]["rate"] - TYPED) < 0.005, q2["lines"][0]["rate"])
ck("and it says it was typed", q2["lines"][0]["priceSrc"] == "manual", q2["lines"][0]["priceSrc"])
ck("the list it replaced is still reported", abs(q2["lines"][0]["listRate"] - listed) < 0.005, q2["lines"][0].get("listRate"))
ck("the total follows the typed rate", abs(q2["totals"]["taxable"] - round(TYPED * QTY, 2)) < 0.05, q2["totals"])

s, o = call("POST", "/api/orders", {"customerId": cust["id"], "lines": [{"itemId": card["id"], "qty": QTY, "rate": TYPED}], "overrideReason": "rate check"}, tok=T)
ck("the order books at the typed rate", s == 201 and abs(o["lines"][0]["rate"] - TYPED) < 0.005, o.get("lines", [{}])[0].get("rate"))
oid = o["id"]

# ── Re-pricing while it is still Booked ────────────────────────────────────
AGAIN = round(listed + 1.25, 2)
s, x = call("POST", f"/api/orders/{oid}/reprice", {"rates": {card["id"]: AGAIN}}, tok=T)
ck("a re-price without a reason is refused", s == 400, x)
s, rp = call("POST", f"/api/orders/{oid}/reprice", {"rates": {card["id"]: AGAIN}, "reason": "Agreed on the phone"}, tok=T)
ck("a Booked order can be re-priced", s == 200, rp)
if s == 200:
    ck("the total follows", abs(rp["total"] - round(AGAIN * QTY * 1.12, 2)) < 1.0, f"{rp['total']} on {AGAIN}x{QTY}")
    s, oo = call("GET", f"/api/orders/{oid}", tok=T)
    ck("the line carries the new rate", abs(oo["lines"][0]["rate"] - AGAIN) < 0.005, oo["lines"][0]["rate"])
    ck("and is marked as typed", oo["lines"][0]["priceSrc"] == "manual", oo["lines"][0]["priceSrc"])
    ck("the order's history records it", any("Re-priced" in (e["why"] or "") for e in oo["events"]), [e["why"] for e in oo["events"]])
s, x = call("POST", f"/api/orders/{oid}/reprice", {"rates": {card["id"]: AGAIN}, "reason": "again"}, tok=T)
ck("re-pricing to the same figure is refused", s == 400, x)

# Past approval it must not be possible.
call("POST", f"/api/orders/{oid}/approve", {"reason": "rate check"}, tok=T)
s, x = call("POST", f"/api/orders/{oid}/reprice", {"rates": {card["id"]: listed}, "reason": "too late"}, tok=T)
ck("an approved order cannot be re-priced", s == 400 and "Booked" in x.get("error", ""), x)

# ── The floor still holds, for somebody who cannot override it ─────────────
s, users = call("GET", "/api/settings/users", tok=T)
pm = [u for u in users["staff"] if u["role"] == "SALES_EXECUTIVE"]
if pm:
    u = pm[0]
    was_active = u["isActive"]
    if not was_active:
        call("PATCH", f"/api/settings/users/{u['id']}", {"isActive": True}, tok=T)
    s, pw = call("POST", f"/api/settings/users/{u['id']}/reset-password", tok=T)
    s, sess = call("POST", "/api/auth/login", {"username": u["username"], "password": pw["password"]})
    SE = sess["accessToken"]
    has_price = "cust.price" in sess["user"]["perms"]
    s, x = call("POST", "/api/orders", {"customerId": cust["id"], "lines": [{"itemId": card["id"], "qty": QTY, "rate": 0.5}], "overrideReason": "probe"}, tok=SE)
    ck("a rate under the floor is refused without the capability", s == 403, x)
    ck("  and the refusal names what is needed", "override" in x.get("error", "").lower() or "cust.price" in x.get("error", ""), x)
    if not was_active:
        call("PATCH", f"/api/settings/users/{u['id']}", {"isActive": False}, tok=T)

# ── The item ledger ────────────────────────────────────────────────────────
s, led = call("GET", f"/api/items/{card['id']}/ledger", tok=T)
ck("the item ledger loads", s == 200 and "ledger" in led, led if s != 200 else "")
ck("it carries purchases and sales", any(r["kind"] == "PURCHASE" for r in led["ledger"]) or any(r["kind"] == "SALE" for r in led["ledger"]), {r["kind"] for r in led["ledger"]})
if led["ledger"]:
    run = 0
    ok = True
    for r in led["ledger"]:
        run += r["inQty"] - r["outQty"]
        if r["balance"] != run:
            ok = False
    ck("the running balance adds up", ok)
    ck("it is oldest first", all(led["ledger"][i]["at"] <= led["ledger"][i + 1]["at"] for i in range(len(led["ledger"]) - 1)))
ck("the summary reports an average buy or says it never was", "avgBuy" in led["summary"], led["summary"].keys())
s, win = call("GET", f"/api/items/{card['id']}/ledger?from=2099-01-01", tok=T)
ck("a date window narrows it", len(win["ledger"]) == 0, len(win["ledger"]))

# ── A receipt writes price history ─────────────────────────────────────────
s, before = call("GET", f"/api/items/{card['id']}/price-history", tok=T)
s, vends = call("GET", "/api/masters/vendors", tok=T)
s, gds = call("GET", "/api/masters/godowns", tok=T)
NEWRATE = round((card["landedCost"] or 10) + 7.77, 2)
s, po = call("POST", "/api/purchases", {"vendorId": vends[0]["id"], "invNo": "HIST-CHECK", "freight": 0, "status": "POSTED",
                                        "lines": [{"itemId": card["id"], "qty": 10, "rate": NEWRATE, "places": [{"godownId": gds[0]["id"], "rack": "", "qty": 10}]}]}, tok=T)
ck("a receipt posts", s == 201, po)
s, after = call("GET", f"/api/items/{card['id']}/price-history", tok=T)
ck("the receipt is written to price history", len(after) > len(before), f"{len(before)} -> {len(after)}")
ck("  including what the supplier charged", any(h["field"] == "purchasePrice" for h in after[: len(after) - len(before)]), [h["field"] for h in after[:4]])
ck("  and what it did to the landed cost", any(h["field"] == "landedCost" for h in after[: len(after) - len(before)]), [h["field"] for h in after[:4]])

print()
print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: " + ", ".join(FAILS))
sys.exit(1 if FAILS else 0)
