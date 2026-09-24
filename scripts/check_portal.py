#!/usr/bin/env python3
"""Walks the customer portal as a retailer, and checks it cannot see past itself.

Two things at once. That the shop works — the catalogue, a scan of a carton
label, the cart, booking, the firm's own orders, bills and ledger. And that a
retailer's token is confined to that firm: the office's masters closed to it,
another firm's bill refused, and writes to office data refused.

    python3 scripts/check_portal.py [API_BASE] [OFFICE_USER] [OFFICE_PASS] [PORTAL_USER] [PORTAL_PASS]

It adds to a cart, so point it at a development database.
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4199"
ADMIN = (sys.argv[2] if len(sys.argv) > 2 else "admin", sys.argv[3] if len(sys.argv) > 3 else "demo123")
SHOP = (sys.argv[4] if len(sys.argv) > 4 else "sharma_wedding", sys.argv[5] if len(sys.argv) > 5 else "demo123")
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


s, r = call("POST", "/api/auth/login", {"username": ADMIN[0], "password": ADMIN[1]})
A = r["accessToken"]
s, r = call("POST", "/api/auth/login", {"username": SHOP[0], "password": SHOP[1], "kind": "customer"})
ck("a retailer can sign in", s == 200 and r.get("user", {}).get("role") == "CUSTOMER", r)
if s != 200:
    print("cannot continue without a portal login"); sys.exit(2)
C = r["accessToken"]
firm = r["user"]["customerId"]

# ── The shop works ─────────────────────────────────────────────────────────
s, me = call("GET", "/api/portal/me", tok=C)
ck("the shop loads its own firm", s == 200 and me["firm"]["id"] == firm, me.get("firm", {}).get("id"))
ck("only the lines that firm deals in", all(l["id"] in me["firm"]["linesEnabled"] for l in me["lines"]), me["firm"]["linesEnabled"])
s, home = call("GET", "/api/portal/home", tok=C)
ck("the home screen loads", s == 200, home if s != 200 else "")
s, cat = call("GET", f"/api/portal/catalogue?line={me['lines'][0]['id']}", tok=C)
items = cat if isinstance(cat, list) else cat.get("items", [])
ck("the catalogue has cards in it", s == 200 and len(items) > 0, len(items))
ck("every card is priced for this firm", all(i.get("rate", 0) > 0 for i in items[:5]), [i.get("rate") for i in items[:5]])
# The shop is told whether it can book, never how many are on the shelf — a
# retailer has no business knowing the godown's exact position.
ck("the shop sees a stock band, not a godown count",
   all("available" not in i and "onHand" not in i and "godowns" not in i for i in items) and all("band" in i for i in items),
   sorted(items[0].keys()))

# ── Scanning a carton ──────────────────────────────────────────────────────
it = items[0]
s, full = call("GET", f"/api/portal/items/{it['id']}", tok=C)
ck("a card opens", s == 200, full if s != 200 else "")
s, codes = call("GET", f"/api/codes/item/{it['id']}", tok=A)   # the office reads the labels
active = [c for c in codes if c["status"] == "ACTIVE"]
replaced = [c for c in codes if c["status"] == "REPLACED"]
if active:
    code = active[0]["code"]
    s, hit = call("GET", f"/api/portal/scan?q={urllib.parse.quote(code)}", tok=C)
    ck(f"scanning the label on the carton finds it ({code})", s == 200 and any(x["id"] == it["id"] for x in hit), hit)
    s, part = call("GET", f"/api/portal/scan?q={urllib.parse.quote(code[:6])}", tok=C)
    ck("a partly-read label still finds it", s == 200 and any(x["id"] == it["id"] for x in part), part)
else:
    print("note: this item carries no code to scan")
if replaced:
    old = replaced[0]
    s, hit = call("GET", f"/api/portal/scan?q={urllib.parse.quote(old['code'])}", tok=C)
    ck("a carton still carrying a replaced label also scans", s == 200 and len(hit) > 0, hit)
    s, res = call("GET", f"/api/codes/resolve?code={urllib.parse.quote(old['code'])}", tok=A)
    ck("  and the office is told what replaced it", s == 200 and res.get("replacedBy"), res.get("replacedBy"))
s, none = call("GET", "/api/portal/scan?q=ZZZZ-NOT-A-LABEL", tok=C)
ck("an unknown label finds nothing rather than erroring", s == 200 and none == [], none)
s, one = call("GET", f"/api/portal/scan?q=__random__&line={me['lines'][0]['id']}", tok=C)
ck("the demo scan button returns a card", s == 200 and len(one) == 1, one)

# ── Cart and booking ───────────────────────────────────────────────────────
# A card the shop can actually book, by the band it is shown rather than by a
# quantity it is not.
book = next((x for x in items if x.get("band", {}).get("canBook")), None)
ck("something in the catalogue is bookable", bool(book), [x.get("band", {}).get("k") for x in items[:6]])
if book:
    s, added = call("POST", "/api/portal/cart", {"itemId": book["id"], "qty": book["moq"]}, tok=C)
    ck("a card goes into the cart", s in (200, 201), added)
    s, cart = call("GET", "/api/portal/cart", tok=C)
    ck("the cart reads back with a total", s == 200 and cart.get("count", 0) > 0 and cart.get("totals", {}).get("total", 0) > 0, cart.get("totals"))
    s, gone = call("DELETE", f"/api/portal/cart/{book['id']}", tok=C)
    ck("and a card can be taken out again", s in (200, 204), gone)

# Asking for more than there is must be refused, in the shop's own language.
short = next((x for x in items if not x.get("band", {}).get("canBook")), None)
if short:
    s, x = call("POST", "/api/portal/cart", {"itemId": short["id"], "qty": short["moq"]}, tok=C)
    ck("more than the godown holds is refused", s == 400, x)
    ck("  and the retailer is told, in the shop's own language", bool(x.get("error")), x.get("error"))
# Dropping below the minimum order empties that line rather than erroring —
# the stepper going down is not a mistake to be shouted at.
if book:
    call("POST", "/api/portal/cart", {"itemId": book["id"], "qty": book["moq"], "mode": "set"}, tok=C)
    s, x = call("POST", "/api/portal/cart", {"itemId": book["id"], "qty": 1, "mode": "set"}, tok=C)
    ck("going below the minimum order clears that line", s == 200 and not any(l["itemId"] == book["id"] for l in x.get("lines", [])), x.get("lines"))

# The promise the shop makes must be one the cart will keep: every card showing
# a Book button has to be bookable. It was not — the bands are measured against
# the line's full-set quantity, which is a different number from the item's own
# minimum order, so a card with 116 left against an MOQ of 250 invited a booking
# the cart then refused.
offered = [x for x in items if x["band"]["canBook"]]
mismatched = []
for x in offered:
    st, _ = call("POST", "/api/portal/cart", {"itemId": x["id"], "qty": x["moq"], "mode": "set"}, tok=C)
    if st != 200:
        mismatched.append(x["name"])
    call("DELETE", f"/api/portal/cart/{x['id']}", tok=C)
ck(f"every card offering Book can actually be booked ({len(offered)} checked)", not mismatched, mismatched)
shorts = [x for x in items if x["band"]["k"] == "short"]
for x in shorts:
    ck(f"a card short of its own MOQ says so rather than offering Book ({x['name'][:24]})",
       not x["band"]["canBook"] and str(x["moq"]) in x["band"]["hi"], x["band"])

s, orders = call("GET", "/api/portal/orders", tok=C)
ck("the firm sees its own orders", s == 200 and isinstance(orders, list), orders if s != 200 else len(orders))
s, acct = call("GET", "/api/portal/account", tok=C)
ck("and its own ledger", s == 200 and "gate" in acct, acct if s != 200 else "")

# ── It cannot see past itself ──────────────────────────────────────────────
print()
for p in ["/api/masters/vendors", "/api/masters/godowns", "/api/masters/pricing-groups", "/api/masters/lines"]:
    s, _ = call("GET", p, tok=C)
    ck(f"the office's {p.split('/')[-1]} are closed to a retailer", s == 403, s)
for p in ["/api/customers", "/api/items", "/api/ledger/invoices", "/api/settings", "/api/dashboard", "/api/purchases", "/api/reports/gstr1", "/api/audit-logs"]:
    s, _ = call("GET", p, tok=C)
    ck(f"{p} is closed to a retailer", s == 403, s)
s, _ = call("POST", "/api/masters/vendors", {"name": "probe"}, tok=C)
ck("a retailer cannot create office records", s == 403, s)

# Another firm's bill must not open.
s, invs = call("GET", "/api/ledger/invoices", tok=A)
other = [i for i in invs if i["customerId"] != firm]
if other:
    s, x = call("GET", f"/api/portal/invoices/{urllib.parse.quote(other[0]['no'], safe='')}", tok=C)
    ck("another firm's bill is not found", s == 404, x)
s, ords = call("GET", "/api/orders?tab=all", tok=A)
notmine = [o for o in ords["orders"] if o["customer"]["id"] != firm]
if notmine:
    s, x = call("POST", f"/api/portal/cart/reorder/{notmine[0]['id']}", {}, tok=C)
    ck("another firm's order cannot be re-ordered", s == 404, x)
# And the office cannot walk in through the portal's door.
s, x = call("GET", "/api/portal/me", tok=A)
ck("an office token is refused by the shop", s == 403, x)

print()
print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: " + ", ".join(FAILS))
sys.exit(1 if FAILS else 0)
