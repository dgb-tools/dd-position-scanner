import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
import { model, aggregates } from "../src/positions.js";
const sample = fs.readFileSync(new URL("../data/dd-txs-sample.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
test("model over the sample chunk: mints become positions, transfers conserve, no closes without NUMS", () => {
  const H = Math.max(...sample.map((r) => r.height)); const m = model(sample, H);
  assert.equal(m.positions.length + m.ambiguous.length, sample.filter((r) => r.record?.type === "mint").length);
  assert.equal(m.invariants.transfer_not_conserved, 0); assert.ok(m.positions.every((p) => p.status !== "closed"));
  const agg = aggregates(m, H, 1755000000); assert.equal(agg.totals.positions_total, m.positions.length); assert.ok(agg.month_tier.length >= 1);
});
test("positions carry cents, lock height, tier and collateral from the codec's mint fields", () => {
  const H = Math.max(...sample.map((r) => r.height)); const m = model(sample, H);
  for (const p of m.positions) { assert.ok(Number.isInteger(p.cents) && p.cents >= 10000, `cents ${p.mint_txid.slice(0, 8)}`); assert.ok(p.lock_height > p.mint_height); assert.ok(Number.isInteger(p.tier)); assert.ok(p.collateral_sats > 0); }
  const agg = aggregates(m, H, 1755000000); assert.equal(agg.totals.outstanding_supply_cents, m.positions.filter((p) => p.status !== "closed").reduce((a, p) => a + p.cents, 0)); assert.ok(agg.totals.outstanding_supply_cents > 0);
});
