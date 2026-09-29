#!/usr/bin/env python3
"""Checks the photographs taken of a picked order, before it is packed.

A dispute is always the same argument: the firm says four bundles came and the
godown says five went. Once the boxes are taped there is nothing left to look
at, so the moment worth a photograph is after picking and before packing, with
the goods still spread on the table — and several pictures beat one.

This is evidence, so the checks are about evidence: each picture stamped with
who took it, when, and what the order was at that moment; removable while the
goods are still here and closed once they have gone; a late addition accepted
rather than lost, but marked as late so it cannot pass as one taken at the table.

    python3 scripts/check_picking_photos.py [API_BASE] [USERNAME] [PASSWORD]

It books, picks and dispatches an order, so point it at a development database.
"""
import base64
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
PNG=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
SHOT="data:image/png;base64,"+base64.b64encode(PNG).decode()

s,cards=call("GET","/api/items?line=L1",tok=T)
card=next(c for c in cards["items"] if c["band"]["canBook"]); Q=card["moq"]
s,cs=call("GET","/api/customers",tok=T); cust=next(c for c in cs if not c["blockReason"])
s,o=call("POST","/api/orders",{"customerId":cust["id"],"lines":[{"itemId":card["id"],"qty":Q}],"overrideReason":"picking photo check"},tok=T)
oid=o["id"]
call("POST",f"/api/orders/{oid}/approve",{"reason":"x"},tok=T); call("POST",f"/api/orders/{oid}/reserve",tok=T)
s,oo=call("GET",f"/api/orders/{oid}",tok=T)
call("POST",f"/api/orders/{oid}/allocate",{"alloc":{l["itemId"]:l["alloc"] for l in oo["lines"]}},tok=T)
call("POST",f"/api/orders/{oid}/status",{"to":"PICKING"},tok=T)
call("POST",f"/api/orders/{oid}/status",{"to":"PICKED"},tok=T)
s,oo=call("GET",f"/api/orders/{oid}",tok=T)
ck("the order is picked and not yet packed", oo["status"]=="PICKED", oo["status"])
ck("it starts with no photographs", oo.get("photos")==[], oo.get("photos"))

# Several at once — that is the point.
s,up=call("POST",f"/api/orders/{oid}/photos",{"photos":[SHOT,SHOT,SHOT],"note":"4 bundles, counted twice"},tok=T)
ck("several photographs save in one go", s==201 and len(up["photos"])==3, up)
ck("each is stamped with the stage it was taken at", all(p["atStage"]=="PICKED" for p in up["photos"]), [p["atStage"] for p in up["photos"]])
ck("and with who took it", all(p["by"] for p in up["photos"]), up["photos"][0])
ck("the note is kept", all("counted twice" in p["note"] for p in up["photos"]), up["photos"][0]["note"])
ck("each got a stored url", all(p["url"].startswith(("/api/uploads/","https://")) for p in up["photos"]), [p["url"] for p in up["photos"]])
s,oo=call("GET",f"/api/orders/{oid}",tok=T)
ck("they travel with the order", len(oo["photos"])==3, len(oo.get("photos",[])))

# A bad shot can be taken off, while the goods are still here.
bad=up["photos"][0]
s,x=call("DELETE",f"/api/orders/{oid}/photos/{bad['id']}",tok=T)
ck("a photograph can be removed before dispatch", s==200, x)
s,oo=call("GET",f"/api/orders/{oid}",tok=T)
ck("and it is gone", len(oo["photos"])==2, len(oo["photos"]))

# More at packing, then the set closes.
call("POST",f"/api/orders/{oid}/status",{"to":"PACKED"},tok=T)
s,up2=call("POST",f"/api/orders/{oid}/photos",{"photos":[SHOT],"note":"sealed"},tok=T)
ck("more can be added at packing", s==201 and up2["photos"][0]["atStage"]=="PACKED", up2)
call("POST",f"/api/orders/{oid}/status",{"to":"READY_TO_DISPATCH"},tok=T)
s,d=call("POST",f"/api/orders/{oid}/dispatch",{"ship":{card["id"]:Q},"mode":"TRANSPORT","transporter":"Check","lr":"LR-PICK","freight":0},tok=T)
ck("dispatched", s==200, d)
s,oo=call("GET",f"/api/orders/{oid}",tok=T)
keep=oo["photos"][0]
s,x=call("DELETE",f"/api/orders/{oid}/photos/{keep['id']}",tok=T)
ck("once the goods have gone, nothing can be removed", s==400 and "goods have gone" in x.get("error",""), x)
# A late addition is allowed but says so.
s,late=call("POST",f"/api/orders/{oid}/photos",{"photos":[SHOT],"note":"found on the phone afterwards"},tok=T)
ck("a late photograph is still accepted", s==201, late)
ck("  and is marked with the stage it was really added at", late["photos"][0]["atStage"]=="DISPATCHED", late["photos"][0]["atStage"])
s,x=call("POST",f"/api/orders/{oid}/photos",{"photos":[]},tok=T)
ck("saving nothing is refused", s==400, x)
s,x=call("POST",f"/api/orders/{oid}/photos",{"photos":[SHOT]*13},tok=T)
ck("an absurd number is refused", s==400, x)
s,x=call("POST","/api/orders/ORD-NOPE/photos",{"photos":[SHOT]},tok=T)
ck("an unknown order is a 404", s==404, x)
# The audit log carries it.
s,al=call("GET",f"/api/audit-logs?q={oid}",tok=T)
rows = al["rows"] if isinstance(al,dict) else al
ck("the audit log records the photographs", any("photograph" in (r.get("action","") or "").lower() for r in rows), [r.get("action") for r in rows][:6])
print(); print("ALL PASS" if not fails else f"{len(fails)} FAILED: "+", ".join(fails))
sys.exit(1 if fails else 0)
