#!/usr/bin/env bash
# Run ONLY as GATE_FULL_CMD='bash scripts/differential-animated-mode.sh' via gate.sh.
# The gate owns the shared lock before this script can mutate the source.
set -euo pipefail
common="$(git rev-parse --path-format=absolute --git-common-dir)"
owner="$common/../.gate-lock/owner"
if [ ! -f "$owner" ] || ! grep -Fq "tree=$(pwd)" "$owner"; then
  echo 'REFUSED: run this differential inside the gate, under its shared lock.'
  exit 9
fi
logdir=.gate-logs/animated-differential
mkdir -p "$logdir"
source=web/src/ui/battlePresentation.ts
backup="$logdir/battlePresentation.ts.backup"
cp "$source" "$backup"
restore() { cp "$backup" "$source"; }
trap restore EXIT INT TERM
run_arm() {
  local name="$1"
  sha256sum "$source" | tee "$logdir/arm-$name.sha256"
  (cd web && npx vitest run src/components/__tests__/animatedBattles.test.ts --maxWorkers=1) 2>&1 | tee "$logdir/arm-$name.log"
}
run_arm A
node --input-type=module <<'JS'
import fs from 'node:fs'
const source = 'web/src/ui/battlePresentation.ts'
const old = fs.readFileSync(source, 'utf8')
const next = old.replace('const settledId = settled?.strike ? settled.id : undefined', "const settledId = settled?.strike ? settled.id + '-settled' : undefined")
if (next === old) throw Error('Injection target not found')
fs.writeFileSync(source, next)
JS
if run_arm B; then
  echo 'WRONG PIN: the changed settled identity was not detected.'
  exit 1
fi
restore
run_arm C
cmp "$logdir/arm-A.sha256" "$logdir/arm-C.sha256"
echo 'Differential proved: treating settled dice as a second strike replays the windup; restoration is byte-identical.'
