import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
import { readTx } from "../src/chain.js"; import { parseDDOpReturn, isCollateralSpend, NUMS_INTERNAL_KEY } from "dgb-digidollar-codec";
const fx = JSON.parse(fs.readFileSync(new URL("./vectors/week1-redemptions.json", import.meta.url), "utf8"));
test("13 week-one redemptions: txid, one NUMS collateral input each, form matches record presence, burn = consumed − change", () => {
  assert.equal(fx.length, 13); let t3 = 0, nr = 0;
  for (const f of fx) { const tx = readTx(Buffer.from(f.hex, "hex"), 0); assert.equal(tx.txid, f.txid);
    const nums = tx.vin.filter((v) => isCollateralSpend({ witness: v.witness })).length; assert.equal(nums, 1, `every week-one redemption released exactly one NUMS-proven collateral ${f.txid.slice(0, 8)}`); assert.ok(Array.isArray(f.census.closes) && f.census.closes.length >= 1, "census lists the DD-source positions consumed (not collateral released)");
    const rec = tx.vout.map((o) => o.script).filter((s) => s[0] === 0x6a && s[1] === 0x02 && s[2] === 0x44 && s[3] === 0x44).map((s) => parseDDOpReturn(s)).find(Boolean) || null;
    if (f.census.form === "type-3") { t3++; assert.ok(rec && rec.type === "redeem", "type-3 has a redeem record"); assert.equal(rec.ddChangeAmountCents, f.census.dd_change, `change ${f.txid.slice(0, 8)}`); }
    else { nr++; assert.equal(rec, null, "no-record redemption carries no DD record"); assert.equal(f.census.dd_change, 0); }
    assert.equal(f.census.dd_in - f.census.dd_change, f.census.burn_cents, `burn = consumed − change ${f.txid.slice(0, 8)}`);
  }
  assert.equal(t3, 3); assert.equal(nr, 10);
});
test("NUMS key constant is the one Core pins", () => { assert.equal(NUMS_INTERNAL_KEY, "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0"); });
