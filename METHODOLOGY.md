# Methodology — DigiDollar position scanner

**What this measures.** Every DigiDollar record on DigiByte mainnet since activation (height
23,869,440): mints (type 1), transfers (type 2), redemptions with a change record (type 3) and
redemptions with no record. From them, a *private* per-position table and *public* aggregates.
Rules below were red-teamed by the dgb-tools crew (Roundtables 2 and 5, 2026-09-09).

**Snapshot.** Same settle as the oracle ledger: H = observed tip − 720 (~3 hours). Every status
and every RPC comparison is "as of H", at one block hash; later spends do not touch the snapshot.
Snapshot id `mainnet-<H>-<hash8>`, composable with the ledger's. Live tip is never published.

**Position status — chain-only.**
- `locked`: lock height > H.
- `chain-matured, unspent`: lock height ≤ H and the collateral outpoint unspent at H. This is
  **not** "redeemable" or "eligible": redemption also needs the owner's key, the required DD
  burn, and no freeze, none of which is on chain. The public metric is named *matured collateral
  positions*; the Integrator's Guide caveat applies (maturity does not imply the owner holds DD).
- `closed`: the collateral outpoint is spent. The spend is the redemption, whatever its form.
Wallet vocabulary (`listdigidollarpositions.status`) is not imported.

**Collateral identification (codec trap).** At creation, a mint's valued taproot output is
*not provably* the collateral — it may be change; collateral is proven only at spend by the
NUMS internal key in the control block. The scanner identifies a mint's collateral as the single
valued `v1_p2tr` output when exactly one exists and flags every other case as `collateral_ambiguous`.
The exact gate below (unspent collateral to the satoshi against `getdigidollarstats`) catches
misidentification: a wrong pick fails the gate rather than shipping.

**Close versus burn — separate objects.**
- *Position close* is attributed to the spent collateral outpoint: DGB released, that vault's
  mint cents, closing txid and height, and kind: `type-3`, `no-record`, or `over-mint`.
- *Burn* is a transaction-level flow: consumed DD − declared change (type 3) or consumed DD
  (no record). It is never allocated to a position. Rows carry `closed_by_txid` and
  `burn_event_id`; there is no per-position `burn_cents`.
- *Over-mint:* extra burn = consumed − change − Σ mint cents of the vaults closed in that
  transaction, published as a flow series with a count. It is not labeled "ERR" from size alone;
  that label requires the protection state at that height. Week one: 13 of 13 redemptions burned
  exactly their mint cents; an extra burn of zero is a number, not a missing feature.

**Public aggregates (`/vaults`), and nothing else.**
- month × tier: positions, cents, collateral DGB (locked and matured)
- matured-unredeemed totals and age buckets: 0–7 d, 8–30 d, 31–90 d, 90 d+
- daily flows: mints, closes, DD burned by mechanism (type-3 / no-record / over-mint)
- status totals; supply and collateral reconciled to `getdigidollarstats` at H
- provenance manifest, `SHA256SUMS`, schema, data dictionary
**Not published:** any per-height ladder, any per-position row, owner keys, outpoints, or a
searchable page. The per-position table stays off the repo and off the site. "Anyone can
reproduce" means the scanner, the schema, the input receipt and the aggregate hashes.

**Sources.** Walk A: raw blocks from digiexplorer.info, every transaction parsed; records
decoded by `dgb-digidollar-codec` (`parseDDOpReturn`, extended, not rebuilt); spends found by a
sequential walk over inputs. Walk B: our node's `getblock <hash> 2` over the same range, *only if*
the pruned node serves the activation block (Core PR #418 prune lock). Until Walk B exists the
label is **preview** and reads *explorer-derived; node-cross-checked for heights X–Y*.
Esplora `/outspend` and `gettxout` are cross-checks, never a derivation.

**Exact gate — at one block hash.** Walk A = Walk B row-for-row on the canonical position key
and every state field, and all three of these equal `getdigidollarstats` at H: outstanding supply
in cents, unspent collateral in satoshis, open vault count (locked + matured). Any divergence is
a blocker: `/vaults` stays preview and the discrepancy is ours until shown otherwise. Burn
totals, over-mint, matured-unredeemed and the type-3 / no-record split are not in the RPC; A must
still equal B on them, and disagreements are published as a discrepancy report.

**Golden fixtures** (required before the first public snapshot): a type-3 redemption with change,
a no-record full burn, an over-mint redemption, a redemption consuming DD from several
positions, and a same-block mint-and-spend. Deterministic rerun must reproduce the artifact hash.

**Instrument.** A second party reproducing a snapshot id at a matching height is the demand
test; cites of the matured-unredeemed number lag; Core #428 is Core's calendar and gates
nothing here. Ninety days, all zero → internal census automation, public polish frozen.

**Vocabulary.** "chain-matured, unspent", "closed", "matured collateral positions",
"recorded in block N". Not: redeemable, eligible, proof, verified, liquidity guaranteed.
