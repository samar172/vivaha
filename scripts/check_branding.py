#!/usr/bin/env python3
"""Checks the firm's own name, mark and item marking.

The system was built for one shop and printed its name everywhere. This proves
a different firm can be set: the name reaches the tax invoice, the mark is what
a carton label carries, and the code prefix follows the firm rather than us.

Also the item marking itself — typed rather than generated, changeable, with the
old code still scanning, because cartons already on a shelf carry it.

    python3 scripts/check_branding.py [API_BASE] [USERNAME] [PASSWORD]

It changes the company settings and puts them back. Point it at a development
database.
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4199"
USER = sys.argv[2] if len(sys.argv) > 2 else "admin"
PASS = sys.argv[3] if len(sys.argv) > 3 else "demo123"
def call(m,p,body=None,tok=None):
    d=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(B+p,data=d,method=m,headers={"Content-Type":"application/json",**({"Authorization":"Bearer "+tok} if tok else {})})
    try:
        with urllib.request.urlopen(r,timeout=40) as f: return f.status,json.loads(f.read() or b"null")
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read() or b"null")
fails=[]
def ck(n,c,e=""):
    print(("PASS " if c else "FAIL ")+n+(" :: "+str(e) if e and not c else ""))
    if not c: fails.append(n)
s,r=call("POST","/api/auth/login",{"username":USER,"password":PASS}); T=r["accessToken"]

s,cfg=call("GET","/api/settings",tok=T)
orig=cfg["company"]
ck("company settings readable", s==200 and "name" in orig, orig)

import atexit
@atexit.register
def _restore():
    st,back = call("PUT", "/api/settings", {"company": orig}, tok=T)
    print(f"(company restored to {orig['name']})" if st == 200 else f"(WARNING: could not restore the company settings: {back})")
# Set a different firm entirely, the way handing the system to another shop would.
s,saved=call("PUT","/api/settings",{"company":{**orig,"name":"Jain Card Gallery","mark":"JCG","codePrefix":"JCG"}},tok=T)
ck("name, mark and prefix save", s==200 and saved["company"]["mark"]=="JCG", saved.get("company"))
s,cfg2=call("GET","/api/settings",tok=T)
ck("and read back", cfg2["company"]["name"]=="Jain Card Gallery" and cfg2["company"]["codePrefix"]=="JCG", cfg2["company"])

# The suggested item code follows the firm, not us.
s,items=call("GET","/api/items?line=L1",tok=T)
it=[x for x in items["items"] if not x["code"]] or items["items"]
target=it[0]
s,sug=call("GET",f"/api/codes/item/{target['id']}/suggest",tok=T)
ck("suggested code carries the firm's prefix", s==200 and sug["suggested"].startswith("JCG-"), sug)

# A typed code wins over the suggestion.
import time, random
STAMP=f"{int(time.time())%100000}{random.randint(100, 999)}"
mine=f"JCG-MARK-{STAMP}-A"
s,issued=call("POST",f"/api/codes/item/{target['id']}/relabel",{"code":mine},tok=T)
ck("a typed code is accepted", s==201 and issued["code"]==mine, issued)
s,res=call("GET",f"/api/codes/resolve?code={mine}",tok=T)
ck("and it scans back to the item", s==200 and res["item"]["id"]==target["id"], res.get("item"))
# Changing it keeps the old one alive.
s,changed=call("POST",f"/api/codes/item/{target['id']}/relabel",{"code":f"JCG-MARK-{STAMP}-B","replacesCodeId":issued["id"]},tok=T)
ck("the marking can be changed", s==201, changed)
s,old=call("GET",f"/api/codes/resolve?code={mine}",tok=T)
ck("the old code still scans", s==200 and old["status"]=="REPLACED" and old["replacedBy"]["code"]==f"JCG-MARK-{STAMP}-B", old)
# Rubbish is refused.
s,bad=call("POST",f"/api/codes/item/{target['id']}/relabel",{"code":"has spaces & symbols!"},tok=T)
ck("a code that cannot be written on a carton is refused", s==400, bad)
s,dup=call("POST",f"/api/codes/item/{target['id']}/relabel",{"code":f"JCG-MARK-{STAMP}-B"},tok=T)
ck("a duplicate is refused", s==400, dup)
# A mark longer than a mark is refused.
s,long=call("PUT","/api/settings",{"company":{**orig,"mark":"VIVAHA CARDS"}},tok=T)
ck("a whole name is refused as a mark", s==400, long)
# The bill carries the new name.
s,invs=call("GET","/api/ledger/invoices",tok=T)
if invs:
    i=invs[0]
    s,full=call("GET",f"/api/orders/{i['orderId']}/invoice/{urllib.parse.quote(i['no'],safe='')}",tok=T)
    ck("the bill prints the firm that is set", full["company"]["name"]=="Jain Card Gallery", full["company"])
print(); print("ALL PASS" if not fails else f"{len(fails)} FAILED: "+", ".join(fails))
sys.exit(1 if fails else 0)
