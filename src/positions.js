// Pass 2: position model under METHODOLOGY.md. Input: dd-txs.jsonl rows (DD-record txs plus
// collateral-spend txs from the spends mode). Output: private positions, burn events, and
// public aggregates as of snapshot height H. Pure functions over rows; no I/O except in main().
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { isCollateralSpend, LOCK_TIERS } from "dgb-digidollar-codec";
export const SETTLE = 720, BLOCK_SECONDS = 15;

export function model(rows, H) {
  const byHeight = rows.filter((r) => r.height <= H).sort((a, b) => a.height - b.height || a.index - b.index);
  const ddOut = new Map();           // "txid:vout" → cents (DD outputs, valued by their creating record)
  const positions = new Map();       // collateral outpoint → position
  const ambiguous = [];              // mints where collateral could not be picked
  const burns = [];                  // tx-level burn events
  const invariants = { record_errors: 0, dd_input_unvalued: 0, transfer_not_conserved: 0 };
  for (const r of byHeight) {
    const rec = r.record && !r.record.error ? r.record : null; if (r.record && r.record.error) invariants.record_errors++;
    const zero = r.vout.filter((v) => v.type === "v1_p2tr" && v.value === 0); const valued = r.vout.filter((v) => v.type === "v1_p2tr" && v.value > 0);
    // 1) value DD outputs declared by this record, in order
    if (rec) { const declared = rec.type === "mint" ? [rec.ddAmountCents] : rec.type === "transfer" ? rec.amountsCents : rec.type === "redeem" ? (rec.ddChangeAmountCents ? [rec.ddChangeAmountCents] : []) : [];
      declared.forEach((c, i) => { if (zero[i]) ddOut.set(`${r.txid}:${zero[i].n}`, c); }); }
    // 2) DD consumed by this tx (one hop)
    const ddIn = r.vin.map((v) => ddOut.get(`${v.txid}:${v.vout}`)).filter((c) => c !== undefined); const consumed = ddIn.reduce((a, b) => a + b, 0);
    if (rec && rec.type === "transfer") { const outSum = rec.amountsCents.reduce((a, b) => a + b, 0); if (ddIn.length && consumed !== outSum) invariants.transfer_not_conserved++; }
    // 3) mint → position
    if (rec && rec.type === "mint") { const cents = rec.ddAmountCents; const lockHeight = rec.lockHeight; const tier = rec.lockTier;
      if (valued.length === 1) positions.set(`${r.txid}:${valued[0].n}`, { mint_txid: r.txid, mint_height: r.height, tier, lock_height: lockHeight, cents, collateral_outpoint: `${r.txid}:${valued[0].n}`, collateral_sats: valued[0].value, collateral_ambiguous: false, status: "locked", closed_by_txid: null, closed_height: null, close_kind: null, burn_event_id: null });
      else ambiguous.push({ mint_txid: r.txid, mint_height: r.height, tier, lock_height: lockHeight, cents, valued_taproot_outputs: valued.length }); }
    // 4) collateral spends (NUMS-proven) → close positions; burn event at tx level
    const closes = r.vin.filter((v) => isCollateralSpend({ witness: v.witness })).map((v) => `${v.txid}:${v.vout}`).filter((op) => positions.has(op));
    if (closes.length) { const change = rec && rec.type === "redeem" ? (rec.ddChangeAmountCents ?? 0) : 0; const mechanism = rec && rec.type === "redeem" ? "type-3" : "no-record"; const burn = consumed - change;
      const mintSum = closes.reduce((a, op) => a + positions.get(op).cents, 0); const extra = burn - mintSum; const kind = extra > 0 ? "over-mint" : mechanism;
      burns.push({ txid: r.txid, height: r.height, consumed_cents: consumed, change_cents: change, burn_cents: burn, mechanism, positions_closed: closes.length, closed_mint_cents: mintSum, extra_burn_cents: extra, dd_inputs_unvalued: r.vin.length - ddIn.length - closes.length - (r.vin.length - ddIn.length - closes.length >= 0 ? 0 : 0) });
      if (ddIn.length === 0) invariants.dd_input_unvalued++;
      for (const op of closes) { const p = positions.get(op); p.status = "closed"; p.closed_by_txid = r.txid; p.closed_height = r.height; p.close_kind = kind; p.burn_event_id = r.txid; } }
  }
  for (const p of positions.values()) if (p.status !== "closed") p.status = p.lock_height <= H ? "chain-matured-unspent" : "locked";
  return { positions: [...positions.values()], ambiguous, burns, invariants };
}
export function aggregates({ positions, burns, ambiguous }, H, Htime) {
  const month = (h) => new Date((Htime - (H - h) * BLOCK_SECONDS) * 1000).toISOString().slice(0, 7); const day = (h) => new Date((Htime - (H - h) * BLOCK_SECONDS) * 1000).toISOString().slice(0, 10);
  const open = positions.filter((p) => p.status !== "closed"); const matured = positions.filter((p) => p.status === "chain-matured-unspent");
  const mt = {}; for (const p of open) { const k = `${month(p.lock_height)}|${p.tier}`; const m = mt[k] || (mt[k] = { maturity_month: month(p.lock_height), tier: p.tier, tier_label: LOCK_TIERS[p.tier] ?? String(p.tier), positions: 0, cents: 0, collateral_sats: 0, matured_positions: 0 }); m.positions++; m.cents += p.cents; m.collateral_sats += p.collateral_sats; if (p.status === "chain-matured-unspent") m.matured_positions++; }
  const bucket = (p) => { const d = (H - p.lock_height) * BLOCK_SECONDS / 86400; return d <= 7 ? "0-7d" : d <= 30 ? "8-30d" : d <= 90 ? "31-90d" : "90d+"; };
  const mu = { as_of_height: H, positions: matured.length, cents: matured.reduce((a, p) => a + p.cents, 0), collateral_sats: matured.reduce((a, p) => a + p.collateral_sats, 0), age_buckets: {} };
  for (const b of ["0-7d", "8-30d", "31-90d", "90d+"]) { const s = matured.filter((p) => bucket(p) === b); mu.age_buckets[b] = { positions: s.length, cents: s.reduce((a, p) => a + p.cents, 0), collateral_sats: s.reduce((a, p) => a + p.collateral_sats, 0) }; }
  const flows = {}; const F = (d) => flows[d] || (flows[d] = { day: d, mints: 0, mint_cents: 0, closes: 0, released_sats: 0, burn_type3_cents: 0, burn_norecord_cents: 0, extra_burn_cents: 0, over_mint_events: 0 });
  for (const p of positions) { const f = F(day(p.mint_height)); f.mints++; f.mint_cents += p.cents; if (p.status === "closed") { const g = F(day(p.closed_height)); g.closes++; g.released_sats += p.collateral_sats; } }
  for (const b of burns) { const f = F(day(b.height)); if (b.mechanism === "type-3") f.burn_type3_cents += b.burn_cents; else f.burn_norecord_cents += b.burn_cents; if (b.extra_burn_cents > 0) { f.extra_burn_cents += b.extra_burn_cents; f.over_mint_events++; } }
  const totals = { positions_total: positions.length, locked: positions.filter((p) => p.status === "locked").length, chain_matured_unspent: matured.length, closed: positions.filter((p) => p.status === "closed").length, collateral_ambiguous_mints: ambiguous.length,
    outstanding_supply_cents: open.reduce((a, p) => a + p.cents, 0) /* mint-side; see manifest note: transfers do not change supply, burns do */, unspent_collateral_sats: open.reduce((a, p) => a + p.collateral_sats, 0), burned_cents: burns.reduce((a, b) => a + b.burn_cents, 0), over_mint_events: burns.filter((b) => b.extra_burn_cents > 0).length };
  return { month_tier: Object.values(mt).sort((a, b) => a.maturity_month.localeCompare(b.maturity_month) || a.tier - b.tier), matured_unredeemed: mu, flows: Object.values(flows).sort((a, b) => a.day.localeCompare(b.day)), totals };
}
export function writeSnapshot(dir, { H, Hhash, Htime, tip, agg, invariants, burnsCount, ambiguousCount, source, ddTxRows, rpcStats }) {
  const id = `mainnet-${H}-${Hhash.slice(0, 8)}`; const d = path.join(dir, id); fs.mkdirSync(d, { recursive: true });
  const files = { "month-tier.json": JSON.stringify(agg.month_tier, null, 1), "matured-unredeemed.json": JSON.stringify(agg.matured_unredeemed, null, 1), "flows.json": JSON.stringify(agg.flows, null, 1), "totals.json": JSON.stringify(agg.totals, null, 1) };
  const sums = []; for (const [n, b] of Object.entries(files)) { fs.writeFileSync(path.join(d, n), b); sums.push(`${crypto.createHash("sha256").update(b).digest("hex")}  ${n}`); } fs.writeFileSync(path.join(d, "SHA256SUMS"), sums.join("\n") + "\n");
  const gate = rpcStats ? { supply_cents_match: rpcStats.supply_cents === agg.totals.outstanding_supply_cents, collateral_sats_match: rpcStats.collateral_sats === agg.totals.unspent_collateral_sats, open_count_match: rpcStats.open_positions === agg.totals.locked + agg.totals.chain_matured_unspent, rpc: rpcStats } : null;
  const manifest = { snapshot_id: id, network: "digibyte-mainnet", status: "preview", label: "explorer-derived; node-cross-checked for heights (none yet)", snapshot_end_height: H, snapshot_end_hash: Hhash, snapshot_end_time: Htime, walk_tip_height: tip, settle_blocks: SETTLE, source, dd_transactions: ddTxRows, burn_events: burnsCount, collateral_ambiguous_mints: ambiguousCount, invariants, exact_gate: gate, schema_version: "0.1.0", generated_at: new Date().toISOString(), files: Object.keys(files), public_surface: "month×tier, matured-unredeemed totals + age buckets, daily flows, status totals — no per-height ladder, no per-position rows" };
  fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(manifest, null, 1)); return { id, dir: d, manifest };
}
