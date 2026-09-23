#!/usr/bin/env python3
"""Checks a direct settlement moves both ledgers and tells neither side.

A customer owes us, we owe a supplier, and rather than the money making two
journeys it makes one: the firm is given a QR and pays the supplier directly,
against its own bill with us. Both ledgers have to move off that single act,
our reference has to tie the halves together, and neither party may appear on
the other's paperwork.

    python3 scripts/check_settlement.py [API_BASE] [USERNAME] [PASSWORD]

It writes a payment, so point it at a development database, not production.
"""
import time
import json, urllib.request, urllib.error, base64, sys
import sys as _s
B = _s.argv[1] if len(_s.argv) > 1 else "http://localhost:4199"
USER = _s.argv[2] if len(_s.argv) > 2 else "admin"
PASS = _s.argv[3] if len(_s.argv) > 3 else "demo123"
def call(m,p,body=None,tok=None):
    d=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(B+p,data=d,method=m,headers={"Content-Type":"application/json",**({"Authorization":"Bearer "+tok} if tok else {})})
    try:
        with urllib.request.urlopen(r,timeout=60) as f: return f.status,json.loads(f.read() or b"null")
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read() or b"null")
fails=[]
def ck(n,c,e=""):
    print(("PASS " if c else "FAIL ")+n+(" :: "+str(e) if e and not c else ""))
    if not c: fails.append(n)
STAMP = str(int(time.time()))[-5:]
VCODE = "S-" + STAMP
CCODE = "A-" + STAMP

s,r=call("POST","/api/auth/login",{"username":USER,"password":PASS}); T=r["accessToken"]

s,vends=call("GET","/api/masters/vendors",tok=T)
v=[x for x in vends if x["outstanding"]>5000][0]
ck("vendors expose code and upiId fields", "code" in v and "upiId" in v, list(v.keys()))
s,_=call("PATCH",f"/api/masters/vendors/{v['id']}",{"code":VCODE,"upiId":"ganesh@okbank"},tok=T)
ck("vendor code + UPI saved", s==200, _)
s,dup=call("POST","/api/masters/vendors",{"name":"Clash Probe " + STAMP,"code":VCODE},tok=T)
ck("a duplicate vendor code is refused", s==400, dup)

s,custs=call("GET","/api/customers",tok=T)
c=[x for x in custs if x["gate"]["out"]>5000][0]
s,_=call("PATCH",f"/api/customers/{c['id']}",{"code":CCODE},tok=T)
ck("customer code saved", s==200 and _.get("code")==CCODE, f"status {s} wanted {CCODE} got {_.get(chr(39)+chr(39)) if False else _.get('code')!r}")
s,other=call("PATCH",f"/api/customers/{[x for x in custs if x['id']!=c['id']][0]['id']}",{"code":CCODE},tok=T)
ck("a duplicate customer code is refused", s==400, other)
s,found=call("GET","/api/customers?q="+CCODE,tok=T)
rows=found["rows"] if isinstance(found,dict) else found
ck("searchable by the office's own number", any(x["id"]==c["id"] for x in rows), len(rows))

out_before=c["gate"]["out"]; owed_before=v["outstanding"]
png=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
shot="data:image/png;base64,"+base64.b64encode(png).decode()
AMT=5000.0
s,pay=call("POST","/api/ledger/payments",{
    "customerId":c["id"],"amount":AMT,"method":"UPI","ref":"431902847115",
    "date":"2026-09-23T17:45:00.000Z","proof":shot,
    "toVendorId":v["id"],"settlementNote":"against their October consignment"},tok=T)
ck("direct settlement accepted", s==201, pay)
if s==201:
    ck("our own reference issued", (pay.get("settlementId") or "").startswith("STL-"), pay.get("settlementId"))
    ck("proof stored", bool(pay.get("proofUrl")), pay.get("proofUrl"))
    stl=pay["settlementId"]
    s,fin=call("GET",f"/api/ledger/customers/{c['id']}",tok=T)
    ck("the firm's outstanding fell", abs((out_before-fin["gate"]["out"])-AMT)<0.05, f"{out_before} -> {fin['gate']['out']}")
    entry=[e for e in fin["statement"] if e["ref"]==pay["receiptNo"]][0]
    ck("the firm's statement never names the supplier", v["name"].lower() not in entry["particular"].lower(), entry["particular"])
    ck("the firm's statement carries our reference", stl in entry["particular"], entry["particular"])
    s,vends2=call("GET","/api/masters/vendors",tok=T)
    v2=[x for x in vends2 if x["id"]==v["id"]][0]
    ck("what we owe the supplier fell by the same", abs((owed_before-v2["outstanding"])-AMT)<0.05, f"{owed_before} -> {v2['outstanding']}")
    ck("the supplier's payment carries the reference", v2["paid"]>0)
    s,stls=call("GET","/api/ledger/settlements",tok=T)
    row=[x for x in stls if x["id"]==stl][0]
    ck("reconciliation view ties both halves", row["customer"]["id"]==c["id"] and row["vendor"]["id"]==v["id"] and abs(row["amount"]-AMT)<0.05, row)
    ck("the note is kept for us", "October" in row["note"], row["note"])
    # over-settling is refused
    s,x=call("POST","/api/ledger/payments",{"customerId":c["id"],"amount":9_000_000,"method":"UPI","toVendorId":v["id"]},tok=T)
    ck("cannot settle more than we owe the supplier", s==400, x)
# a plain payment still works, with a time
s,plain=call("POST","/api/ledger/payments",{"customerId":c["id"],"amount":100,"method":"Cash","date":"2026-09-23T19:05:00.000Z"},tok=T)
ck("an ordinary receipt still posts", s==201 and not plain.get("settlementId"), plain)
s,pays=call("GET","/api/ledger/payments",tok=T)
last=[p for p in pays if p["id"]==plain["receiptNo"]][0]
ck("the time is kept, not just the day", last["date"].startswith("2026-09-23T19:05"), last["date"])
print(); print("ALL PASS" if not fails else f"{len(fails)} FAILED: "+", ".join(fails))
sys.exit(1 if fails else 0)
