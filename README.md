# dd-position-scanner

**Status: scaffold, methodology and extractor; first snapshot pending the raw-block walk.**
Every DigiDollar record on DigiByte mainnet since activation → a private per-position table and
public aggregates at [dgbinsights.com/vaults](https://dgbinsights.com/vaults). Read
[METHODOLOGY.md](METHODOLOGY.md) first: status is chain-only (*locked / chain-matured, unspent /
closed*), position close and DD burn are separate objects, no per-height ladder and no
per-position row is ever published, and the "exact" label requires two independent walks plus
three RPC fields to agree at one block hash.

- `src/extract.js` — pass 1: offline scan of persisted raw blocks (from `oracle-ledger`'s walker),
  keeps every transaction carrying a `DD` record, decoded by `dgb-digidollar-codec`
- `src/chain.js` — raw block / transaction reader (shared with `dgb-ots-calendar`)
- `schema/position.schema.json` — private row, burn event, and public aggregate shapes

Independent community project, part of [dgb-tools](https://github.com/dgb-tools). Not affiliated
with the DigiByte Foundation. MIT.
