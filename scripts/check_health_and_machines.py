#!/usr/bin/env python3
"""Checks the data-health score and the machines-by-owner view.

A half-filled master costs money quietly: a bill that cannot be raised without a
GSTIN, a short delivery that cannot be chased without a phone. The score exists
to make that visible as a percentage — so the checks here are about the score
being honest: weighted, never counting a field that does not apply, and always
reconciling with the records it is averaged from.

    python3 scripts/check_health_and_machines.py [API_BASE] [USERNAME] [PASSWORD]
"""
import json
import math
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


# JavaScript's Math.round takes halves upward; Python's round() is banker's, so
# 12.5 becomes 12 here and 13 there. Reimplementing the server's arithmetic
# means reimplementing that too, or the check disagrees over every .5 and blames
# the code — which is exactly what happened first time round.
def jsround(x):
    return math.floor(x + 0.5)


def ck(n, c, e=""):
    print(("PASS " if c else "FAIL ") + n + (" :: " + str(e) if e and not c else ""))
    if not c:
        FAILS.append(n)


s, r = call("POST", "/api/auth/login", {"username": USER, "password": PASS})
T = r["accessToken"]

# ── Machines, turned round to answer "who runs one" ────────────────────────
s, m = call("GET", "/api/customers/machines", tok=T)
ck("the machines list loads and is not swallowed by /:id", s == 200 and isinstance(m, list), m if s != 200 else "")
if m:
    ck("every machine names the firm that runs it", all(x["customer"]["id"] and x["customer"]["name"] for x in m), m[0]["customer"])
    ck("the spec is pulled out into columns to filter on", all({"make", "model", "serial", "status"} <= set(x) for x in m), sorted(m[0].keys()))
    s, cs = call("GET", "/api/customers", tok=T)
    rows = cs["rows"] if isinstance(cs, dict) else cs
    onrec = sum(len(c.get("machines", [])) for c in rows)
    ck("it agrees with the customer records it comes from", len(m) == onrec, f"flat {len(m)} vs on customers {onrec}")

# ── The health score ───────────────────────────────────────────────────────
s, h = call("GET", "/api/reports/health", tok=T)
ck("the health report loads", s == 200 and "customers" in h and "vendors" in h, h if s != 200 else "")
for side in ("customers", "vendors"):
    d = h[side]
    ck(f"{side}: a percentage between 0 and 100", 0 <= d["overall"] <= 100, d["overall"])
    ck(f"{side}: the bands account for every record", d["good"] + d["fair"] + d["poor"] == d["counted"] == len(d["rows"]), (d["good"], d["fair"], d["poor"], d["counted"]))
    if d["rows"]:
        avg = jsround(sum(r["score"] for r in d["rows"]) / len(d["rows"]))
        ck(f"{side}: the overall figure is the average of the records", d["overall"] == avg, f"{d['overall']} vs {avg}")
        ck(f"{side}: every record scores within range", all(0 <= r["score"] <= 100 for r in d["rows"]))
        # Missing must be exactly the failed, applicable checks — no more.
        bad = [r["name"] for r in d["rows"] if {c["key"] for c in r["missing"]} != {c["key"] for c in r["checks"] if not c["ok"] and not c.get("na")}]
        ck(f"{side}: what is listed as missing is what actually failed", not bad, bad[:3])
        # A record with nothing missing must score 100, and vice versa.
        wrong = [r["name"] for r in d["rows"] if (not r["missing"]) != (r["score"] == 100)]
        ck(f"{side}: a complete record scores 100 and only a complete one does", not wrong, wrong[:3])
        # The score has to be weighted, not a plain count — prove the weights matter.
        ck(f"{side}: the checks carry different weights", len({c['weight'] for c in d['rows'][0]['checks']}) > 1, [c["weight"] for c in d["rows"][0]["checks"]])
    for f in d["fields"]:
        ck(f"{side}: '{f['label']}' reconciles ({f['ok']}/{f['applies']})", f["applies"] == 0 or f["pct"] == jsround(f["ok"] / f["applies"] * 100), f)
        ck(f"{side}: '{f['label']}' says why it matters", bool(f["hint"]), f)

# A field that does not apply must not be counted against the record. An
# unregistered firm has no GSTIN and must not be marked down forever for it.
unreg = [r for r in h["customers"]["rows"] if any(c["key"] == "gstin" and c.get("na") for c in r["checks"])]
if unreg:
    ck("an unregistered firm is not marked down for having no GSTIN",
       all(not any(m["key"] == "gstin" for m in r["missing"]) for r in unreg), unreg[0]["name"])
    # What matters is not whether the field happens to be filled in, but that a
    # check marked not-applicable is in neither the numerator nor the
    # denominator — so it can neither help nor hurt the score.
    def recompute(r, drop_na):
        live = [c for c in r["checks"] if not (drop_na and c.get("na"))]
        pos = sum(c["weight"] for c in live)
        got = sum(c["weight"] for c in live if c["ok"])
        return jsround(got / pos * 100) if pos else 100
    ck("  and that check is left out of its arithmetic rather than failed",
       all(r["score"] == recompute(r, True) for r in unreg), [(r["name"], r["score"], recompute(r, True)) for r in unreg][:3])
else:
    print("note: every customer on file is registered, so the not-applicable path was not exercised")

# It is a report, so it is behind the report permission.
s, users = call("GET", "/api/settings/users", tok=T)
disp = [u for u in users["staff"] if u["role"] == "DISPATCH_MANAGER"]
if disp:
    u = disp[0]
    was = u["isActive"]
    if not was:
        call("PATCH", f"/api/settings/users/{u['id']}", {"isActive": True}, tok=T)
    s, pw = call("POST", f"/api/settings/users/{u['id']}/reset-password", tok=T)
    s, sess = call("POST", "/api/auth/login", {"username": u["username"], "password": pw["password"]})
    if s == 200 and "report.view" not in sess["user"]["perms"] and "cust.view" not in sess["user"]["perms"]:
        s, _ = call("GET", "/api/reports/health", tok=sess["accessToken"])
        ck("a role without report.view or cust.view is refused", s == 403, s)
    if not was:
        call("PATCH", f"/api/settings/users/{u['id']}", {"isActive": False}, tok=T)

print()
print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: " + ", ".join(FAILS))
sys.exit(1 if FAILS else 0)
