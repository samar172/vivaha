#!/usr/bin/env python3
"""Checks printing is billed with the cards it was taken alongside.

A wedding order is rarely only cards: the names are handed over at the same
counter. So a job linked to an order goes onto that order's bill when it is
dispatched — one bill for the visit — at the process item's own GST rate, since
printing is a service and is not always taxed as the card is.

Also checks the other road: adding printing to a bill that has already gone out
is an amendment, not an edit, so the number stands, the trail records it and the
ledger is corrected by a fresh entry.

    python3 scripts/check_job_billing.py [API_BASE] [USERNAME] [PASSWORD]

It books, dispatches and bills, so point it at a development database.
"""
import datetime
import json
import sys
import urllib.error
import urllib.parse
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
if s != 200:
    print("Could not sign in:", r); sys.exit(2)
T = r["accessToken"]

s, lines = call("GET", "/api/masters/lines", tok=T)
jobline = next((l for l in lines if l["workflow"] == "JOBWORK"), None)
ck("a job-work line exists to print with", bool(jobline), [l["code"] for l in lines])
s, procs = call("GET", f"/api/items?line={jobline['id']}", tok=T)
proc = next((p for p in procs["items"] if p["slabs"]), None)
ck("a process is on file", bool(proc))

s, cards = call("GET", "/api/items?line=L1", tok=T)
# The MOQ is the system working, so respect it rather than fight it.
card = next(c for c in cards["items"] if c["available"] >= max(c["moq"], 50))
s, custs = call("GET", "/api/customers", tok=T)
cust = next(c for c in custs if not c["blockReason"])

QTY = 0  # set from the card below
QTY = max(card["moq"], 50)
s, order = call("POST", "/api/orders", {"customerId": cust["id"], "lines": [{"itemId": card["id"], "qty": QTY}], "overrideReason": "job billing check"}, tok=T)
ck("order booked", s == 201, order)
oid = order["id"]

QUOTE = 4500.0
s, job = call("POST", "/api/jobs", {
    "customerId": cust["id"], "baseItemId": card["id"], "processItemId": proc["id"],
    "qty": QTY, "requiredBy": (datetime.datetime.now() + datetime.timedelta(days=20)).isoformat(),
    "text": "Chi. Aakash weds Sau. Kau. Priya", "quote": QUOTE, "orderId": oid,
}, tok=T)
ck("printing raised against that order", s == 201 and job.get("order", {}) and job["order"]["id"] == oid, job.get("order"))

# A quote nobody has agreed to must not reach a bill.
call("POST", f"/api/orders/{oid}/approve", {"reason": "job billing check"}, tok=T)
call("POST", f"/api/orders/{oid}/reserve", tok=T)
s, o = call("GET", f"/api/orders/{oid}", tok=T)
call("POST", f"/api/orders/{oid}/allocate", {"alloc": {l["itemId"]: l["alloc"] for l in o["lines"]}}, tok=T)
for to in ("PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH"):
    call("POST", f"/api/orders/{oid}/status", {"to": to}, tok=T)

s, disp = call("POST", f"/api/orders/{oid}/dispatch", {"ship": {card["id"]: QTY}, "mode": "TRANSPORT", "transporter": "Check", "lr": "LR-JOB", "freight": 0}, tok=T)
ck("dispatched", s == 200, disp)
q = urllib.parse.quote(disp["invoiceNo"], safe="")
s, inv = call("GET", f"/api/orders/{oid}/invoice/{q}", tok=T)
job_lines = [l for l in inv["lines"] if l.get("jobId")]
ck("a job still at QUOTED stays off the bill", not job_lines, job_lines)

# Accept it, then put it on the bill that has already gone out.
call("POST", f"/api/jobs/{job['id']}/status", {"to": "ACCEPTED"}, tok=T)
s, billed = call("POST", f"/api/jobs/{job['id']}/bill", {}, tok=T)
ck("accepted printing can be added to the bill", s == 200, billed)
if s == 200:
    ck("the bill's number did not change", billed["invoiceNo"] == disp["invoiceNo"], billed)
    ck("the total went up by the quote plus its tax", billed["delta"] > QUOTE, f"delta {billed['delta']} on a quote of {QUOTE}")
    s, inv2 = call("GET", f"/api/orders/{oid}/invoice/{q}", tok=T)
    jl = [l for l in inv2["lines"] if l.get("jobId")]
    ck("the printing is a line on the bill", len(jl) == 1 and abs(jl[0]["amount"] - QUOTE) < 0.02, jl)
    ck("it is marked as printing, not goods", jl and jl[0]["jobId"] == job["id"], jl)
    ck("it is taxed at the process's own rate", jl and jl[0]["gstPct"] == proc["gstPct"], f"{jl[0]['gstPct'] if jl else '?'} vs {proc['gstPct']}")
    ck("the amendment trail records it", len(inv2["amendments"]) >= 1, len(inv2.get("amendments", [])))
    s, fin = call("GET", f"/api/ledger/customers/{cust['id']}", tok=T)
    add = [e for e in fin["statement"] if e["ref"] == disp["invoiceNo"] and job["id"] in e["particular"]]
    ck("the ledger carries the difference as its own entry", add and abs(add[0]["debit"] - billed["delta"]) < 0.05, add)
    s, again = call("POST", f"/api/jobs/{job['id']}/bill", {}, tok=T)
    ck("it cannot be billed twice", again is not None and s == 400, again)
    # Correcting that bill must not apply the godown rule to the printing line.
    s, am = call("POST", f"/api/ledger/invoices/{q}/amend", {
        "lines": [{"id": jl[0]["id"], "qty": jl[0]["qty"], "rate": jl[0]["rate"] - 1}],
        "reason": "Printing rate agreed lower",
    }, tok=T)
    ck("a printing line can be corrected without a godown behind it", s == 200, am)


# ── The ordinary road: accepted before the cards go, billed with them ───────
print()
s, card2s = call("GET", "/api/items?line=L1", tok=T)
card2 = next(c for c in card2s["items"] if c["available"] >= max(c["moq"], 50))
Q2 = max(card2["moq"], 50)
s, o2 = call("POST", "/api/orders", {"customerId": cust["id"], "lines": [{"itemId": card2["id"], "qty": Q2}], "overrideReason": "job billing check 2"}, tok=T)
ck("second order booked", s == 201, o2)
oid2 = o2["id"]
QUOTE2 = 3300.0
s, job2 = call("POST", "/api/jobs", {
    "customerId": cust["id"], "baseItemId": card2["id"], "processItemId": proc["id"],
    "qty": Q2, "requiredBy": (datetime.datetime.now() + datetime.timedelta(days=20)).isoformat(),
    "text": "Second run", "quote": QUOTE2, "orderId": oid2,
}, tok=T)
ck("printing raised with it", s == 201, job2)
call("POST", f"/api/jobs/{job2['id']}/status", {"to": "ACCEPTED"}, tok=T)

call("POST", f"/api/orders/{oid2}/approve", {"reason": "check"}, tok=T)
call("POST", f"/api/orders/{oid2}/reserve", tok=T)
s, oo = call("GET", f"/api/orders/{oid2}", tok=T)
call("POST", f"/api/orders/{oid2}/allocate", {"alloc": {l["itemId"]: l["alloc"] for l in oo["lines"]}}, tok=T)
for to in ("PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH"):
    call("POST", f"/api/orders/{oid2}/status", {"to": to}, tok=T)
s, d2 = call("POST", f"/api/orders/{oid2}/dispatch", {"ship": {card2["id"]: Q2}, "mode": "TRANSPORT", "transporter": "Check", "lr": "LR-JOB2", "freight": 0}, tok=T)
ck("dispatched with the printing outstanding", s == 200, d2)
if s == 200:
    q2 = urllib.parse.quote(d2["invoiceNo"], safe="")
    s, inv3 = call("GET", f"/api/orders/{oid2}/invoice/{q2}", tok=T)
    jl2 = [l for l in inv3["lines"] if l.get("jobId") == job2["id"]]
    ck("the printing is on the bill without anybody adding it", len(jl2) == 1, [l["sku"] for l in inv3["lines"]])
    ck("at the agreed quote", jl2 and abs(jl2[0]["amount"] - QUOTE2) < 0.02, jl2)
    ck("one bill carries cards and printing together", len(inv3["lines"]) >= 2, len(inv3["lines"]))
    # The tax is rate-wise, so a mixed bill has a block per rate.
    rates = {l["gstPct"] for l in inv3["lines"]}
    ck("the bill is taxed rate-wise across both", len(inv3["blocks"]) == len(rates), f"{len(inv3['blocks'])} blocks for rates {rates}")
    s, jj = call("GET", f"/api/jobs/{job2['id']}", tok=T)
    ck("the job knows which bill it went on", jj["invoice"] and jj["invoice"]["no"] == d2["invoiceNo"], jj.get("invoice"))
    s, again2 = call("POST", f"/api/jobs/{job2['id']}/bill", {}, tok=T)
    ck("and cannot then be billed again", s == 400, again2)

print()
print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: " + ", ".join(FAILS))
sys.exit(1 if FAILS else 0)
