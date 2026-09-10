#!/usr/bin/env bash
# Extract → spends pass → model → snapshot (at the ledger's settled height) → render → deploy → record.
set -euo pipefail; cd "$(dirname "$0")/.."
LEDGER="${LEDGER:-/Users/michael/Library/CloudStorage/Dropbox/Windsurf/DGB Tools/oracle-ledger}"
SITE="${SITE:-/Users/michael/Library/CloudStorage/Dropbox/Windsurf/DGB Tools/dgbinsights/site}"
RAW="$LEDGER/data/raw-backfill,$LEDGER/data/raw"; mkdir -p data; TMP="$(mktemp -d)"
echo "== pass 1: DD-record transactions"; RAW_DIRS="$RAW" OUT=data/dd-txs.jsonl node src/extract.js
echo "== positions from pass 1 (for the spends pass)"; node -e "
import('./src/positions.js').then(({model})=>{const fs=require('fs');const rows=fs.readFileSync('data/dd-txs.jsonl','utf8').trim().split('\n').map(JSON.parse);const m=model(rows,99999999);fs.writeFileSync('data/positions-pass1.jsonl',m.positions.map(p=>JSON.stringify(p)).join('\n')+'\n');console.error('pass-1 positions',m.positions.length,'ambiguous',m.ambiguous.length)})"
echo "== pass 2: DD-record txs plus spends of known collateral"; RAW_DIRS="$RAW" SPENDS_OF=data/positions-pass1.jsonl OUT=data/dd-txs.jsonl node src/extract.js
echo "== snapshot height from the ledger's latest snapshot"; H=$(python3 -c "import json;print(json.load(open('$LEDGER/data/latest.json'))['end_height'])"); HH=$(python3 -c "import json;print(json.load(open('$LEDGER/data/latest.json'))['end_hash'])"); echo "H=$H $HH"
HT=$(grep "\"height\": $H," "$LEDGER"/data/blocks.jsonl -m1 | python3 -c "import sys,json;print(json.loads(sys.stdin.read())['time'])" 2>/dev/null || python3 -c "
import json
for l in open('$LEDGER/data/blocks.jsonl'):
    r=json.loads(l)
    if r['height']==$H: print(r['time']); break")
TIP=$(python3 -c "import json;print(json.load(open('$LEDGER/data/blocks.jsonl.state.json'))['tip_seen'])")
echo "== RPC gate (tolerant): getdigidollarstats now"; RPC=$(perl -e 'alarm 40; exec @ARGV' ssh -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=10 -i ~/.ssh/dgb_vps Administrator@154.12.247.176 'C:\DigiByte-DD\daemon\digibyte-cli.exe -datadir=C:\dgb-anchor -rpcclienttimeout=20 getdigidollarstats' 2>/dev/null | grep -v "post-quantum\|store now\|openssh.com/pq" || true); if echo "$RPC" | grep -q '{'; then echo "$RPC" > data/rpc-stats-now.json; echo "rpc captured (note: live tip, not H — recorded for reference, not the gate)"; else echo "rpc unavailable"; fi
echo "== model + snapshot"; node -e "
import('./src/positions.js').then(({model,aggregates,writeSnapshot})=>{const fs=require('fs');const rows=fs.readFileSync('data/dd-txs.jsonl','utf8').trim().split('\n').map(JSON.parse);const H=$H;const m=model(rows,H);const agg=aggregates(m,H,$HT);
fs.writeFileSync('data/positions-private.jsonl',m.positions.map(p=>JSON.stringify(p)).join('\n')+'\n');fs.writeFileSync('data/burn-events.json',JSON.stringify(m.burns,null,1));
const s=writeSnapshot('data/snapshots',{H,Hhash:'$HH',Htime:$HT,tip:$TIP,agg,invariants:m.invariants,burnsCount:m.burns.length,ambiguousCount:m.ambiguous.length,source:'https://digiexplorer.info/api (raw blocks, persisted by oracle-ledger walker)',ddTxRows:rows.length,rpcStats:null});
fs.writeFileSync('data/latest.json',JSON.stringify({snapshot_id:s.id,status:'preview',end_height:H,end_hash:'$HH',totals:agg.totals,generated_at:s.manifest.generated_at},null,1));console.error(JSON.stringify({id:s.id,totals:agg.totals,matured:agg.matured_unredeemed.positions,burns:m.burns.length,ambiguous:m.ambiguous.length,invariants:m.invariants}))})"
ID=$(python3 -c "import json;print(json.load(open('data/latest.json'))['snapshot_id'])")
echo "== render + stage"; node src/render.js "data/snapshots/$ID" "$TMP/site"; rm -rf "$SITE/vaults"; cp -R "$TMP/site/vaults" "$SITE/vaults"
echo "== deploy from a local copy"; LOCAL="$(mktemp -d)/site"; rsync -a --exclude ".DS_Store" "$SITE/" "$LOCAL/"; ( cd "$SITE/.." && CLOUDFLARE_ACCOUNT_ID=d5ca89fa8e14b07774666aa1d637ec6b CLOUDFLARE_API_TOKEN=$(cat ~/.cf_dgbinsights_deploy_token) npx --yes wrangler@3 pages deploy "$LOCAL" --project-name dgbinsights --commit-dirty=true 2>&1 | grep -E "Deployment complete|rror|Uploaded" )
for p in "vaults/" "vaults/latest.json" "vaults/snapshots/$ID/manifest.json"; do printf "%-60s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "https://dgbinsights.com/$p"; done
mkdir -p "snapshots/$ID"; cp "data/snapshots/$ID/manifest.json" "data/snapshots/$ID/SHA256SUMS" "snapshots/$ID/"; cp data/latest.json snapshots/latest.json; git add snapshots && git commit -q -m "snapshot $ID (preview)" && git push -q origin main && git log --format='%h %s' -1
