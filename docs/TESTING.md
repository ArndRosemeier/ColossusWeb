# Testing — what proves this, and what was actually run

This doc exists because **"it compiles" is never "it passed"**, and because a green
result whose evidence was discarded cannot be diagnosed. It records the pins, the
differential arms with their hashes, and the VOID probes — per landing, as they were
actually run.

It is not a test plan. It is the record of what *proves* the behaviour, and of what
was *executed*.

## The two tiers

| | Cheap | Full |
| --- | --- | --- |
| Command | `GATE_TESTS=0 bash scripts/gate.sh` | `bash scripts/gate.sh` |
| Runs | `tsc -b && vite build` in `web/` | `oxlint && vitest run` in `web/` |
| Question | *does it still build?* | *did behaviour move?* |
| Exit | `2` (suite did NOT run) | `0` green / `1` red |

Both tiers are **side-effect-free with respect to TRACKED files** — in particular
neither runs `npm run convert`, which rewrites tracked variant JSON. Run the gate from
the **root of the tree you mean to gate**. `2` is never "the gate passed". A preflight
failure (no `web/node_modules`) exits `1` and says it is a preflight failure, not a
test failure.

**`web/` is the only stack a gate covers.** The Java tree in `Colossus/` cannot be
compiled, run or tested on this host — no JDK, `ant` or `mvn` exists — so **no gate and
no pin covers Java behaviour**. A claim about the Java reference is evidenced by
quoting `Colossus/<file>.java:<line>`, never by a build or a test.

**The suite is fast** (full tier ≈ 2.7 s wall). The lock and the peak ceiling are kept
anyway: they are the mechanism that stays correct if the suite grows, and they are what
makes a busy-lock refusal meaningful rather than hypothetical.

## Baseline — the day-1 scaffold verification

Measured 2026-09-27 by the dispatcher on base `48be107`, **before any landing existed**.
This is the reference point every future landing is compared against.

- **Cheap tier:** `GATE_TESTS=0 bash scripts/gate.sh` → exit **2**. `tsc -b` + `vite
  build` built 61 modules in 387 ms; output `dist/assets/index-CSQiFiWg.js` 444.75 kB
  (gzip 135.77 kB), `dist/assets/index-Dx1bNQOB.css` 24.47 kB.
- **Full gate:** `bash scripts/gate.sh` → exit **0**, both tiers green.
  - `oxlint`: **14 warnings, 0 errors** over 106 files / 103 rules (warnings do not fail
    the tier — the baseline is 14, so a landing that *raises* this number has added
    lint debt even though the gate stays green).
  - `vitest`: **271 passed · 2 todo (273 tests)** in **45 passed files + 1 skipped file
    (46)**. `rules-gaps.test.ts` is the skipped file (2 todo).
  - Peak RSS: **302712 KB (~295 MB)** — the number to compare a future run against.
  - Raw log: `.gate-logs/gate.log`.
- **Reconciler:** `bash scripts/board.sh` → `BOARD RECONCILED`, exit **0**.

### A probe that came back negative (and is therefore recorded)

**Question:** is the committed variant JSON actually in sync with the Java variant XML,
or is it stale build output that the next `convert` would silently rewrite?

**Method:** on the clean base, ran `npm run convert`, then `git status --porcelain` and
`git diff --stat` over the tree.

**Result:** **0 tracked changes.** The 1372 committed paths under
`web/public/variants/**` are byte-identical to what `web/scripts/convert-variant.mjs`
regenerates as of `48be107`.

**Why it is worth a line:** it converts an assumption ("the JSON probably matches the
XML") into a measurement, and it is the evidence behind the board's guard that the gate
may safely skip `convert`. It is a *measurement*, not a pin: nothing goes red if the XML
later drifts from the JSON. A pin for that would need a test that runs `convert` into a
temp dir and diffs — deliberately not built yet, and the debt is named here rather than
hidden.

## The pin

A **pin** is a test that goes red when the behaviour it protects is broken. Three
rules make a pin worth having:

1. **A test's NAME is part of the deliverable.** A pin that reds must say what it
   protects. Green with no name is unverifiable later.
2. **A pin must be watched red at least once.** A test that has never failed against a
   broken implementation has not been shown to hold anything — that is what the
   differential below is for.
3. **Reuse the existing harness.** `web/src/**/__tests__/` and the rule matrix
   `docs/rules/COMPLIANCE.md` are the project's own coverage map. A second fixture set
   for the same idea is duplication that drifts (see `ARCHITECTURE.md`).
4. **A real-browser pin reaps its browser.** A headless browser is a process *tree* —
   one run left **33 Chrome processes** alive — so start it in-turn, put the kill in a
   `trap`, and verify the count is zero before you report, on success and failure
   alike. See `AGENTS.md §Host hygiene`.

## The differential (the injection)

To prove a pin actually holds a property, break the property on purpose and watch the
pin go red. The arms are the runs; each has rules:

- **Print every arm's file hash.** A finished injection whose hash was not printed is
  not evidence.
- **Two arms with identical output are a VOID probe**, never evidence against a
  landing: the mutation did not change what ran.
- **A green arm whose mutation certainly changed behaviour is a WRONG-FILE or
  missing-pin signal FIRST.** Grep for the pin's own test file and run *that* file.
- **Restore from HEAD, and only the bytes HEAD actually holds.** `git checkout -- <path>`
  restores the *index*; a bare restore from HEAD in a tree whose change is still
  **uncommitted** WIPES the work. Either commit the slice first, or restore from an
  out-of-tree copy. (The day-1 `convert` probe was safe under this rule because the
  variant JSON was committed **and unmodified** — the restore target was exactly HEAD.)
- **Take the lock before injecting, and restore in a `trap`.** An injection left in a
  shared tree while another writer gates can be committed by that writer.
- **The first arm is the untouched baseline**, and its hash should match the author's
  reported baseline. That is provenance.

## What "verified" means

- The commit is on the **remote** branch (`origin/master`), not the local tree.
- The **dispatcher's own** gate ran on the integrated tree, raw log kept in
  `.gate-logs/gate.log`, with the test counts and the printed peak quoted.
- The **dispatcher's own** differential ran, arms hash-printed, at least one
  injection the author did not run.
- The docs (`BOARD.md`, this file, and the ledger/`COMPLIANCE.md` where relevant) were
  amended **in the same commit** as the change.

The author's gate proves the change does what the author *meant*. Only the independent
arm proves the pins hold the property. Both are needed.

## The pin matrix

| Behaviour | Pin (test) | Where | How it is watched red |
| --- | --- | --- | --- |
| An ARCH gate renders as a rounded gate, not a BLOCK rectangle | `emits a semicircular arc for ARCH and no arc at all for BLOCK` | `web/src/components/__tests__/masterHexGates.test.ts` | Re-collapse the renderer's branch: `if (gate === 'BLOCK' \|\| gate === 'ARCH')` → RED (verified) |
| An ARCH gate's round cap is on the **opposite** side of the hexside from its square stem | `puts the round side opposite the square stem — {horizontal,slanted,reversed slanted} hexside` | same file | Move `bulge` to the stem side (`cx + len*nx`) → 3 RED (verified) |
| The ARCH cap is an SVG arc and its stem is 4 points | `draws the ARCH cap as an arc, not a polygon — {…} hexside` | same file | Return a rectangle instead of the arc path → RED |
| ARCH is not the BLOCK outline | `no longer collapses ARCH into the BLOCK rectangle` | same file | Make `archGeometry().stem` equal `blockOutline()` → RED |

Note the two layers on purpose: the geometry pins hold `gateGeometry.ts`, and the
component pin holds the **wiring** — the original bug lived in the renderer's branch
condition, so a geometry-only pin would have stayed green while the UI drew squares
again. Both layers were watched red separately (see the landing below).

Coverage that already exists and should be extended rather than duplicated: the
`rules-*.test.ts` family (rules mechanics), `web/src/ai/__tests__/` (AI decisions),
`web/src/ui/__tests__/`, `web/src/persistence/__tests__/`, and the matrix in
`docs/rules/COMPLIANCE.md`.

## Per landing

### `0b1fa3d` — ARCH master-hex gates drawn as rounded gates

- **Gate:** exit `0` (cheap tier + full) · **278 passed | 2 todo (280)** in 46 files +
  1 skipped · oxlint **14 warnings / 0 errors** (the project's baseline, unchanged) ·
  peak **318300 KB** · raw log `.gate-logs/gate.log`
- **Differential 1 — the original bug** (collapse ARCH into BLOCK):
  arm A `sha256:MasterHexGates.tsx d21857ea…` (baseline) → **8 passed, exit 0**;
  arm B `22b8624e…` (branch condition re-collapsed) → **1 failed | 7 passed, exit 1**,
  RED on `emits a semicircular arc for ARCH and no arc at all for BLOCK`;
  arm C = restore from HEAD → `d21857ea…` (**identical to arm A**) → 8 passed.
  Raw logs `.gate-logs/injection-arm{A,B,C}.log`.
  Only the *wiring* pin reddened here, not the geometry pins — which is exactly the
  coverage gap that pin was added to close (see the pin matrix note above).
- **Differential 2 — the core property** (bulge on the stem's side):
  arm A2 `sha256:gateGeometry.ts 6179ab46…` → arm B2 `ee54e6e0…` → **3 failed | 5
  passed**, RED on **all three** `puts the round side opposite the square stem — …`
  cases; arm C2 restored → `6179ab46…` (identical) → 8 passed.
  Raw logs `.gate-logs/injection-arm{B2,C2}.log`.
- **Visual:** the built artifact was rendered in headless Chrome and inspected at 3×
  (`.gate-logs/board-zoom.png`). On the Plains(124)/Woods(25) edge a white **square**
  and a distinct **rounded gate** now sit side by side where both were previously
  squares; the same rounded/square pair appears at Marsh(122)/Tower(400). Chrome's
  process tree was killed in a `trap` and the count verified back to **0**.
- **Publish:** `PUBLISH` row on the board — the same bytes verified above are live at
  `/ColossusWeb/` (served asset `sha256:dd24aa29…` == `web/dist`).
- **VOID:** none. No arm pair produced identical output.

### <sha> — <row>

- **Gate:** <exit code> · <N>/<N> tests · peak <N>MB · raw log `<path>`
- **Differential:** arm A `<hash>` (baseline) · arm B `<hash>` → RED on `<named pin>`
- **VOID:** <any probe whose arms were identical, and therefore proved nothing>

## Honest records

A VOID probe, a wrong-file green, a discarded log and a verification run against a
stale tree are all **recorded, not hidden**. An honest unknown is worth more than a
confident green, and the failure modes above are information about the *process*, not
merely about the change.

## 2026-10-29 — animated presentation, writer row 18 (this commit)

COPIES: 1 — checked, no duplication (grepped: CreatureChit, BattleAnimOverlay, pendingDice.strike, diceRoll.strike, backgroundAtmosphere); BattleCreature carries all battle slots and useBattleStrikePresentation carries event identity.

- Worktree: `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\animated-mode`, branch `codex/animated-battles`, base `ccb661e95bb2bc5e653bab4ecb1f90ba221cf4d1`. Local writer evidence; dispatcher verification is recorded below. Writer worktree and branch have since been retired; original logs copied under `.gate-logs/animated-writer/`.
- Dependencies: `npm ci --prefix web`; sandbox network DNS failed (`ENOTFOUND`), then the same locked install completed with elevated network access. No dependency versions/lockfile changed. Git Bash also requires elevated execution on this Windows host.
- Full gate: `NODE_OPTIONS=--max-old-space-size=1024`, `GATE_FULL_CMD='cd web && npx oxlint && npx vitest run --maxWorkers=1'`, `GATE_LOG_DIR=.gate-logs/animated-full-final`, Git `bash.exe scripts/gate.sh` → **exit 0**, **418 passed / 2 todo (420)**, **64 files passed / 1 skipped (65)**. **16 existing lint warnings, zero errors; no new file has a lint warning. Peak NOT MEASURED** (`/usr/bin/time` absent). 28.55 seconds Vitest duration. This follows the explicit dead Strikeback clarification from `engine/__tests__/deadStrikeback.test.ts`.
- Focused final behavioral gate: `.gate-logs/animated-strikeback-focused/gate.log` → **exit 0**, **43 passed in 4 files**, including all 24 PNG/registry coverage cases. Before the dead Strikeback addition: focused 42 passed and full 417 passed / 2 todo, retained under `animated-focused-final` / `animated-full` respectively.
- Cheap-only first run printed **exit 2** (“suite did NOT run”); its PowerShell wrapper returned 1 because it did not explicitly propagate the native exit code. This is wrapper evidence, not a build failure. The later invocations explicitly `exit $LASTEXITCODE`; every full invocation above includes a successful cheap build. Raw log `.gate-logs/animated-cheap/gate.log`.
- Differential under the shared gate lock: `GATE_FULL_CMD='bash scripts/differential-animated-mode.sh'` → **exit 0**. Arm A `battlePresentation.ts` SHA-256 `52ac2e4512a890dcbfd2da118b3309677b767949f66d56e632521788ac511209` → **11 passed**. Arm B changes the settled roll ID to a new identity, SHA-256 `63f4494bba25748f8f84581bc4a02d590234526a5beab53f0b20192f13c60d7c` → **1 failed / 10 passed**, RED on `rests on board and staging, attacks once for pending→settled same ID, and handles a new instant roll`: attacking frame resets from expected 1 to 0. Arm C restores the saved uncommitted source byte-for-byte, SHA-256 identical to A → **11 passed**. Raw arm logs and hashes: `.gate-logs/animated-differential/`; gate log: `.gate-logs/animated-differential-gate/gate.log`. Subsequent Strikeback changes affect only the renderer/test; the injected source hash is still A. **VOID: none**.
- A final CSS-only adjustment paints side rings inside the SVG foreignObject boundary so clipping cannot hide them; final cheap gate `GATE_TESTS=0`, `.gate-logs/animated-cheap-final/gate.log` → **exit 2** with native exit propagation (build passed; no suite requested). No engine, serializer, network, RNG, classic image, or generated variant file is edited.
- No server/browser started by this writer. All gate/npm processes ended and the gate releases its shared lock. No push, PR or deployment performed.

Pins: `ui/__tests__/presentationMode.test.ts`, `creatureAnimations.test.ts`, `creatureAtlasLoading.test.ts`, `components/__tests__/animatedBattles.test.ts`. They cover strict preference/default/storage, shared controls, all PNG SHA/dimensions/timelines, real classic canvas/no animation fetch, unsupported capabilities, per-slot rest/move, one-shot pending and instant attacks, selection/clicks, live reduced motion, death and legal dead Strikeback, StrictMode, elapsed remounts, teardown/preference cancellation and supported asset failure notice delivery. Existing engine fixtures/helpers are reused; no second battle fixture framework or combat engine was introduced. Browser selectors and reproduction are in `docs/design/animated-presentation.md`.


## 2026-10-29 — independent dispatcher verification, animated row 18

COPIES: 1 — checked, no duplication (grepped: CreatureChit, BattleCreature, pendingDice.strike, diceRoll.strike); shared preference, battle renderer and event hook are the extension seams.

Integrated implementation `71579f344dde0c4df1cff541e7bb4c56e970a572` by fast-forward into local `codex/animated-mode`. Diff inspection confirmed zero changes under engine, net, persistence, original CreatureChit and generated variants. No push or deployment performed.

- **Own full gate exit 0**, both tiers: memory ceiling 1024 MB, Vitest maxWorkers=1, **418 passed / 2 todo**, **64 files passed / 1 skipped**, **16 existing lint warnings / 0 errors**. Vitest 29.46 s; peak **NOT MEASURED** (no `/usr/bin/time` on Windows). Raw log `.gate-logs/dispatcher-animated/gate.log`. Includes the final side-ring CSS.
- **Own distinct differential**, through gate lock with source backup and EXIT/INT/TERM restoration: injected animated as the default preference. Arm A **4 passed**, SHA-256 `0e79e8aa64f3d33c87b6f09c7f549f3cf5bd6d9fdbe539ba3bb1426b010c818d`. Arm B **3 failed / 1 passed**, SHA-256 `37d5cb7b24d9198a8cb23b5769d7c0da9d598c7030fc79876cdeda3f8534f57f`, including named RED pin `defaults to classic and validates stored values strictly`. Arm C **4 passed**, hash identical to A. Wrapper gate exit **0**; cheap command deliberately `true` for this focused injection, not a second full-suite claim. Logs `.gate-logs/dispatcher-preference/` and `dispatcher-preference-gate/`.
- **Actual Chrome before/after combat**: isolated Vite browser fixtures created through existing engine/startBattle helpers. Same commands and actual settled dice fed back through unchanged engine dispatch; complete battle state compared. Classic and animated each pass deployment movement, normal strike and legal already-slain-unit Strikeback. Animated board/overlay actually expose resting/moving/attacking timelines. Classic requests **zero** animation atlases. Classic battle before/after screenshots have **no changed pixel** (1080×929). No page errors. Reports, save fixtures and screenshots: `../output/animated-mode-verification/`; executable harness `../output/verify-animated-battles.cjs`.
- **Production build for `/ColossusWeb/`**: gate cheap tier exit **2**, typecheck/build successful, suite intentionally not requested. `.gate-logs/dispatcher-subpath/gate.log`. First attempt exposed Git Bash translating inherited COLOSSUS_BASE into a Windows path; corrected the verification environment with `MSYS2_ENV_CONV_EXCL=COLOSSUS_BASE`, then inspected built HTML for `/ColossusWeb/assets/`. No product change required.
- **Actual built-app Chrome check**: correct subpath atlas responses all 200; setup defaults classic; animated persists after reload and loads into game; toolbar switches mode within the same fight; live OS reduced motion leaves all creatures at resting frame zero across 700 ms; blocked Dragon atlas displays its precise path on the existing message surface and Art unavailable on the counter. No page errors. Report `../output/animated-mode-verification/production-report.json`; harness `../output/verify-animated-production.cjs`.
- All started Vite/preview servers and isolated browsers closed in finally handlers. Elevated Windows process inventory found no matching verification/browser/Vitest processes. Gate lock released. Writer worktree removed after clean status and log copy; writer branch retired only after ancestor verification against integrated HEAD (upstream unset before safe `git branch -d`, because feature is deliberately not on origin/master).

Scope: first consumer is battles. Other views can consume usePresentationMode later. Nonstandard variant creatures retain explicit classic capability fallback. Approved full-resolution PNG transfer size (~40.7 MB across all 72 atlases) remains a future optimization; requests are lazy. Owner visual/playtesting remains useful; engine/network semantics were not changed.

Final board reconciler: exit **1**, solely the expected local HEAD/origin-master mismatch for this unpublished feature. Remote remains ccb661e95bb2bc5e653bab4ecb1f90ba221cf4d1; retired writer branch absent and shared gate lock free. Linux uptime/ps probes are unavailable on this Windows host; their printed zero is not browser-cleanup evidence (the separate Windows process inventory above is). No new writer is being dispatched. Working tree was clean before this record amendment.
