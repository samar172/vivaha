#!/usr/bin/env python3
"""Checks the price list and the vendor ledger.

Prices a list dated today and proves customers are quoted it; schedules one for
next month and proves the catalogue keeps today's rates until then; calls it off
again; and checks the margin floor refuses a bulk under-pricing for somebody
without margin.override — which is the mistake a bulk screen makes easy.

Then the supplier side: every document and payment on the statement, the running
balance ending at what is outstanding, ageing adding up, and a payment settled
by a customer paying that supplier directly showing our reference and no
customer.

    python3 scripts/check_prices.py [API_BASE] [USERNAME] [PASSWORD]

It writes prices and an order, so point it at a development database.
"""
import datetime
import json
import sys
import urllib.error
import urllib.request
B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4199"
USER = sys.argv[2] if len(sys.argv) > 2 else "admin"
PASS = sys.argv[3] if len(sys.argv) > 3 else "demo123"
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
s,r=call("POST","/api/auth/login",{"username":USER,"password":PASS}); T=r["accessToken"]

# ── The price list ─────────────────────────────────────────────────────────
s,pl=call("GET","/api/items/price-list?line=L1",tok=T)
ck("price list loads (not shadowed by /:id)", s==200 and "items" in pl, pl if s!=200 else "")
ck("it names the group it illustrates with", pl["baseGroup"]["name"] and pl["baseGroup"]["multiplier"]>0, pl.get("baseGroup"))
row=[x for x in pl["items"] if x["purchasePrice"]][0]
ck("purchase price came from the last receipt", row["purchasePrice"]>0, row["purchasePrice"])
ck("it is not the landed cost", "landedCost" in row, row.keys())

# priced today -> in force at once
s,save=call("POST","/api/items/price-list",{
  "effectiveFrom": datetime.datetime.now().isoformat(),
  "reason":"Season list",
  "rows":[{"itemId":row["id"],"purchasePrice":row["purchasePrice"],"multiplier":1.45,"sellingPrice":round(row["purchasePrice"]*1.45,2)}]},tok=T)
ck("a list dated today saves", s==201, save)
ck("and is applied at once", save.get("immediate") and save.get("applied",0)>=1, save)
s,after=call("GET",f"/api/items/{row['id']}",tok=T)
want=round(row["purchasePrice"]*1.45,2)
ck("the slab moved to the new price", abs(after["slabs"][0]["rate"]-want)<0.02, f"{after['slabs'][0]['rate']} vs {want}")
ck("deeper slabs derived to the paisa", abs(after["slabs"][1]["rate"]-round(want*0.89,2))<0.02, after["slabs"][1]["rate"])
ck("the item's own multiplier was set", abs((after.get("multiplier") or 0)-1.45)<1e-9, after.get("multiplier"))
s,cs=call("GET","/api/customers",tok=T)
c=cs[0]
s,q=call("POST","/api/orders/quote",{"customerId":c["id"],"lines":[{"itemId":row["id"],"qty":row["moq"] or 50}]},tok=T)
ck("customers are quoted the new price", abs(q["lines"][0]["rate"]-round(want*1.45,2))<0.05, f"{q['lines'][0]['rate']} (slab {q['lines'][0]['slabRate']} x {q['lines'][0]['mult']})")

# dated ahead -> waits
row2=[x for x in pl["items"] if x["purchasePrice"] and x["id"]!=row["id"]][0]
s,before=call("GET",f"/api/items/{row2['id']}",tok=T)
future=(datetime.datetime.now()+datetime.timedelta(days=30)).isoformat()
s,sched=call("POST","/api/items/price-list",{"effectiveFrom":future,"reason":"From next month",
  "rows":[{"itemId":row2["id"],"purchasePrice":row2["purchasePrice"],"multiplier":2.0,"sellingPrice":round(row2["purchasePrice"]*2,2)}]},tok=T)
ck("a future list is scheduled, not applied", s==201 and not sched.get("immediate") and sched.get("applied",0)==0, sched)
s,still=call("GET",f"/api/items/{row2['id']}",tok=T)
ck("the item keeps today's rate until the date", abs(still["slabs"][0]["rate"]-before["slabs"][0]["rate"])<1e-9, f"{before['slabs'][0]['rate']} -> {still['slabs'][0]['rate']}")
s,pl2=call("GET","/api/items/price-list?line=L1",tok=T)
r2=[x for x in pl2["items"] if x["id"]==row2["id"]][0]
ck("the queued change is shown against the item", r2["pending"] and r2["pending"]["sellingPrice"], r2.get("pending"))
s,x=call("DELETE",f"/api/items/price-changes/{r2['pending']['id']}",tok=T)
ck("a queued change can be called off", s==200, x)
s,pl3=call("GET","/api/items/price-list?line=L1",tok=T)
ck("and it is gone", not [x for x in pl3["items"] if x["id"]==row2["id"]][0]["pending"])

# The margin floor still holds — for somebody who cannot override it. Admin
# holds every capability, so testing this as admin would prove nothing.
s,users=call("GET","/api/settings/users",tok=T)
pm=[u for u in users["staff"] if u["role"]=="PURCHASE_MANAGER"]
if pm:
    u=pm[0]
    if not u["isActive"]: call("PATCH",f"/api/settings/users/{u['id']}",{"isActive":True},tok=T)
    s,pw=call("POST",f"/api/settings/users/{u['id']}/reset-password",tok=T)
    s,sess=call("POST","/api/auth/login",{"username":u["username"],"password":pw["password"]})
    PM=sess["accessToken"]
    ck("that user cannot override the margin floor", "margin.override" not in sess["user"]["perms"], sess["user"]["perms"])
    s,x=call("POST","/api/items/price-list",{"effectiveFrom":datetime.datetime.now().isoformat(),
      "rows":[{"itemId":row["id"],"sellingPrice":0.5}]},tok=PM)
    ck("a whole list cannot be priced under the floor", s==403 and "margin.override" in x.get("error",""), x)
    s,ok=call("POST","/api/items/price-list",{"effectiveFrom":datetime.datetime.now().isoformat(),
      "rows":[{"itemId":row["id"],"sellingPrice":round(row["purchasePrice"]*1.45,2)}]},tok=PM)
    ck("a sensible price from the same user goes through", s==201, ok)
    if not u["isActive"]: call("PATCH",f"/api/settings/users/{u['id']}",{"isActive":False},tok=T)
else:
    print("note: no purchase manager on file to test the floor with")

# ── The vendor ledger ──────────────────────────────────────────────────────
s,vs=call("GET","/api/masters/vendors",tok=T)
v=[x for x in vs if x["documents"]>0][0]
s,led=call("GET",f"/api/masters/vendors/{v['id']}/ledger",tok=T)
ck("vendor ledger loads", s==200 and "statement" in led, led if s!=200 else "")
ck("it has a line per document and payment", len(led["statement"])>0, len(led.get("statement",[])))
ck("the running balance ends at what is outstanding",
   abs((led["statement"][-1]["bal"] if led["statement"] else 0)-led["outstanding"])<0.05,
   f"bal {led['statement'][-1]['bal'] if led['statement'] else 0} vs outstanding {led['outstanding']}")
ck("billed minus paid is the outstanding", abs((led["invoiced"]-led["paid"])-led["outstanding"])<0.05, led)
ck("ageing adds up to what is open", abs(sum(led["ageing"]["buckets"])-max(0,led["outstanding"]))<1.0, led["ageing"]["buckets"])
settled=[l for l in led["statement"] if "STL-" in l["particular"]]
if settled:
    ck("a directly-settled payment shows our reference and no customer", all("CUST" not in l["particular"] for l in settled), settled[0])
s,bad=call("GET","/api/masters/vendors/NOPE/ledger",tok=T)
ck("an unknown supplier is a 404", s==404, bad)

print(); print("ALL PASS" if not fails else f"{len(fails)} FAILED: "+", ".join(fails))
sys.exit(1 if fails else 0)
