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


## 2026-10-29 — subtle terrain motion, writer row 19 (this commit)

COPIES: 1 — checked, no duplication (grepped: terrainImageUrl, hex-clip, SafeSvgImage, usePresentationMode, useReducedMotion); MasterTerrainArt is the one terrain presentation seam.

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\terrain-motion`, branch `codex/terrain-motion`, base `f6d977bd5534e8a83c264dffa1c61920e1779fc4`. `npm ci --prefix web` installed locked dependencies; no lockfile/dependency changes. All executions use `NODE_OPTIONS=--max-old-space-size=1024` and Git Bash elevated on Windows. No full suite/browser/server run by the writer; dispatcher owns integrated full gate, actual Chrome pixels/labels and an independent differential.

- **Focused gate exit 0**, **12 passed in 1 file**, Vitest 1.19 s: `GATE_CHEAP_CMD=true`, `GATE_FULL_CMD='cd web && npx vitest run src/components/__tests__/masterTerrainArt.test.ts --maxWorkers=1'`, raw log `.gate-logs/terrain-focused-corrected/gate.log`. This invocation deliberately skips the build and is a focused behavioral result, not a full-suite claim. Peak **NOT MEASURED** (no `/usr/bin/time`).
- **Cheap gate exit 2**: real `tsc -b && vite build` completed, suite deliberately not requested. `.gate-logs/terrain-cheap/gate.log`. 88 modules; generated JS 512.08 kB / gzip 155.41 kB; CSS 31.77 kB / gzip 7.76 kB. The existing >500 kB bundle warning remains. No convert/predev/npm-build invocation and zero changed variant/art bytes.
- Initial focused gate before the SHA crop-contract pin: **11 passed**, `.gate-logs/terrain-focused/gate.log`. Adding the measured-GIF hash pin exposed a test harness path error under jsdom (`new URL` resolved to `C:\public\...`): **1 failed / 11 passed**, gate **exit 1**, `.gate-logs/terrain-focused-final/gate.log`. Corrected the filesystem read to the gate's explicit `web/` cwd via Node path.resolve; final 12-test run above passed. This was a test path failure, not a product failure or a differential, and its raw evidence is retained.
- Pins cover exact original Classic SafeSvgImage markup; unchanged full board DOM when switching back to Classic/live reduced motion; actual engine-created master board fixture with stationary text/click handlers; measured source GIF SHA-256; source-square/hex slice mapping and Woods_i base retention; correct actual resolved fallback orientation; static unfamiliar variants/solid terrain/blank sources; fixed complementary clips outside the transformed illustration; unique clip IDs across duplicate boards; stable per-hex pacing; and original static error fallback. No timers, RNG or state authority added.
- Source measurement correction: use .37 normal and .66 _i splits. The early .59 rough inverted estimate would cut Woods art ending at .651; no such crop was implemented. Mountains remain static because normal smoke overlaps its embedded label. Eligibility is deliberately restricted to the measured Default source paths.
- No writer differential run for this slice (dispatcher explicitly owns it); **VOID: none**. No server/browser started; all foreground npm/gate processes exited and the shared gate lock was released. Same unpublished feature as row18, so changelog has exactly one **1.02** entry with the additional landscape change line.

Browser hooks and exact motion/crop rationale: `docs/design/animated-presentation.md` main-board section. `.master-terrain-motion` is the sole animated group; `.master-terrain-art[data-terrain][data-art-orientation]` and `.master-terrain-label` identify the fixed regions. Classic/reduced/static paths intentionally have no extra wrapper.


## 2026-10-29 — independent dispatcher verification, terrain row 19

COPIES: 1 — checked, no duplication (grepped: terrainImageUrl, hex-clip, SafeSvgImage, usePresentationMode, useReducedMotion); MasterTerrainArt owns the sole terrain presentation path.

Integrated writer commit `e5542a37840761d7ed2bcfdb92cca9f5a45b03f3` by fast-forward into local `codex/animated-mode`. Reviewed complete renderer, helper, CSS, tests and documentation. No engine, networking, persistence or public asset changes. One existing 1.02 changelog entry extended; no extra version bump.

- **Own full gate exit 0**, both tiers: **430 passed / 2 todo**, **65 files passed / 1 skipped**, **16 existing lint warnings / 0 errors**. Vitest 29.92 s, one worker, NODE_OPTIONS 1024 MB; peak **NOT MEASURED** (`/usr/bin/time` unavailable). `.gate-logs/dispatcher-terrain/gate.log`.
- **Own crop differential**, through the shared gate lock, backup/restore trap: changed `max(width,height)` to `height` in the square-source mapping. A **12 passed**, source SHA-256 `d39c0a28e417835b02b7d15681a262cbe9b6999a6f32e192792586f019690c1b`; B **1 failed / 11 passed**, SHA-256 `7d54390ece7c043b6689f97275701336008530a08f74510aee6c01841a0661cd`, RED on named pin `maps square GIF rows through xMidYMid slice and leaves all measured art outside the fixed label crop`; C **12 passed**, hash identical to A. Focused wrapper gate exit **0**, cheap command intentionally true; this does not replace the complete gate above. Raw arms/hashes `.gate-logs/dispatcher-terrain-differential/`, wrapper `dispatcher-terrain-differential-gate/`.
- **Real Chrome independent browser/pixel verification** on a deterministic actual engine-created game (seed 517): **78 CSS motion groups**, each >=6 s, multiple distinct phase offsets; no groups in Classic or live reduced motion; local save byte-identical across cosmetic mode switches; no page errors. Original Classic and reduced screenshots are **exactly pixel-identical** to before the feature (1108×929). Comparing two animation phases changes pixels **only inside the measured illustration regions**; embedded names, numbers, gates, markers and board stay stationary.
- Pixel-check probe correction, not product failure: a strict neutral-composition equality initially detected only **five pixels with max channel difference 1** from SVG compositing rounding. Active versus static screenshots also use different Chrome antialiasing; checking each active phase against Classic therefore falsely attributes fixed antialiasing differences to motion. The corrected stationarity check compares two active phases against the same fixed artwork-region mask; **zero changed pixel outside artwork**. Neutral visual equality permits max channel rounding 1, while Classic/reduced comparisons remain exact. No product CSS was changed to mask these observations.
- Browser harness and replayable engine save: `../output/verify-terrain-motion.cjs`, `../output/terrain-mode-verification/fixture.json`. Pixel checker `../output/check-terrain-pixels.py`; captures/report, neutral/outside-region diagnostics and 10 s actual CSS-timeline GIF under `../output/terrain-mode-verification/`. The GIF preserves real per-hex phase offsets with 500 ms samples.
- All isolated browsers and Vite servers closed in finally handlers. Separate elevated Windows process inventory found no terrain verifier, isolated browser profile or Vitest processes. Existing user-owned Vite playtest server was left running. Shared gate lock free. Writer worktree clean, logs copied to `.gate-logs/terrain-writer/`, worktree removed, branch retired only after merge-base ancestry verification against integrated HEAD. No push/deployment.

Limit: only seven measured Default terrain illustrations animate; solid/blank terrains and other variant artwork remain static. Crops are source-byte pinned. Owner visual assessment remains the final taste check for subtlety.


## 2026-10-29 — remaining creature tokens, writer row 20 (this commit)

COPIES: 11→1 — useCreaturePresentation / CreaturePresentation carries the HTML+SVG creature artwork policy; BattleCreature supplies combat events and BoardCreatureIcon adapts SVG footprints (seven former HTML chit sites, three raw board-icon sites, one former battle policy).

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\creature-tokens`, branch `codex/creature-tokens`, base `0e08a83979cd26700d71b745c115889c951991e6`. Locked dependencies installed with `npm ci --prefix web`, no lockfile changes. Git Bash elevated on Windows; all gate commands propagate native status explicitly and use `NODE_OPTIONS=--max-old-space-size=1024`.

- **Focused gate exit 0: 35 passed in 3 files**, one Vitest worker, 3.22 s. `GATE_CHEAP_CMD=true`; `GATE_FULL_CMD='cd web && npx vitest run src/components/__tests__/creatureTokens.test.ts src/components/__tests__/animatedBattles.test.ts src/components/__tests__/masterTerrainArt.test.ts --maxWorkers=1'`. Raw `.gate-logs/tokens-focused-corrected/gate.log`. This is the requested focused result, not a full-suite claim. **Peak NOT MEASURED** (`/usr/bin/time` absent).
- **Final cheap gate exit 2**: actual typecheck/Vite build successful; suite deliberately not requested. `.gate-logs/tokens-cheap-final/gate.log`. 91 modules; JS 514.41 kB / gzip 156.21 kB, CSS 32.10 kB / gzip 7.80 kB. Existing >500 kB chunk warning remains. No npm dev/build/convert or public art generation/edits. Earlier successful cheap result `.gate-logs/tokens-cheap-corrected/gate.log` also retained.
- Honest reds: initial cheap **exit 1** exposed loss of discriminated-union narrowing after destructuring art-only props, `.gate-logs/tokens-cheap-initial/gate.log`; fixed by retaining/narrowing the props union (no made-up stats or non-null casts). Initial focused **exit 1**, **34 passed / 1 failed**, `.gate-logs/tokens-focused/gate.log`, used the nonexistent `.board-decision` test selector instead of actual `.board-decision-card`; corrected the selector and reran the same focused pins above. Neither failure is a differential/VOID claim.
- New `creatureTokens.test.ts` **11 pins** cover: exact original Classic HTML/SVG markup and no atlas request; custom title/class/stat/font sizes at 28/44/48; art-only accessible resting SVG with identical footprint and click-through; live mode/reduced motion and stable playback across callback changes; explicit unsupported capabilities; shared HTML/SVG error delivery (tiny exclamation plus precise notice); loud missing-error-surface integration; actual destination previews and existing titles; real MusterForm recruit command plus GameControls Undo recruit with unchanged engine dispatch; marker image/−18-degree recent-muster rotation; unknown enemy slots staying UnknownChit; and split/post-battle panel artwork/commands. Fixtures reuse existing twoPlayerGame/turn1SplitChild and engine dispatch/getLegalRecruits; no rules duplicated.
- Existing battle and terrain component pins pass unchanged. Actual Chrome pixels/terrain labels, Move/Muster fixtures, full-app notice surface, before/after recruit/undo and independent differential remain the dispatcher's work before integration. Writer ran no full suite/browser/server/differential for this slice, as brief requested; **VOID: none**.
- No source changes in engine, net, persistence, CreatureChit, SafeSvgImage, terrain artwork/seams or public assets. Hidden-information `publicViewSlots`/UnknownChit branches and player marker callers are retained. Same unpublished feature has exactly one 1.02 bump, with the third player change line. No pushed remote, PR or deployment. All started foreground processes exited and shared gate lock released.

Browser hooks: existing `.recruit-preview`, `.muster-pending`, `.muster-done` / `.enemy-muster` wrappers contain `.board-creature-icon[data-creature]` foreignObject in Animated mode, with resting `.animated-creature[data-creature][data-animation][data-frame][data-art-only="true"]`. Labeled HTML tokens retain `.animated-creature` and custom classes/titles. Classic retains the direct original leaves. Scoped failure callback is App.notify via CreatureAssetErrorContext; the context itself has no game state/error UI. Details: `docs/design/animated-presentation.md` row20 section.


## 2026-10-29 — independent dispatcher verification, creature tokens row 20

COPIES: 11→1 — useCreaturePresentation / CreaturePresentation carries all revealed HTML+SVG creature artwork policy; BattleCreature supplies combat events and BoardCreatureIcon preserves SVG footprints.

Fast-forward integrated `d72cf4d1e9e22a1902e5b3275bd0ee60e9e4521d` into local `codex/animated-mode`. Read all new components/policy, renderer/CSS/App changes, caller diffs and meaningful tests. Grep leaves legacy CreatureChit/creatureImageUrl rendering only inside the shared classic leaf/adapters (and UnknownChit imports). Verified zero changes to engine, net, persistence, public assets, CreatureChit and SafeSvgImage. Single 1.02 entry retained.

- **Own complete gate exit 0**, both tiers: **441 passed / 2 todo**, **66 files passed / 1 skipped**, **16 existing lint warnings / 0 errors**. Vitest 34.72 s; one worker, NODE_OPTIONS memory ceiling 1024 MB; peak **NOT MEASURED** (no `/usr/bin/time`). Raw `.gate-logs/dispatcher-tokens/gate.log`.
- **Own art-only differential**, through the shared gate lock with source copy and restoration trap: deliberately appended invented `0-0` stats to art-only accessible titles. A **11 passed**, SHA-256 `caab9ffec78015503034104f28d931708fdeac8465e7758da207479641ee059e`; B **2 failed / 9 passed**, SHA-256 `b50951861681a2da6b96aa22c409153872ee4b985c5d600c2366c4cf6c99a383`, named RED pins `renders tiny board icons as resting art only, with original footprint, accessible name and click-through` and `retains explicit unsupported capability titles for HTML and SVG without requesting an invented atlas`; C **11 passed**, hash identical to A. Focused wrapper gate **exit 0**, cheap command true, not a full-suite claim. Raw hashes/arms `.gate-logs/dispatcher-token-differential/` and wrapper `dispatcher-token-differential-gate/`.
- **Own actual Chrome Move/Muster fixtures**, created with existing createGame/dispatch/variant/save APIs, seed517, legal Troll muster and an AI opponent with one known public creature. Classic before, Classic after and Animated each pass actual recruit button + Undo recruit against independently dispatched engine results for complete legion/caretaker data. Clicking the pending picture itself selects the legion, preserving click-through. Destination previews, pending icons, both players' recent-recruit icons and the actual recruit picker use resting approved art in Animated; no old image/canvas in these slots and no tiny stat/name overlays. 44px picker labels have computed font >=7px. Unknown opponent slots stay masked (three UnknownChit, one revealed Troll); hidden Colossus/Hydra artwork is never fetched. Mode roundtrip leaves save bytes unchanged; reduced motion uses resting frame0; blocked Troll atlas reports its exact path on App's existing message surface and a tiny icon error marker. **No page errors**. Classic fetches **zero** atlases; Animated used eight lazy atlas requests in this scenario.
- **Classic pixel parity:** exact before/after captures for destination preview, pending muster, full picker and recruited icon; three board captures 1108×929 and full picker 1500×1018. Existing legal-ring/pop animations are frozen at fixed phases for fair comparison. Reports/screenshots/engine saves `../output/muster-token-verification/`; executable harness `../output/verify-muster-tokens.cjs`, checker `../output/check-muster-pixels.py`.
- **Own actual Chrome battle follow-up:** after the shared seam/font refactor, movement and normal/dead Strikeback attacks all use the expected moving/attacking timelines and exactly match unchanged-engine battle outcomes using the actual dice values. No page errors; nineteen lazy atlas requests now also include visible sidebar artwork. Harness `../output/verify-animated-battles.cjs`, updated report `../output/animated-mode-verification/animated-report.json`.
- Honest browser-probe corrections: original recruit lookup assumed the title was the accessible button name; changed to the actual button title selector. The existing picker backdrop must be dismissed before selecting an enemy; corrected harness interaction. Baseline screenshots were then deliberately regenerated with existing CSS animations at fixed phases. The battle harness initially refused port5173 because the user's playtest server occupies it; disabled strictPort for the isolated probe so it uses an available port. No product change or user server interruption was needed for these harness corrections.
- All isolated browsers/servers close in finally handlers; elevated Windows process inventory found no matching verification/browser/Vitest leftovers. Existing user-owned playtest server left running. Shared gate lock free; clean writer worktree logs copied to `.gate-logs/tokens-writer/`, worktree removed, writer branch safely deleted after ancestor check against integrated HEAD. No push/deploy.

Limits: approved24 roster only; unsupported variants keep explicit classic capability fallback, and hidden creatures stay unknown. Other game rules/turn behavior are unchanged.


## 2026-10-29 — owner-authorized merge and push

Owner: “merge and push please”. Fetched origin/master, verified it remained `ccb661e95bb2bc5e653bab4ecb1f90ba221cf4d1`, and `git pull --rebase origin master` left the tested feature unchanged. Version check against origin/master passed **1.01 → 1.02**, exactly one entry. Fast-forwarded local master to verified feature tip `46f0ae806404a8f72456652c6cfab067f65d778c` and pushed successfully (`ccb661e..46f0ae8 master -> master`).

Pre-push cheap gate: typecheck/build successful, **exit 2** (suite deliberately not rerun; product code unchanged since the independent 441-pass full gate above), NODE_OPTIONS1024 MB, raw `.gate-logs/merge-push-cheap/gate.log`. This is a build result, not a new full-gate claim. This following record-only commit updates the board/ledger and is pushed with the same authorization. No deployment performed.

COPIES: 11→1 — shared CreaturePresentation policy remains the single revealed-creature artwork seam; this landing record changes no product code.


## 2026-10-29 — full-width title screen, writer row 21 (this commit)

COPIES: 1 — checked, no duplication (grepped: SetupScreen, VARIANT_META, cappedRows, onVariantChange, LobbyPanel); SetupScreen remains the single setup controller.

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\title-screen`, branch `codex/title-screen-writer`, base `f4ff8b7b79a0984af52505e5bd169d8d9f26f0ad` (origin/master at dispatch). Locked `npm ci --prefix web`; no lockfile changes. Every gate uses `NODE_OPTIONS=--max-old-space-size=1024`, explicit native exit propagation and elevated Git Bash on Windows.

- **Focused gate exit 0: 10 passed in 2 files**, Vitest 1.88 s, one worker. `GATE_CHEAP_CMD=true`, `GATE_FULL_CMD='cd web && npx vitest run src/components/__tests__/setupScreen.test.ts src/version/__tests__/version.test.ts --maxWorkers=1'`. Raw `.gate-logs/title-focused-final/gate.log`. This is focused behavior/version evidence, not a full-suite claim. **Peak NOT MEASURED** (no `/usr/bin/time`). Earlier setup-only gate also passed **5/5**, `.gate-logs/title-focused/gate.log`.
- **Final cheap gate exit 2**: real `tsc -b && vite build` passed, suite deliberately not requested. `.gate-logs/title-cheap-final/gate.log`. 92 modules; JS 517.78 kB / gzip 156.97 kB, CSS 42.02 kB / gzip 9.91 kB. Existing >500 kB chunk warning remains. Initial cheap also passed (exit 2), `.gate-logs/title-cheap-initial/gate.log`. No npm dev/build/convert invoked.
- SetupScreen's **5 meaningful pins** cover the exact edited onStart payload (human/AI profile semantics retained), original minimum two and 3/6/9 variant caps, a real existing FakeHubServer/HubSession proving the same lobby node/one connection survive setup and appearance edits and online creation receives variant/cap, real saved metadata/continue callback, and native hero anchors with always-mounted focusable targets plus one local decorative hero in both modes. No brittle CSS snapshots or duplicate setup/rules/network harness. Tests create only in-memory fake rooms; no live connection/network request.
- Approved image source/destination SHA-256 both printed and identical: `ac8d94c20db0db9a17026fb63f0884a9f5f4a52069e807115d4f25849c48d643`; actual PNG dimensions **1983×793**, **2,395,586 bytes**. Byte-for-byte copy, no processing. Dispatcher generated/viewed/approved it with built-in imagegen. Final prompt retained in `docs/design/title-screen-image.prompt.txt`; provenance and deployment URL in `docs/design/title-screen.md`.
- Diff review: original setup controller/meta/cappedRows/add/variant truncation and start payload remain. LobbyPanel, session/network, engine, save code, App, battle/terrain/creature art and game components are unchanged. Removed only obsolete title/player-row CSS; shared button/focus/brand-inline/lobby-panel declarations retain original values. New setup.css is scoped to setup. One new **1.03** entry dated 2026-10-29 above existing 1.02.
- Dispatcher baseline measured old 832px title width at 1440/1920 and 15px horizontal overflow at 360. Actual responsive Chrome screenshots and no-overflow/control visibility at 360/390/768/1440/1920, keyboard/contrast, saved load/local start, in-game exact pixel comparison, production `/ColossusWeb/` asset URL and integrated full suite remain the dispatcher's independent verification. Writer does not claim those from jsdom/build. No writer browser/server or full suite/differential run for this slice; **VOID: none**. No failed writer gate run.
- All started npm/gate foreground processes ended; shared gate lock released. No push, PR or deployment. Static hero introduces no new motion, dynamic sprite fetches or external image dependency.

Hooks: `.setup-hero-art`, `.setup-resume`, `.setup-workbench`, `#local-setup`, `.setup-player-row`, `#online-lobby`, `.setup-appearance`. Accessible field/action labels retained; all local/online anchor hrefs target real persistent sections. Layout/art rationale: `docs/design/title-screen.md`.


Row 21 follow-up: independent Chrome review found the fixed atmospheric lattice painting over the unpositioned campaign form. Added only `position: relative; z-index: 1` to `.setup`; no body, atmosphere or game stacking changes. Cheap gate **exit 2**, typecheck/build successful, `.gate-logs/title-stacking-cheap/gate.log`, 1024 MB ceiling. No new test/full-suite run for this two-line CSS correction; dispatcher verifies final pixels/tree independently.


Row 21 contrast follow-up: independent review measured only 2.82:1 at the original bright hero CTA stop. Scoped `.setup-primary-action` and `.setup button.primary` to white-on-dark copper (`#92562d`→`#71381f`, hero hover `#9d5f32`), retaining the highlight border, global game buttons and disabled/layout semantics. Cheap gate **exit 2**, typecheck/build passed, 1024 MB ceiling; raw `.gate-logs/title-contrast-cheap/gate.log`. No new behavior test for this surgical color change; dispatcher owns final full/browser checks.


## 2026-10-29 — independent dispatcher verification, title row21

COPIES: 1 — checked, no duplication (grepped: SetupScreen, VARIANT_META, cappedRows, onVariantChange, LobbyPanel); the existing setup controller remains authoritative.

Integrated writer's initial `8ea1a20` and the measured compositing/contrast corrections through `a4293f856a42965e1f5cc356053e74fa9687bf2d` into local `codex/title-screen`. No App, engine, session/network, serializer or game-board component changes. New illustration matches approved generated bytes; scoped CSS replaces old title-only declarations and keeps shared game values.

- Initial complete gate **exit0**, 446 passed/2todo, 67 files passed/1skipped. Review then found the atmosphere's positioned layer painted over unpositioned campaign controls, and new13px primary text had2.82:1 contrast at the brightest original stop. Writer fixed title-only stacking and darkened title-only copper primaries; no game CSS changed.
- **Final complete gate exit0**, both tiers: **446 passed / 2 todo**, **67 files passed / 1 skipped**, **16 existing lint warnings / 0 errors**, Vitest33.14s, maxWorkers1, NODE_OPTIONS1024MB. Peak **NOT MEASURED** (no `/usr/bin/time`). Raw `.gate-logs/dispatcher-title-final/gate.log`; initial `.gate-logs/dispatcher-title/gate.log` retained.
- **Own isolated payload differential**, same final commit/file hash as integrated parent, in retained writer worktree to avoid HMR mutations in the user's running app. Shared gate lock held, cheap commandtrue, restoretrap. Injected unconditional aiProfileId even when switching an AI commander to human. A **5passed**, SHA-256 `f70fe75c91f164313e4c5119ac347649e738973e96d56e82d92b3d342212eb84`; B **1failed/4passed**, SHA-256 `8799a3639fada72fb259d970e26a0267edb9b529a264239b78d1ec99b71c2dff`, named RED `starts with the exact edited variant/player payload, retaining human versus AI profile semantics`; C **5passed**, hash identical toA. Wrapper gate **exit0**, focused only. Logs copied under `.gate-logs/title-writer/dispatcher-title-differential/` and `dispatcher-title-differential-gate/`. Harness `../output/verify-title-differential.sh`.
- **Actual Chrome**: before setup832px at1440/1920, document375px at360 (15px overflow). Final setup uses full viewport at **360,390,768,1440,1920**; document width equals viewport, no offscreen visible input/select/button/link. Reviewed desktop/mobile screenshot composition, including saved-game and nine-player mobile forms. Native hero action works from keyboard; Appearance opens and mode choices persist; lobby stays available; player caps3/6/9 and minimum2 work; starting a real Default game retains edited Ada/Bryn human selections; real saved-game continuation restores fixture players. **No page errors**. Same seed517 saved game before/after board captures1108×929 have **no changed pixel**. Harness `../output/verify-title-screen.cjs`, reports/captures `../output/title-screen-verification/`. Repeated final check after CSS corrections for visual proof.
- **Production subpath**: typecheck/build gate **exit2**, suite intentionally not requested, COLOSSUS_BASE=/ColossusWeb/ with Windows MSYS2_ENV_CONV_EXCL=COLOSSUS_BASE; `.gate-logs/dispatcher-title-subpath/gate.log`. Built Chrome preview loads `/ColossusWeb/title-screen/colossus-landscape-v1.png`, status200 and exact SHA-256 `ac8d94c20db0db9a17026fb63f0884a9f5f4a52069e807115d4f25849c48d643`. Actual computed primary button/link stops contrast **5.50 and8.64**, hero hover **4.80**. No page errors. Harness `../output/verify-title-production.cjs`, `production-report.json` under capture directory.
- All own browser/preview/Vite servers close in finally. Elevated Windows inventory found no matching title verifier/isolated browser/Vitest leftovers; user-owned playtest server left running. Shared lock free. Clean writer worktree logs copied to `.gate-logs/title-writer/`, worktree removed and branch deleted only after ancestor verification. No push/PR/deploy for this new feature. Existing source/master remains published animated mode1.02; new title branch adds1.03.

Parallel owner-requested task: output-only generation/export of14 additional variant creatures is handled separately; it changes none of this verified product tree or the approved standard24.


## 2026-10-29 — independent output verification, variant studies row22

Parallel author delivered14 new variant creatures,42 atlases,84 state GIFs and336 timeline slots. Product source/registry and approved standard24 were read-only; no product gate rerun is claimed for output artifacts.

- Independent `../output/verify-variant-assets.py` derives the exact14-name set from shipped variant metadata minus the standard roster; checks1024×512 atlases, eight valid durations/state, every cell nonblank and each state containing changing frames, at least8px safe margins (actual minimum **24px**), correct GIF total durations, and **all72 existing atlases byte-identical** to approved inputs. Report `../output/variant-independent-audit.json`.
- Independent actual Chrome `../output/verify-variant-gallery.cjs` steps all **336 timeline slots**, examining **672 full/counter canvas views**. All nonblank, **zero external network requests**, **zero page errors**, no390px horizontal overflow. Report `../output/variant-independent-gallery.json`. Isolated browser closed in finally, Node ceiling1024MB/Chrome512MB. Author's own atlas/browser/control audit also retained in collection QA.md and JSON files.
- Visual overview inspected. Original nominal Wraith sheet crossed its256px row boundary; author had already caught it, selected measured white-gutter source boxes (first [0,0,264,282]), and final packaged figures retain complete tails. All final cells independently meet margins. Explicit holds/resequencing omit contacting source poses rather than painting/warping limbs. Knight supporting-source exception and targeted revisions are documented.

Offline gallery and65.4MiB zip are under `../output/variant-creature-collection` and `../output/variant-titan-creatures-full-color.zip`. Runtime integration remains pending; this satisfies the parallel creation request with reviewable assets. Complete built-in image_gen initial/revision prompts are supplied with the collection. No CLI/API-key fallback and no deployment.

COPIES: 1 — reuses the existing approved whole-frame asset production/export method; no new product seam.


## 2026-10-29 — visible Animated checkbox/default, writer row 23 (this commit)

COPIES: 1 — PresentationModeToggle and presentationMode.ts carry one shared native checkbox/store for title navigation and game toolbar.

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\animated-checkbox`, branch `codex/animated-checkbox`, base `7cb56e58be93411c935ca38e6fdfcd92a217e020`. Locked `npm ci --prefix web`, no dependency/lockfile change. All gate runs use NODE_OPTIONS=--max-old-space-size=1024, elevated Git Bash and explicit native status propagation.

- **Focused gate exit 0: 53 passed in 6 files**, maxWorkers=1, Vitest 6.33 s. Cheap command deliberately `true`; full override selects `ui/__tests__/presentationMode.test.ts` plus component `animatedBattles`, `setupScreen`, `engagementChoice`, `creatureTokens`, `masterTerrainArt` test files. Raw `.gate-logs/checkbox-focused/gate.log`. This is a relevant focused result, not a full-suite claim. **Peak NOT MEASURED** (`/usr/bin/time` absent).
- **Cheap gate exit 2**: actual tsc/Vite build passed, suite deliberately not requested. `.gate-logs/checkbox-cheap/gate.log`. 92 modules; JS 517.33 kB / gzip 156.96 kB, CSS 42.74 kB / gzip 10.05 kB. Existing large-chunk warning remains. No npm dev/build/convert or artwork change. No failed writer gate run.
- Preference pins now explicitly require Animated for missing/invalid/private storage, explicit stored Classic on read/reload, unchanged strict write validation and subscriptions, and a fresh native checked checkbox/static snapshot versus explicit Classic unchecked. The two-control test uses actual MouseEvent clicks to prove one store synchronizes both native checkboxes and persists Classic. No checkbox-specific store was added.
- Setup pins now use the visible checkbox rather than the old select. A new placement/persistence pin requires one checked control in title navigation outside closed Appearance, retained Background control in details, Classic after uncheck/remount and one unchanged lobby connection. The existing hero-both-modes test explicitly seeds Classic before switching to Animated, preserving its two-mode guarantee. Exact start payload, caps, saved continue and online variant flow assertions remain unchanged.
- Static snapshots now call the same getPresentationMode getter as clients, respecting both new default and explicit choices. The client-rendered app has no production SSR server. Existing engagement seat/authority SSR tests now explicitly seed Classic so they remain independent of the product default and need no artwork/error provider; **none of their original assertions were changed**. Classic battle/terrain/creature renderer tests retain explicit Classic setup and all pass. No blanket replacement of Classic expectations.
- Diff scope: renamed PresentationModeSelect to PresentationModeToggle; same store/key and original App.notify context, no rules/engine/save/net/asset changes. Shared native 17px checkbox styles override broad setup input sizing with explicit setup specificity, copper accent and focus. Responsive grouping keeps checkbox/version available at phone widths; actual browser width/keyboard checks belong to dispatcher. Existing 1.03 entry gains one change line; 1.02's historical Classic-default wording is retained.
- Dispatcher owns fresh browser Animated, explicit saved Classic, checkbox Space-key/persistence, 360/390 navigation/no overflow, gameplay boundaries, integrated full suite and distinct negative pin. Writer ran no browser/server/full suite/differential; **VOID: none**. All started foreground npm/gate processes ended and shared gate lock released. No push or deployment; unrelated Variant14 output artifact untouched.

Current hook: `input[type="checkbox"][aria-label="Animated mode"]`; `.presentation-mode-toggle` wraps it, and `.setup-preferences` groups the title control with What's new. Current design/default docs updated; historical landing/release records remain historical.


## 2026-10-29 — independent checkbox/default verification, row23

COPIES: 1 — PresentationModeToggle and presentationMode.ts remain the one shared native control/store.

Integrated eff43deb7d2ce83625f82380be70d53e121d32cf into local codex/title-screen. Reviewed new checkbox, responsive grouping, coherent static/client snapshot getter, preference tests and explicit Classic seeding in unchanged SSR authority assertions. No game/save/net/art changes.

- Own complete gate **exit0**, **449 passed/2todo**, **67 files passed/1skipped**,16 existing lint warnings/0errors, Vitest27.99s, one worker/NODE_OPTIONS1024MB; peak **NOT MEASURED**. `.gate-logs/dispatcher-checkbox/gate.log`.
- Own isolated same-commit negative pin under shared lock: changed absent/invalid preference fallback back toClassic. A **6passed**, sourceSHA `2cb15793124e48e0a05915cf01aceee3076454ffce48cb4463802cad6e831a86`; B **4failed/2passed**, SHA `062ceffd7fdef2cdbf0a3b76f4a5483bc464592c9cf1d73a6697169613fd667b`, including named RED `defaults to animated and validates stored values strictly` and native checked snapshot; C **6passed**, hash identical toA. Wrapper gate0, focused cheap commandtrue. Restoretrap and same-commit writer worktree prevent mutation of user Vite tree. Logs copied to `.gate-logs/checkbox-writer/dispatcher-animated-default-differential/` and `dispatcher-default-differential-gate/`.
- Own real Chrome fresh/invalid/blocked preference storage defaults to checked Animated; native checkbox outside collapsed details; explicit Classic survives reload; Space toggles/persists; visible at1440/768/390/360 with nooverflow. Game toolbar uses same control and artwork updates; Space never advances phase or changes save bytes. No page errors. `../output/verify-animated-checkbox.cjs`, report/screenshots `../output/animated-checkbox-verification/`.
- Source restores exactly, shared lock free, clean writer worktree logs copied and writer branch/worktree safely retired after ancestry check. No push/deploy. Historical old select/default browser scripts describe earlier releases; current control hook is input[type=checkbox][aria-label="Animated mode"].

## 2026-10-29 — writer modern Animated main board, row24

COPIES: 3→1 — MarkerArtwork carries Animated HTML/standing/moving legion art; MasterHexGates keeps one canonical alternating-edge mark enumeration with Classic/Modern shape leaves.

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\modern-board`, branch `codex/modern-board`, base `d6a3a5b5f12cf0ea218c5e84e78333d4e6a4bed2`. Locked `npm ci --prefix web`; no dependency/lockfile change. All gates use NODE_OPTIONS=--max-old-space-size=1024, elevated Git Bash and explicit native exit propagation. No npmdev/build/convert, push or deployment.

- **Final focused gate exit0: 70 passed in6files**, one worker, Vitest10.74s (tests6.86s). Raw `.gate-logs/modern-focused-final/gate.log`. GATE_CHEAP_CMD=true; GATE_FULL_CMD selects component modernBoard, masterHexGates, masterTerrainArt, creatureTokens, animatedBattles and setupScreen tests with --maxWorkers=1. This is a focused result, not the integrated suite. **Peak NOT MEASURED** (/usr/bin/time unavailable).
- **Final cheap gate exit2**: actual tsc/Vite passed; suite deliberately not requested. `.gate-logs/modern-cheap-final/gate.log`:98modules; JS528.43kB/gzip160.52kB, CSS43.71kB/gzip10.27kB. Existing >500kB bundle warning remains. Earlier writer initial cheap2 and focused0 are retained under modern-cheap-initial/modern-focused. No writer red gate or VOID run.
- New modernBoard.test.ts has21meaningful pins: exact nine PLAYER_COLORS and independently computed ink contrast≥4.5, captured/native full IDs with same owner face and distinct full-ID heraldry, unchanged Classic canvas props/roundtrip and no modern raster-marker loads; actual canonical ARCH/BLOCK/arrow geometry, alternating edges, reversed entrances, actual triangle tip direction and single/triple counts; registry covers all shipped terrain names, PNG header/delivery hashes match accepted provenance; Classic board roundtrip/hit polygon/click authority; stationary labels and modern art retained under live reduced motion; metadata-exact final gate overlay count/order before legions; Abyssal9 and unique scoped defs across two boards; required terrain error delivery and explicit unknown/custom capability fallback.
- Original masterHexGates pins remain unchanged. Standalone measured source-GIF crop/orientation/hash pins remain unchanged. The old full-board reducedMotion==Classic assertion was narrowly updated because Animated now has new label-free art: reduced motion must retain modern visuals with no motion class. Exact Classic roundtrip remains required. The existing creatureTokens marker-image assertion now checks the same full-ID vector/owner crest through recruit and correct updated height rather than expecting an obsolete raster. Actual muster/undo dispatch and battle orientation/event assertions remain intact.
- Bounded real Chrome/Vite API preview at1440×1080 with live reduced-motion preference, real engine-created save fixture and Load saved game:96new terrain scenes,360gate marks,3native markers,0page errors. WebSockets were blocked (no live rooms). Screenshots `.gate-logs/modern-preview-1440.png` and `modern-board-preview.png`; preview harness `.gate-logs/preview.cjs` closes browser/server in finally, all runs exit0. Visual review corrected number-pill overlap with lower gate corridor and compressed long terrain names within fixed label bounds. Independent WIP review corrected count type from5.88px to9.24px at28px footprint (33viewBox units,18radius badge), keeping full ID distinct.
- Exact approved12PNG deliveries copied unchanged (894571bytes); no original GIFs/creatures/variant files edited. Prompt, source-sheet hash, delivery crop/bounds/hashes and packaging recipe are committed under docs/design; recipe is documentation/reference, not part of any gate. Known art failures route through existing App.notify context; missing callback is a loud integration error. Unknown terrain uses an explicit Classic capability fallback, not a fabricated vignette. New labels/gates/decorations are pointerEvents none; original polygon geometry and command paths remain unchanged.
- Diff changes presentation components/helpers/styles, new artwork and docs only. No engine/rules/net/save/variant changes. Same unpublished1.03 gains one player line. Subsequent battle-land overhaul is deliberately sequential row25; shared marker art naturally appears in its existing sidebar, but combat terrain/events are unchanged.
- Dispatcher owns complete suite, independent negative pin, Classic pixel/DOM comparison,1440/1920/mobile/Abyssal9 browser layouts, nine-color/captured-owner palette, mode/reduced-motion behavior and actual Move/Muster engine comparisons. Writer preview is not a claim of these independent checks. All writer-started processes ended, shared lock released; no continuing server/browser. See design/modern-board.md for hooks and limitations.

## 2026-10-29 — row24 destination-preview fixture follow-up

COPIES: 1 — checked, no duplication (existing getMovesForSelected/bestRecruitAt remain the engine oracle; only one preview fixture changed).

Dispatcher's integrated gate was RED: one destination-preview test failed,469 passed/2todo, log `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\.gate-logs\dispatcher-modern-board\gate.log`. Cause: twoPlayerGame(1) seeds setup only; doneSplit's dispatch uses its separate RNG input, default Math.random, to settle the movement die. Depending on that unseeded die the opening split has no recruit-bearing legal destinations. Rendering correctly returned no preview; the fixture incorrectly required one for every roll.

The fixture now supplies dispatch's dice RNG explicitly (()=>0.99, verified roll6) and compares all24 actual rendered preview sprites with getMovesForSelected/bestRecruitAt. Original resting/art-only/title/pointer-event assertions and recruit/undo command pins remain intact. No engine, product rendering, geometry or asset changed; production bundle bytes are identical.

- Focused gate0:11 passed in creatureTokens.test.ts, one worker, NODE_OPTIONS1024, Vitest1.62s; peak NOT MEASURED. `.gate-logs/modern-preview-fixture-focused-fixed/gate.log`. Cheap override true; full override `cd web && npx vitest run src/components/__tests__/creatureTokens.test.ts --maxWorkers=1`.
- First follow-up gate1 is retained at `.gate-logs/modern-preview-fixture-focused/gate.log`: the new equality selector accidentally selected both wrapper and sprite data-creature hooks (48 vs24). Narrowed to actual .animated-creature before the successful gate; no assertion was removed or expectation weakened.
- Cheap gate2: typecheck/Vite passed, suite not requested; `.gate-logs/modern-preview-fixture-cheap/gate.log`. Same98modules/JS528.43kB/gzip160.52/CSS43.71kB/gzip10.27 and existing chunk warning as previous landing.

Independent full gate remains dispatcher-owned. No browser/server started in this follow-up, gate lock released, no push/deploy. Same row24 and unpublished1.03; this test determinism fix adds no separate player-facing release line.

Row24 visual follow-up from independent Chrome: top-edge final-layer gates covered long terrain-name ends. Caption capsules are now30units wide at cy+13..24 with long text fitted to28units/baseline21.2; landscape stays48×34 at cy+23..57. Writer's bounded Chrome probe sampled each caption's actual fill against all gate primitive fill/strokes (0.3screen-pixel grid), finding zero intersections on96hexes/360marks. Axis-aligned bounds alone falsely reported diagonal overlaps; those were checked against actual SVG geometry. Updated screenshots remain `.gate-logs/modern-preview-1440.png` / `modern-board-preview.png`; geometry harness `.gate-logs/preview-label-geometry.cjs` closes browser/server in finally. No page errors or live WebSocket calls. Parent owns independent screenshot confirmation and Abyssal9 checks.

Final combined follow-up focused gate0:32passed in creatureTokens/modernBoard,10.53s, maxWorkers1/NODE_OPTIONS1024, peak NOT MEASURED; raw `.gate-logs/modern-followup-focused-final/gate.log`. Final cheap gate2 after visual change: tsc/Vite passed,98modules, same reported bundle sizes and existing chunk warning; `.gate-logs/modern-followup-cheap-final/gate.log`. This supersedes the earlier fixture-only tree's byte-identity observation: the final JS hash changes for caption/art coordinates, while all game logic remains unchanged. No index.css edit (dispatcher owns toolbar wrap), no rules/engine/assets/network change.
