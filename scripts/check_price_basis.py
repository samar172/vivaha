#!/usr/bin/env python3
"""Checks what the price-list multiplier is measured from, and the job-work link.

The basis is the office's choice per item — the supplier's last rate, landed
cost, what the item sells for today, or a figure they type — so each is priced
and read back, including on a change queued for a later date.

Then job work: tied to the card order it was taken alongside and the bill it
went on, with another firm's order refused, because one customer's printing
filed against another's invoice is worse than no link at all.

    python3 scripts/check_price_basis.py [API_BASE] [USERNAME] [PASSWORD]

It writes prices and links, so point it at a development database.
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
now=datetime.datetime.now().isoformat()

# ── the price basis ────────────────────────────────────────────────────────
s,pl=call("GET","/api/items/price-list?line=L1",tok=T)
ck("rows carry the basis", all("priceBasis" in x for x in pl["items"]), pl["items"][0].keys())
it=[x for x in pl["items"] if x["purchasePrice"]][0]
for basis, base in [("LANDED", it["landedCost"]), ("PURCHASE", it["purchasePrice"])]:
    want=round(base*1.3,2)
    s,x=call("POST","/api/items/price-list",{"effectiveFrom":now,"reason":"basis test",
        "rows":[{"itemId":it["id"],"purchasePrice":it["purchasePrice"],"priceBasis":basis,"multiplier":1.3,"sellingPrice":want}]},tok=T)
    ck(f"priced off {basis.lower()}", s==201, x)
    s,after=call("GET","/api/items/{}".format(it["id"]),tok=T)
    ck(f"  slab is {basis.lower()} x 1.3", abs(after["slabs"][0]["rate"]-want)<0.02, f"{after['slabs'][0]['rate']} vs {want}")
    s,pl2=call("GET","/api/items/price-list?line=L1",tok=T)
    ck(f"  the basis is remembered ({basis})", [x for x in pl2["items"] if x["id"]==it["id"]][0]["priceBasis"]==basis)
# a typed base
s,x=call("POST","/api/items/price-list",{"effectiveFrom":now,"rows":[{"itemId":it["id"],"priceBasis":"MANUAL","manualBase":40,"multiplier":1.5,"sellingPrice":60}]},tok=T)
ck("priced off a typed figure", s==201, x)
s,pl3=call("GET","/api/items/price-list?line=L1",tok=T)
row=[x for x in pl3["items"] if x["id"]==it["id"]][0]
ck("  the typed figure is kept", row["priceBasis"]=="MANUAL" and abs(row["manualBase"]-40)<1e-9, row)
ck("  and the price is 40 x 1.5", abs(row["sellingPrice"]-60)<0.02, row["sellingPrice"])
# a scheduled change carries the working too
fut=(datetime.datetime.now()+datetime.timedelta(days=10)).isoformat()
s,x=call("POST","/api/items/price-list",{"effectiveFrom":fut,"rows":[{"itemId":it["id"],"priceBasis":"CURRENT","multiplier":1.05,"sellingPrice":63}]},tok=T)
ck("a queued list keeps its basis", s==201, x)
s,pl4=call("GET","/api/items/price-list?line=L1",tok=T)
p4=[x for x in pl4["items"] if x["id"]==it["id"]][0]
ck("  shown on the queued change", p4["pending"] and p4["pending"]["priceBasis"]=="CURRENT", p4.get("pending"))
call("DELETE",f"/api/items/price-changes/{p4['pending']['id']}",tok=T)

# ── job work tied to an order ──────────────────────────────────────────────
s,jobs=call("GET","/api/jobs",tok=T)
ck("jobs carry the link fields", all("order" in j and "invoice" in j for j in jobs), jobs[0].keys() if jobs else "no jobs")
j=jobs[0]
s,opts=call("GET",f"/api/jobs/linkable/{j['customer']['id']}",tok=T)
ck("the firm's orders are offered", s==200 and isinstance(opts,list), opts if s!=200 else len(opts))
if opts:
    o=opts[0]
    s,linked=call("PATCH",f"/api/jobs/{j['id']}/link",{"orderId":o["id"]},tok=T)
    ck("job linked to the order", s==200 and linked["order"]["id"]==o["id"], linked.get("order"))
    if o["invoices"]:
        s,l2=call("PATCH",f"/api/jobs/{j['id']}/link",{"orderId":o["id"],"invoiceNo":o["invoices"][0]["no"]},tok=T)
        ck("and to the bill on it", s==200 and l2["invoice"]["no"]==o["invoices"][0]["no"], l2.get("invoice"))
    # another firm's order must be refused
    s,others=call("GET","/api/orders?tab=all",tok=T)
    wrong=[x for x in others["orders"] if x["customer"]["id"]!=j["customer"]["id"]]
    if wrong:
        s,x=call("PATCH",f"/api/jobs/{j['id']}/link",{"orderId":wrong[0]["id"]},tok=T)
        ck("another firm's order is refused", s==400 and "different firm" in x.get("error",""), x)
    s,x=call("PATCH",f"/api/jobs/{j['id']}/link",{"orderId":"ORD-NOPE"},tok=T)
    ck("an unknown order is refused", s==404, x)
    s,un=call("PATCH",f"/api/jobs/{j['id']}/link",{"orderId":None,"invoiceNo":None},tok=T)
    ck("and it can be unlinked", s==200 and un["order"] is None and un["invoice"] is None, un.get("order"))
print(); print("ALL PASS" if not fails else f"{len(fails)} FAILED: "+", ".join(fails))
sys.exit(1 if fails else 0)
