#!/usr/bin/env python3
"""Independent arithmetic check of the money path, end to end.

Books an order at a rate that carries paise, dispatches it, and checks the
invoice the system raised against the rule rather than against itself — the
slab, the multiplier, the tax split and the ledger, each recomputed here in
Python and compared.

It exists because rounding is the kind of fault that passes every unit test and
still bills the wrong number: ₹13.20 quietly becoming ₹13 is invisible on one
card and two thousand rupees on a carton of ten thousand.

    python3 scripts/check_money.py [API_BASE] [USERNAME] [PASSWORD]

Defaults to http://localhost:4199 and the seeded admin. Safe to run against a
development database; it writes an order, so do not point it at production.
"""
import json, math, sys, urllib.error, urllib.parse, urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4199"
USER = sys.argv[2] if len(sys.argv) > 2 else "admin"
PASS = sys.argv[3] if len(sys.argv) > 3 else "demo123"
HOME_STATE = "08"

FAILS = []


def call(method, path, body=None, tok=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": "Bearer " + tok} if tok else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def ck(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" :: {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# JavaScript's Math.round takes halves upward; Python's round() is banker's.
# Reimplementing the engine's arithmetic means reimplementing that too, or the
# check disagrees with the code over .5 and blames the code.
def paise(n):
    return math.floor(n * 100 + 0.5) / 100


def tax_of(gstin, taxable, pct):
    inter = bool(gstin) and gstin[:2] != HOME_STATE
    total = paise(taxable * pct / 100)
    if inter:
        return {"cgst": 0.0, "sgst": 0.0, "igst": total}
    half = paise(total / 2)
    return {"cgst": half, "sgst": paise(total - half), "igst": 0.0}


st, r = call("POST", "/api/auth/login", {"username": USER, "password": PASS})
if st != 200:
    print("Could not sign in:", r)
    sys.exit(2)
TOK = r["accessToken"]

# An item whose rates deliberately do not land on whole rupees.
st, item = call("POST", "/api/items", {
    "lineId": "L1", "name": "Money check card", "nameHi": "", "attrs": {},
    "uom": "PCS", "perPack": 1, "moq": 50, "landedCost": 12.5, "hsn": "4817", "gstPct": 12,
    "batchTracked": False,
    "slabs": [{"fromQty": 1, "toQty": 499, "rate": 13.2},
              {"fromQty": 500, "toQty": 10 ** 9, "rate": 11.75}],
}, tok=TOK)
ck("item created", st == 201, item)
ck("landed cost keeps paise", abs(item["landedCost"] - 12.5) < 1e-9, item.get("landedCost"))
ck("slab keeps paise", abs(item["slabs"][0]["rate"] - 13.2) < 1e-9, item.get("slabs"))

st, godowns = call("GET", "/api/masters/godowns", tok=TOK)
gid = godowns[0]["id"]
st, vendors = call("GET", "/api/masters/vendors", tok=TOK)
QTY = 600
st, po = call("POST", "/api/purchases", {
    "vendorId": vendors[0]["id"], "invNo": "MONEYCHECK", "freight": 0, "status": "POSTED",
    "lines": [{"itemId": item["id"], "qty": QTY, "rate": 12.5,
               "places": [{"godownId": gid, "rack": "", "qty": QTY}]}],
}, tok=TOK)
ck("stock received", st == 201, po)

st, custs = call("GET", "/api/customers", tok=TOK)
cust = next((c for c in custs if not c["blockReason"] and c["gateMode"] != "BLOCK"), custs[0])
st, groups = call("GET", "/api/masters/pricing-groups", tok=TOK)
mult = next(g["multiplier"] for g in groups if g["name"] == cust["group"])

# The rule: slab for the quantity, times the group multiplier, to the paisa.
expected_rate = paise(11.75 * mult)
st, quote = call("POST", "/api/orders/quote",
                 {"customerId": cust["id"], "lines": [{"itemId": item["id"], "qty": QTY}]}, tok=TOK)
ck("quoted rate matches the rule",
   abs(quote["lines"][0]["rate"] - expected_rate) < 0.005,
   f"api {quote['lines'][0]['rate']} vs rule {expected_rate} (11.75 x {mult})")

expected_amount = paise(expected_rate * QTY)
t = tax_of(cust["gstin"], expected_amount, 12)
expected_total = paise(expected_amount + t["cgst"] + t["sgst"] + t["igst"])
ck("quoted total matches the rule",
   abs(quote["totals"]["total"] - expected_total) < 0.05,
   f"api {quote['totals']['total']} vs rule {expected_total}")

st, order = call("POST", "/api/orders",
                 {"customerId": cust["id"], "lines": [{"itemId": item["id"], "qty": QTY}],
                  "overrideReason": "Money-path check"}, tok=TOK)
ck("order booked", st == 201, order)
if st == 201:
    oid = order["id"]
    # The reason travels with the approval too: this firm may be over its
    # limit, and a gate that needs a reason is the system working.
    call("POST", f"/api/orders/{oid}/approve", {"reason": "Money-path check"}, tok=TOK)
    call("POST", f"/api/orders/{oid}/reserve", tok=TOK)
    st, o = call("GET", f"/api/orders/{oid}", tok=TOK)
    call("POST", f"/api/orders/{oid}/allocate", {"alloc": {l["itemId"]: l["alloc"] for l in o["lines"]}}, tok=TOK)
    for to in ("PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH"):
        call("POST", f"/api/orders/{oid}/status", {"to": to}, tok=TOK)
    st, disp = call("POST", f"/api/orders/{oid}/dispatch", {
        "ship": {item["id"]: QTY}, "mode": "TRANSPORT", "transporter": "Check Cargo",
        "lr": "LR-CHECK", "packages": 1, "freight": 0,
    }, tok=TOK)
    ck("dispatched and invoiced", st == 200, disp)
    if st == 200:
        ck("invoice total matches the rule",
           abs(disp["total"] - expected_total) < 0.05,
           f"api {disp['total']} vs rule {expected_total}")
        st, inv = call("GET", f"/api/orders/{oid}/invoice/{urllib.parse.quote(disp['invoiceNo'], safe='')}", tok=TOK)
        ck("invoice line keeps the paise rate",
           abs(inv["lines"][0]["rate"] - expected_rate) < 0.005,
           f"api {inv['lines'][0]['rate']} vs rule {expected_rate}")
        ck("invoice tax split matches the rule",
           abs(inv["cgst"] - t["cgst"]) < 0.05 and abs(inv["sgst"] - t["sgst"]) < 0.05 and abs(inv["igst"] - t["igst"]) < 0.05,
           f"api {inv['cgst']}/{inv['sgst']}/{inv['igst']} vs rule {t}")
        st, fin = call("GET", f"/api/ledger/customers/{cust['id']}", tok=TOK)
        entry = next((e for e in fin["statement"] if e["ref"] == disp["invoiceNo"]), None)
        ck("ledger debited the invoice total",
           entry is not None and abs(entry["debit"] - expected_total) < 0.05,
           entry)

print()
print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: " + ", ".join(FAILS))
sys.exit(1 if FAILS else 0)
