// Pass 1 (rule-independent extraction): scan persisted raw blocks, keep every transaction that
// carries a DigiDollar OP_RETURN record ("DD" + type byte), with its inputs and outputs decoded
// enough for the position model; also index every taproot (v1_p2tr) output so pass 2 can find
// spends of collateral outpoints. Output: JSONL, one row per DD transaction, height-ordered.
import fs from "node:fs"; import path from "node:path";
import { readBlockTxs } from "./chain.js"; import { parseDDOpReturn } from "dgb-digidollar-codec";
const DIRS = (process.env.RAW_DIRS || "data/raw-backfill,data/raw").split(","); const OUT = process.env.OUT || "data/dd-txs.jsonl";
function scriptType(s) { if (s.length === 34 && s[0] === 0x51 && s[1] === 0x20) return "v1_p2tr"; if (s.length === 22 && s[0] === 0x00 && s[1] === 0x14) return "v0_p2wpkh"; if (s.length === 34 && s[0] === 0x00 && s[1] === 0x20) return "v0_p2wsh"; if (s[0] === 0x6a) return "op_return"; if (s.length === 25 && s[0] === 0x76) return "p2pkh"; if (s.length === 23 && s[0] === 0xa9) return "p2sh"; return "other"; }
// inputs: need prevout txid/vout → re-read from the raw tx bytes (readTx skipped them); minimal input parser
function inputs(nonWitness) { let i = 4; let n = nonWitness[i]; i += 1; const out = []; for (let k = 0; k < n; k++) { const txid = Buffer.from(nonWitness.subarray(i, i + 32)).reverse().toString("hex"); const vout = nonWitness.readUInt32LE(i + 32); i += 36; let sl = nonWitness[i]; i += 1; i += sl + 4; out.push({ txid, vout }); } return out; }
const idx = []; for (const d of DIRS) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith(".idx.jsonl")) for (const l of fs.readFileSync(path.join(d, f), "utf8").trim().split("\n")) if (l) { const r = JSON.parse(l); idx.push({ ...r, bin: path.join(d, f.replace(".idx.jsonl", ".bin")) }); }
idx.sort((a, b) => a.h - b.h); let seen = -1, blocks = 0, ddTx = 0; const fds = new Map(); const out = fs.openSync(OUT, "w"); const heights = [];
for (const e of idx) { if (e.h === seen) continue; seen = e.h; const fd = fds.get(e.bin) ?? (fds.set(e.bin, fs.openSync(e.bin, "r")), fds.get(e.bin)); const buf = Buffer.alloc(e.n); fs.readSync(fd, buf, 0, e.n, e.o);
  let blk; try { blk = readBlockTxs(buf); } catch (err) { fs.writeSync(out, JSON.stringify({ height: e.h, error: err.message }) + "\n"); continue; } blocks++; heights.push(e.h);
  blk.txs.forEach((tx, ti) => {
    if (ti === 0) return; // coinbase never carries a DD record
    let parsed = null, recScript = null;
    for (const o of tx.vout) {
      const s = o.script;
      if (!(s[0] === 0x6a && s[1] === 0x02 && s[2] === 0x44 && s[3] === 0x44)) continue; // OP_RETURN <push 2 "DD">
      recScript = s;
      try { parsed = parseDDOpReturn(s); } catch (err) { parsed = { error: err.message }; }
      break;
    }
    if (!recScript) return;
    const row = { height: e.h, txid: tx.txid, index: ti, record_hex: recScript.toString("hex"), record: parsed, vin: inputs(tx.nonWitness),
      vout: tx.vout.map((o, n) => ({ n, value: o.value, type: scriptType(o.script), script: scriptType(o.script) === "v1_p2tr" ? o.script.toString("hex") : undefined })) };
    fs.writeSync(out, JSON.stringify(row) + "\n"); ddTx++;
  });
}
fs.closeSync(out); console.error(JSON.stringify({ blocks, dd_transactions: ddTx, first: heights[0], last: heights[heights.length - 1], out: OUT }));
