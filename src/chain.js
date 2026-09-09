// Shape-A chain math: transactions, txids, merkle paths, and the OTS op path that lifts a
// payload embedded in a transaction to the block's merkle root. Pure functions.
import { createHash } from "node:crypto";
const TAG = { append: 0xf0, prepend: 0xf1, sha256: 0x08 };
const sha256 = (b) => createHash("sha256").update(b).digest();
export const sha256d = (b) => sha256(sha256(b));
function varint(b, i) { const v = b[i]; if (v < 0xfd) return [v, i + 1]; if (v === 0xfd) return [b.readUInt16LE(i + 1), i + 3]; if (v === 0xfe) return [b.readUInt32LE(i + 1), i + 5]; return [Number(b.readBigUInt64LE(i + 1)), i + 9]; }
/** Parse one tx at offset; returns { start, end, nonWitness, vin, vout:[{value, script, scriptOffset(in nonWitness)}] } */
export function readTx(b, start) {
  let i = start; const version = b.subarray(i, i + 4); i += 4; let segwit = false; if (b[i] === 0 && b[i + 1] === 1) { segwit = true; i += 2; }
  const parts = [version]; const inStart = i; let nin; [nin, i] = varint(b, i);
  for (let k = 0; k < nin; k++) { i += 36; let sl; [sl, i] = varint(b, i); i += sl + 4; }
  let nout; [nout, i] = varint(b, i); const vout = []; const outStart = i;
  for (let k = 0; k < nout; k++) { const value = Number(b.readBigUInt64LE(i)); i += 8; let sl, so; [sl, so] = varint(b, i); vout.push({ value, script: Buffer.from(b.subarray(so, so + sl)), scriptOffset: so - inStart + 4 }); i = so + sl; }
  const coreEnd = i; parts.push(b.subarray(inStart, coreEnd));
  if (segwit) for (let k = 0; k < nin; k++) { let nw; [nw, i] = varint(b, i); for (let w = 0; w < nw; w++) { let wl; [wl, i] = varint(b, i); i += wl; } }
  const locktime = b.subarray(i, i + 4); i += 4; parts.push(locktime);
  const nonWitness = Buffer.concat(parts); return { start, end: i, nonWitness, txid: Buffer.from(sha256d(nonWitness)).reverse().toString("hex"), vout, segwit };
}
export function readBlockTxs(blockBuf) { const b = Buffer.from(blockBuf); const header = b.subarray(0, 80); let [n, i] = varint(b, 80); const txs = []; for (let k = 0; k < n; k++) { const t = readTx(b, i); txs.push(t); i = t.end; } return { header, merkleRoot: Buffer.from(header.subarray(36, 68)).reverse().toString("hex"), txs }; }
/** Merkle path for txid index k as OTS ops on the little-endian txid bytes; returns { ops, root } (root as displayed hex). Bitcoin rule: odd level duplicates the last hash. */
export function merklePathOps(txidsHexDisplay, k) {
  let level = txidsHexDisplay.map((h) => Buffer.from(h, "hex").reverse()); const ops = []; let idx = k;
  while (level.length > 1) { if (level.length % 2 === 1) level.push(level[level.length - 1]);
    const sib = idx % 2 === 0 ? level[idx + 1] : level[idx - 1];
    ops.push(idx % 2 === 0 ? { tag: TAG.append, arg: sib } : { tag: TAG.prepend, arg: sib }, { tag: TAG.sha256 }, { tag: TAG.sha256 });
    const next = []; for (let i = 0; i < level.length; i += 2) next.push(sha256d(Buffer.concat([level[i], level[i + 1]]))); level = next; idx = Math.floor(idx / 2); }
  return { ops, root: Buffer.from(level[0]).reverse().toString("hex") };
}
/** OTS ops lifting a payload (found at byte offset `off` inside tx.nonWitness) to the block merkle root. */
export function payloadToRootOps(tx, off, len, txidsHexDisplay, k) {
  const nw = tx.nonWitness; if (off < 0 || off + len > nw.length) throw new Error("payload offset out of range");
  const ops = [{ tag: TAG.prepend, arg: Buffer.from(nw.subarray(0, off)) }, { tag: TAG.append, arg: Buffer.from(nw.subarray(off + len)) }, { tag: TAG.sha256 }, { tag: TAG.sha256 }];
  const mp = merklePathOps(txidsHexDisplay, k); return { ops: [...ops, ...mp.ops], root: mp.root };
}
