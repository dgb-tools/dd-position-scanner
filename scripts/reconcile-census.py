#!/usr/bin/env python3
"""Reconcile the scanner's extracted DD-relevant transactions against the week-one census (v3).
Expected: every census row of class other than `collateral_only` appears in the extract, and the
extract has nothing extra within the census's height range. `collateral_only` rows are downstream
spends of already-released collateral (no DD record, no NUMS input) and are out of scope here."""
import json, sys, collections
extract = sys.argv[1] if len(sys.argv) > 1 else "data/dd-txs.jsonl"
census = sys.argv[2] if len(sys.argv) > 2 else "../dgbinsights/census/census-mainnet-week1.jsonl"
rows = {json.loads(l)["txid"]: json.loads(l) for l in open(extract)}
cen = [json.loads(l) for l in open(census)]
hmax = max(r["height"] for r in cen); mine = {t: r for t, r in rows.items() if r["height"] <= hmax}
in_scope = [r for r in cen if r.get("class") != "collateral_only"]; oos = [r for r in cen if r.get("class") == "collateral_only"]
missing = [r["txid"] for r in in_scope if r["txid"] not in mine]; extra = [t for t in mine if t not in {r["txid"] for r in cen}]
kinds = collections.Counter(("spend-no-record" if (r["record"] is None and r.get("spends_collateral")) else (r["record"] or {}).get("type")) for r in mine.values())
out = {"census_rows": len(cen), "in_scope": len(in_scope), "collateral_only_out_of_scope": len(oos), "extract_through_census_height": len(mine), "missing": missing, "extra": extra, "kinds": dict(kinds), "ok": not missing and not extra}
print(json.dumps(out, indent=1)); sys.exit(0 if out["ok"] else 1)
