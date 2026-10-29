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

### Dispatcher verification: modern main board (2026-10-29)

COPIES: 3→1 — MarkerArtwork carries HTML, standing and moving legion art; the existing MasterHexGates placement loop owns all gate geometry.

Reviewed d002136 and f148dc6 independently. First full run exposed an existing unseeded movement-dice fixture (469 passed/1 failed); the writer pinned a real six and strengthened the recruit-preview assertion against getMovesForSelected/bestRecruitAt. Final integrated full gate **0**, **470 passed/2 todo**, **68 files passed/1 skipped**, 16 existing lint warnings/0 errors, 43.51s, Node1024/maxWorkers1; peak **NOT MEASURED** (timer unavailable). Raw logs `.gate-logs/dispatcher-modern-board{,-fixed}`.

Independent captured-marker negative under gate/lock in the isolated writer worktree: original MarkerArtwork SHA256 `8b6c4da5fe303ecc36ddba2216b6a10954cc8b30c644fa94bb6285bdbf7d00c8`; A1 passed; removing the explicit owner override produced SHA `2f7817a8b57b30a251e71ea7adebfd22019b8e361e0b175388f98548c5c74d4d` and B failed specifically on the captured Bu01 color assertion; C1 passed after trap restoration to the original hash. Overall gate0; logs preserved under `.gate-logs/modern-board-writer`.

Own Chrome checks (`../output/verify-modern-board.cjs`, `verify-modern-details.cjs`, updated `verify-muster-tokens.cjs`) checked Default96hex/360gate marks and Abyssal9216hex/816marks against actual board metadata including type, edge and direction. Both Classic1108×929PNG captures are pixel-exact against pre-change captures. All nine exact owner fills, full IDs and counts, captured IDs under one owner, required-art local failure plus App notice, and 1920/1440/768/390/360 layouts passed with zero page errors. The in-game toolbar now wraps (one CSS property) to keep its checkbox and controls reachable on narrow screens; board Classic pixels remain unchanged. Real recruitment and undo compare full legion/caretaker results against dispatch, enemy unknown slots remain hidden, and reduced motion freezes supported sprites. Reports/screenshots remain in `../output/modern-board-verification` and `../output/muster-token-verification`.

## 2026-10-29 — writer Animated tactical battlelands, row25

COPIES: 2→1 — battleEdgeGeometry owns endpoints/tangents/inward normals for Classic and Modern hexside styles; ModernBattleHex is the single modern cell seam.

Writer worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\modern-battle`, branch `codex/modern-battle`, rebased without conflicts onto dispatcher-verified local base `6a6fe7407a9e0481fab89e1a12fe22091b074496`. Locked npm ci completed without dependency/lockfile changes. All gates use elevated Git Bash, NODE_OPTIONS=--max-old-space-size=1024 and explicit native exit propagation. No npm dev/build/convert, full suite, push or deployment.

- **Final focused gate exit0: 32 passed in four files**, one worker, Vitest 2.63s. `.gate-logs/modern-battle-focused-final/gate.log`. Cheap override true; full override selects modernBattle.test.ts, animatedBattles.test.ts, rules-tower-abyss-battle.test.ts and battleland.test.ts with --maxWorkers=1. This is focused evidence, not a complete-suite claim. **Peak NOT MEASURED** (/usr/bin/time unavailable).
- **Final cheap gate exit2**: actual tsc/Vite passed; suite deliberately not requested. `.gate-logs/modern-battle-cheap-final/gate.log`: 101 modules, JS536.53kB/gzip163.00, CSS45.33kB/gzip10.56. Existing >500kB bundle warning remains. Initial focused0 (23 tests), initial cheap2 and rebased focused0 (32 tests) remain in modern-battle-focused, modern-battle-cheap and modern-battle-focused-rebased. No red or VOID writer gate.
- Eleven new meaningful tests pin eight supplied PNG hashes/dimensions/URLs, exact shipped terrain/elevation inventory, all six owner-side normals and invalid geometry, distinct native cliff/wall/dune/slope/river shapes, unchanged Classic mode roundtrip, actual Desert/Mountains/Swamp built-cell fields and clicks, Tower/Abyss geometry and dual hazards, unchanged unit centers/entry rims, live reduced motion and required-art local marker plus existing error callback. Existing animation/event authority and Tower/Abyss rule pins remain unchanged.
- Final-source own real Chrome preview: Default Jungle, Default Desert and Abyssal6 Abyss, 27 cells each, respectively 10/11/7 bounded hazard illustrations, no page errors. Selected actual defender in Abyss to inspect the seven start cells and both wall/river boundaries. Harness `.gate-logs/battle-preview.cjs` uses a Vite API server on its own ephemeral port, blocks WebSockets, Node1024/Chrome512 and closes browser/server in finally. Screenshots `.gate-logs/battle-preview-{Jungle,Desert,Abyss}.png` at1440x1080/full page. Writer visual inspection is not independent verification.
- Assets: eight original supplied 256px RGBA PNGs, 593328 bytes total, copied unchanged. Prompt/provenance committed next to assets. No old GIF, approved creature atlas, generated variant, map/rule, engine/net/save, App or mainboard source changed. New tactical module scopes art URLs through BASE_URL. Native labels, side cues and rims are pointer-transparent; exact existing filled polygons own clicks. Required-image failure reports its precise path through existing App.notify and marks the local cell. Plains/Tower use vectors; no unrelated masterboard landscape is substituted.
- Classic retains its original paint fragment and clip IDs. The last source edit folds duplicate valid-hex side math into battleEdgeGeometry for both render styles; original glyph expressions remain. Dispatcher had already independently checked the prior source commit's twelve Classic pixel captures, all cell/hazard metadata and real movement/strikebacks; that evidence predates this final extraction and is not represented here as final-source verification. Dispatcher owns final integrated full suite, Classic pixel comparison, actual movement/strike authority, responsive/error/reduced-motion checks and distinct negative pin.
- Existing unpublished1.03 receives one player-facing line; no extra version. Brief/design/seam index/board/ledger updated. All writer-started processes ended, gate lock released, worktree remains for dispatcher verification. No deployment or continuing server/browser.

### Dispatcher verification: modern battlelands (2026-10-29)

COPIES: 2→1 — battleEdgeGeometry supplies Classic and Modern owning-side vectors; ModernBattleHex owns the Animated tactical surface path.

Reviewed final `2dfae12c466dc3546c6d1e7902a2886fa01147f7`, including the final Classic geometry extraction. Integrated full gate **0**, **481 passed/2 todo**, **69 files passed/1 skipped**, 16 existing warnings/0 errors,40.72s,Node1024/worker1; peak **NOT MEASURED** (timer unavailable). Raw `.gate-logs/dispatcher-modern-battle/gate.log`.

Own isolated gate/lock differential reversed the x component of the owning-side normal: A1 passed at SHA `2451a7eab219b9fa956b4d97b13f05851200f2d6bf832e1016b11c0b441838d1`; B1 specifically failed `keeps own-side normals inward on all six directions and rejects invalid geometry` at `3449a8ddb498577e0be7f70f76092d59ce2d4ae6ff31e8bb144e447280432b11`; trap restored the original bytes and C1 passed. Overall gate0; logs preserved in `.gate-logs/modern-battle-writer` before retiring worktree/branch (recovery tip2dfae12).

Own Chrome `../output/verify-modern-battle.cjs --after` on final source captured all12 shipped themes (Abyssal9 definitions audited equal to Default/Abyssal peers), checked324 actual cells and every owning-side hazard against battleLand metadata, and matched all12 Classic1080×929 images pixel-exact against the pre-change renderer. Actual unit selection paints exactly legalBattleMovesFor destinations; actual cell clicks match the full dispatch battle result for Desert/Mountains/Swamp/Tower/Abyss. Tower predeployment, Abyss20Tower2/6Drift1/D4Drift0 and all24 dual wall+river boundaries remain visible and metadata-exact. Required Drift PNG failure marks local cells and uses existing App notice;1440/768/390/360 layouts stay within viewport; zero page errors. Reports and samples in `../output/modern-battle-verification`.

Updated `../output/verify-animated-battles.cjs` for the native checkbox and explicit Classic preference before loading. On final source BOTH Classic and Animated real movement, normal strikes and slain-unit strikeback match full unchanged engine battle results, including dice/damage/turn. Animated attack/move timelines are observed; Classic fetches zero animation atlases. Zero page errors in both. Raw reports `../output/animated-mode-verification/{animated,classic-after}-report.json`. Production subpath/content check is grouped with the subsequent camera landing.

## 2026-10-29 — writer battle camera, row26

COPIES: 1 — checked, no duplication (App.putState, local/remote commit setters and visible battle branches); useBattleCamera is the shared presentation-boundary observer.

Writer worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\battle-camera`, branch `codex/battle-camera`. Initial base6a6fe7407a9e0481fab89e1a12fe22091b074496 rebased conflict-free onto independently verified row25 d11f23a0bf4be91e3fdfa2bb7ff090a1ea481b5f before final checks. All row24/25 source/history retained. Locked npmci with no lock/dependency change; NODE_OPTIONS1024, elevated Git Bash/native status propagation and one gate worker. No npmdev/build/convert, full-suite claim, push or deploy.

- Focused gate0:33 passed in3files (battleCamera, animatedBattles, engagementChoice), maxWorkers1. Final polished run `.gate-logs/camera-focused-polished/gate.log`, Vitest2.33s; earlier focused-initial13 and focused-final33 all exit0. Peak NOT MEASURED (/usr/bin/time unavailable). Final successor run/log is camera-focused-landing after the selected-frame/error-surface refinements.
- Fifteen new camera tests exercise real engine engagement→fight→concede, removed losing legion and final winner; no boundary on notice/duplicate battle; off-center/scrolled mathematical center mapping after rotation; safe SVG ID/href/clip references and stripped controls; preserved already-rendered canvas bitmap; immediate actual state/DOM and unchanged state bytes; Classic instant/default/live mode, reduced opacity-only150ms; load/replacement/null; resize/scroll/uncheck/unmount cancellation; supersession/coalesced never-painted battles; required capture/animation errors through injected existing notice callback. Original battle animation/dead Strikeback/engagement authority assertions remain unchanged. Native animation promises are controlled in unit tests, no fake engine rules or timing load.
- Real bounded Chrome/Vite API preview at1500x1000 used actual App dispatch and real engine fixtures, WebSockets blocked: Animated and Classic actual entry and exit saved states exactly equal engine dispatch, focus hook hex7, Animated has820ms native zoom/turn/crossfade, Classic no overlay, snapshots removed after completion,0page errors. Writer paused native keyframes for midpoint PNGs; artifacts `.gate-logs/camera-browser/{report.json,entry-midpoint.png,exit-midpoint.png,animated-battle.png,classic-battle.png}`, harness camera-preview.cjs. First preview attempt's broad live-board selector matched the inert decorative SVG too; corrected to `.board-pane` scope, browser/server cleanup ran on failure. No product failure and no writer red gate.
- Independent WIP screenshot review caught distracting giant annotations and a remaining selected-marker outer frame. One quiet main-scene copy now dissolves native metadata early/restores late with one opacity animation; whole cloned standing-legion groups, including selected borders, are removed from that quiet copy. The actual board/controls/art remain untouched. Sources are revealed SVG/foreignObject content, unique React-scoped IDs/local references; controls/event attributes/tab targets stripped; root inert/aria-hidden/pointer-transparent/viewport-clipped. No new assets, HTML rasterization, animation timers, RAFs or engine delay. Finished/canceled/error overlays release snapshots/cleanup refs and viewport listeners.
- Exit errors after game over need a visible message too: engine's winner guard returns unchanged state even for a notice. App's existing local-only notify reducer now updates only the existing message field for won/drawn games. A separate real Chrome two-player Titan-elimination check forces animate() to throw; winner and every other serialized field match engine, intentional local error sentence appears on existing message surface, overlay removed and0page errors. `.gate-logs/camera-browser-error/report.json`, camera-error-preview.cjs. No rule authority, network send or save format change.
- Cheap gate2 initial actual tsc/Vite passed,105modules/JS543.59kB gzip165.18/CSS45.79kB gzip10.67; existing >500kB warning. Final cheap log camera-cheap-final supersedes those initial sizes after annotation polish. No gate red/VOID; all raw logs retained. No BattleBoardView/ModernBattleHex/engine/net/persistence/map/generated asset edits. Same unpublished1.03 entry gains a player line, not1.04.
- Dispatcher owns final integrated full gate, distinct negative pin, real remote adoption, precise focus/reverse, live mode/reduce/viewport cancellation, direct battle load, responsive/video/production-base and post-camera Classic pixel checks. Parent's WIP checks are not represented as final commit verification. All writer browser/server processes use finally cleanup and ended; shared gate lock released.

Hooks: `.battle-camera-overlay[data-camera-direction][data-camera-hex][data-camera-motion][data-camera-stage="transition"]`; frames `[data-camera-layer="outgoing|incoming"]`; quiet SVG `[data-camera-scene="quiet"]`. Stage marks the one transition lifetime; inspect native getAnimations({subtree:true}) for progress/keyframes, no second frame clock. Scope actual boards to `.board-pane .master-board` / `.board-pane .battle-board` or #root while decorative clones exist.

Final landing-tree checks: focused gate0/33passed in3files, Vitest2.39s, `.gate-logs/camera-focused-landing/gate.log`; cheap gate2/actual tsc+Vite,105modules, JS544.72kB/gzip165.52kB, CSS45.82kB/gzip10.68kB, `.gate-logs/camera-cheap-final/gate.log`. Existing large-chunk warning only. Final native camera uses3parallel animations (outgoing, incoming, whole annotated-copy opacity); reduced motion uses1opacity animation. No new per-element timelines. Row25-rebased worktree is ready for dispatcher final verification; no running writer process or lock.

### Dispatcher verification: encounter camera and final production artifact (2026-10-29)

COPIES: 1 — useBattleCamera observes the existing App.putState seam for both local commits and remote adoption; no command-specific camera path.

Reviewed final c665392, including inert/namespaced SVG copies, preserved existing canvas pixels, quiet entire selected-marker groups, cleanup/ref release, immediate single commits and message-only local failure delivery after a winner/draw. No engine, network, save, maps or generated variant changes. Full integrated gate **0**: **496 passed/2 todo**, **70 files passed/1 skipped**,16 existing lint warnings/0 errors,39.27s,Node1024/worker1, peak **NOT MEASURED** (timer unavailable). Raw `.gate-logs/dispatcher-camera/gate.log`.

Own gate/lock differential in the isolated writer worktree removed the rotation compensation from focus translation. A1 passed at `7b77ed7849eac94a79936afb68b58b4eb45038fa6a534572b566f4a6c462e8da`; B1 failed specifically `maps the off-center encounter to the destination center after rotation and zoom, including scrolled coordinates` at `4d66bd787ca1d021d8c22c1d087885a9145958143e7cd6d848c3622815f082bc`; trap restored byte-identical source and C1 passed. Overall gate0. Logs preserved in `.gate-logs/battle-camera-writer` before retiring worktree/branch (recovery tip c665392).

Own final integrated Chrome (`../output/verify-battle-camera.cjs`) uses real engagement→fight→concede with a selected attacker. Entire saved states match unchanged dispatch at entry/exit in BOTH modes, including legion elimination; ordinary battle-unit selection never replays. Native animation transforms focus actual hex7 on the actual destination center within0.028px at1500 and0.0035px at390; quiet snapshots exclude annotations/gates/whole marker groups; all are inert/hidden. Reduced motion has opacity only; Classic has no overlay; direct active-battle loading invents no source; live uncheck and resize remove stale overlays, with no390overflow. Forcing an actual exit-animation failure after a two-player win reaches App notice while every other saved field equals engine output. Zero page errors. Remote wiring is inspected through the shared setter and tested via duplicate/boundary unit fixtures; no live online room was exercised.

Own real Chrome compositor screencast (`../output/record-battle-camera.cjs`) exported64 frames/4.133s to `../output/battle-camera-verification/battle-camera-preview.gif` (7601245B), checked at six timing samples. This records actual UI frames; no artwork was synthesized/changed. All five captured App/camera source hashes in captured-source-hashes.json match final integrated c665392 byte-for-byte. The bundled Playwright video recorder expected a different FFmpeg revision; both failed attempts are harness failures, not application failures. No software was installed: a temporary workspace copy of the existing encoder was removed, and final capture uses native CDP screencast. Context/browser/server cleanup ran on every attempt.

Production subpath build: cheap gate **2**, real tsc/Vite with COLOSSUS_BASE=/ColossusWeb/ and MSYS2_ENV_CONV_EXCL=COLOSSUS_BASE, `.gate-logs/dispatcher-modern-production/gate.log`. This is compile/bundle evidence, not another full-suite claim. Own Vite static preview + Chrome (`../output/verify-modern-production.cjs`) loaded both main and Abyss battle boards under /ColossusWeb/, checked every rendered terrain URL prefix, and fetched all20 PNGs comparing SHA256 CONTENT against the approved public assets. Fresh preference is checked by default; zero page errors. Report `../output/modern-battle-verification/production-report.json`. Source/branch remain LOCAL REVIEW; no push or deployment performed.

Final reconciliation: board.sh exit1 is the expected local-review HEAD vs published origin/master f4ff8b7 mismatch; no other stale branch/SHA found. Its Linux uptime/ps probe is unavailable on Windows; own CIM audit instead found no task-owned headless browser/suite, only user Vite PID19812. Lock free, temporary writer branches/worktrees retired, diff --check clean.

### Release1.03 merge/push (2026-10-29)

Owner authorized merge to default branch and push. Fetched origin/master f4ff8b7 and rebased the feature (already current); fast-forwarded master to verified48d0807. Source matches the prior independent full gate0 (496passed/2todo) and production/browser/negative verification exactly. This landing changes records only. Release gate **2** (cheap only), `.gate-logs/release-1.03/gate.log`: version1.02→1.03 exactly once; real tsc/Vite under Node1024 with production base/ColossusWeb/. JS index-CbdGme_U.js and CSS index-CgUMh8ty.css match the earlier content-verified production build. No repeated suite claim and no manual app-host deployment. Remote HEAD is verified after Git publication; temporary local feature branch is retired only after its commit is confirmed in master.

COPIES:1 — checked, no duplication (Git publication of already verified source).

## 2026-10-29 — writer larger main-board landscapes, row27

COPIES: 1 — ModernTerrainArt carries the single Animated main-board image layout, with no per-terrain sizing policy.

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\landscape-scale`, branch `codex/landscape-scale-writer`, published1.03 base f542f4d7084450503ce8eecf59374d9020c39f3f. One product renderer changes: former48×34 meet viewport made square art34units; new centered96-square viewBox/image/viewport at scale14 fills most of the84×72.75 hex and keeps the existing outer hex clip. Viewport size derives from scale*48/7; center uses the actual hex center and motion pivot is48/87. Native labels/gates/markers retain their paint order/coordinates and may overlap art as the owner explicitly requested. Original asset bytes, motion timings/live reduced motion, error delivery, Classic, battleboard, camera and game authority remain unchanged.

**Cheap gate2** only: actual tsc/Vite passed, `.gate-logs/landscape-scale-cheap/gate.log`, NODE_OPTIONS=--max-old-space-size=1024 and elevated Git Bash with explicit native status.105modules, JS544.88kB/gzip165.56kB, CSS45.82kB/gzip10.68kB; existing >500kB warning. Locked npmci, no dependency/lockfile changes. No failed/VOID gate, no new tests or suite/browser run for this simple presentation resize, no npmdev/build/convert. Parent owns integrated full suite and real browser/Classic parity/visual assessment. New1.04 entry follows published1.03 exactly once. All writer processes ended; no push/merge/deploy.

### Dispatcher verification: enlarged landscapes row27 (2026-10-29)

COPIES:1 — ModernTerrainArt carries the Animated landscape layout.

Reviewed606b05f. Full integrated gate **0**,496passed/2todo,70files passed/1skipped,16existingwarnings0errors,37.58s,Node1024/worker1; peak NOT MEASURED. Version check1.03→1.04 and actual tsc/Vite pass. Raw `.gate-logs/dispatcher-landscape-scale/gate.log`. No new unit tests for the reversible visual resize.

Independent Chrome `../output/verify-landscape-scale.cjs` captures Default96hex/360gates and Abyssal9216/816. The alpha-bounds projection spans87.5–96.4% of the hex width for all12landscapes, formerly31–34%. Existing clipping contains the art; labels and pieces stay above. Both final Classic images are pixel-exact against fresh published1.03 captures; metadata-exact gate types/edges/directions and save bytes are unchanged on mode switch. Zero page errors. Own negative: the same near-full-width acceptance assertion explicitly rejects the oldf542f4d source, while606b05f passes; raw old-size-negative.log and before/after reports/screenshots in `../output/landscape-scale-verification`. This compares actual rendered geometry plus approved alpha bounds, without mutating source or weakening tests. Worktree retained for the owner's further20% marker/muster request row28. No push/deploy.

## 2026-10-29 — writer larger board pieces, row28

COPIES: 2→1 — markerCenter carries standing, movement and popup geometry; one board-only tokenScale carries Animated marker/recruit sizing.

Continued `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\landscape-scale`, branch `codex/landscape-scale-writer`, initially606b05f and rebased conflict-free onto parent row27 verification commit d7fb2409ce9ba7630627c0db401c63df604cbfb1 before final landing. Row27 independent full0/496passed2todo, Classic pixel and near-full-art evidence remain intact; no new claim of those checks for this follow-up.

Only product renderer MasterBoardView.tsx changes. Animated board factor1.2 grows marker28→33.6 and recruit preview22→26.4; pending/recent already derive marker*.5/.78, now16.8/26.208. Standing duplicated cx/cy/stack-offset math is folded into existing markerCenter (already used by movement/popup). Its Y center subtracts half added marker height, preserving the original lower edge near58.86, while Classic28 has zero offset and unchanged arithmetic/paint. Original owner/full ID/count, size+2 stack spacing policy, callback/rotation/opacity/title and recruit/undo/privacy rules remain. HTML panel markers/pickers, battle creatures, labels/gates, camera and assets are untouched. Existing1.04 gets one more player line, not1.05.

**Cheap gate2** only: actual tsc/Vite passed under NODE_OPTIONS=--max-old-space-size=1024; raw `.gate-logs/board-piece-scale-cheap/gate.log` retained separately from row27's log.105modules, JS545.02kB/gzip165.63kB, CSS45.82kB/gzip10.68kB, existing >500kB warning. No failed/VOID writer gate, no new mirroring tests or suite/browser run as directed; no npmdev/build/convert. Parent owns integrated full suite and real standing/moving/mustering dimensions, original bottom/number clearance and Classic pixels. All writer-started processes ended, lock free; no push/merge/deploy.

### Dispatcher verification: larger board pieces row28 (2026-10-29)

COPIES:2→1 — markerCenter now supplies standing, moving and popup anchors.

Reviewed f366292. Full integrated gate **0**,496passed/2todo,70files passed/1skipped,16existingwarnings0errors,37.93s,Node1024/worker1; peak NOT MEASURED. Version1.03→1.04 remains exactly one step. Raw `.gate-logs/dispatcher-board-piece-scale/gate.log`. No new unit tests for this reversible presentation sizing.

Own actual Chrome `../output/verify-board-piece-scale.cjs --after` measures marker33.6, preview26.4, pending16.8 and recent26.208 versus28/22/14/21.84: all exactly20%. Standing bottom coordinates are unchanged. The actual moving marker is33.6 and the full saved result matches unchanged dispatch. The same acceptance rejects oldd7fb240 (old-size-negative.log), then passes current source. Mode switches leave save bytes unchanged. Existing real recruit/undo/caretaker/public knowledge/privacy/reduced/error-surface checks also pass (`../output/verify-muster-tokens.cjs --animated`), zero page errors.

Initial Classic PNG comparison differed in1283pixels, largely antialiased text; retained difference images. No product code changed to force parity. Controlled prior-commit d7fb240 versus final-source recapture with raw SVG dumps showed BOTH byte-identical Classic SVG and pixel-exact Move/Muster PNGs. Logs baseline-repeat.log/final-repeat.log and raw SVG/PNG in `../output/board-piece-scale-verification`. Source-size increase applies only to Animated main-board pieces; HTML panels, battle creatures and Classic stay unchanged. Writer logs preserved before worktree/branch retirement. Owner subsequently authorized automatic merge/push as a standing workflow, now recorded in AGENTS.md; current1.04 is included. No manual app-host deployment.

## 2026-10-29 — writer another20% board-piece increase, row30

COPIES: 1 — existing tokenScale/markerCenter carry all Animated board sizing/placement; no duplicate helper/policy.

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\board-pieces-more`, branch `codex/board-pieces-more-writer`, base7eeac18557f4165df17871a3e074917b448f48f8. One product line changes tokenScale1.2→1.44: another relative20%, totaling44% above the original Classic baseline. Existing sizes become marker40.32, preview31.68, pending20.16 and recent31.4496. Shared anchors/original lower edge, Classic1, HTML/battle sizes, owner/full ID/count, privacy/commands and all art/camera/rules stay unchanged. Historical row28/release1.04 initial20% records preserved; new1.05 entry dated2026-10-29.

**Cheap gate2** only: actual tsc/Vite passed, NODE_OPTIONS=--max-old-space-size=1024, elevated Git Bash/native exit propagation; `.gate-logs/board-pieces-more-cheap/gate.log`.105modules, JS545.15kB/gzip165.64kB, CSS45.82kB/gzip10.68kB; existing >500kB warning. Locked npmci with no dependency/lockfile change. No red/VOID writer gate, no new tests or suite/browser run for the literal visual resize, no npmdev/build/convert. Parent owns full suite, current-size before/after visual/Classic/negative and actual muster/move comparisons. All writer-started processes ended; no writer merge/push/deploy.

### Dispatcher verification and release1.05: another20% board-piece increase (2026-10-29)

COPIES:1 — existing tokenScale/markerCenter remains the sole board sizing/placement seam.

Reviewed a72ea71. Only product change is Animated factor1.2→1.44; version1.04→1.05 exactly once. Full integrated gate **0**,496passed/2todo,70files passed/1skipped,16existingwarnings0errors,36.26s,Node1024/worker1; peak NOT MEASURED. `.gate-logs/dispatcher-board-pieces-more/gate.log`. No new unit tests for this literal visual adjustment. Separate production cheap gate **2**, real tsc/Vite with base/ColossusWeb/, version check passes; `.gate-logs/release-1.05/gate.log`, JSindex-DpLp7r7f.js/CSSindex-CgUMh8ty.css. Cheap2 is build evidence, not a suite claim.

Own Chrome acceptance uses the actual published1.04 baseline, not the original28px size:33.6→40.32 markers,26.4→31.68 previews,16.8→20.16 pending and26.208→31.4496 recent recruits. All exactly1.2× prior values; standing bottom edges remain equal within floating-point tolerance. Moving marker40.32 matches standing and the complete saved result equals unchanged dispatch. Classic Move/Muster SVG byte-identical and PNG pixel-exact. Old published1.04 sizing fails the same additional20% acceptance, corrected source passes. Baseline/after/negative files in `../output/board-pieces-more-verification` via reusable verify-board-piece-scale.cjs with COLOSSUS_PIECE_QA_OUT. Existing actual recruitment/undo/caretaker/public knowledge/privacy/live preference/reduced motion/error surface check also passes, zero page errors (`../output/muster-token-verification/animated-report.json`). Product source tested in the writer worktree matches the final integrated one-line change.

Writer logs retained before temporary worktree/branch retirement (recovery a72ea71). User's standing instruction is automatic verified merge into master and push; this release follows it. No assets, Classic/HTML/battle sizes, rules, network or save code changed. No manual app-host deployment.

## 2026-10-29 — writer movement-target recruit ranking, row31

COPIES: 1 — movementRecruitPreview is one UI policy consuming existing listRecruitOptionsAt; no strategic scorer or eligibility rules copied.

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\movement-recruit-rank`, branch `codex/movement-recruit-rank-writer`, base c40a34429dad215d95fa519a789ecb81ada64741. New pure UI helper ranks only legal provider output by power*skill+flight+range (one each), then higher skill; full ties keep first legal order. Empty legal set null; invalid candidate stats/flags or score overflow throw. Only MasterBoardView destination recruitPreviews switch in both modes; pending bestRecruit/current muster/AI/Enter strategic scorer remain unchanged. Parent explicitly requested engine/recruit.ts comment remove only '/ move previews'; its algorithm is byte-for-byte unchanged. No net/save/map/art/AI or compliance-matrix change. New1.06 follows published1.05.

- **Focused gate0:43passed in4files**, maxWorkers1, NODE_OPTIONS=--max-old-space-size=1024, Vitest2.56s; peak NOT MEASURED. `.gate-logs/movement-rank-focused-final/gate.log`. Cheap override true; full override selects UI movementRecruitPreview, component creatureTokens and original engine recruit-preview/rules-muster tests. Initial focused gate also0/43passed; retained in movement-rank-focused. No failed/VOID writer gate.
- New helper file17tests covers multiplication vs skill alone, each ability both effective and exactly+1, both abilities+2, skill/full ties, no extra magic bonus, actual two-Cyclops Brush Gorgon vs unchanged strategic Cyclops, state nonmutation, real caretaker depletion/eligibility/capacity and source-legion destination semantics, plus missing/NaN/non-boolean metadata. Tests use real engine graph/caretaker; isolated rank examples alter only candidate stats, not legal rules/provider.
- Two new actual board integration cases independently expect Gorgon at a reachable Brush target in Classic and Animated, explicitly retain engine bestRecruitAt=Cyclops and actual onHexClick destination. The existing broad destination test now uses the UI helper as recommendation oracle while keeping all original nonempty/count/creature/title/resting/art-only/click-through assertions. Existing pending/recent real recruit/undo test additionally pins pending Cyclops so accidentally replacing the current-muster strategy is caught. No original engine tests/strategic assertions weakened.
- **Cheap gate2:** actual tsc/Vite passed; `.gate-logs/movement-rank-cheap/gate.log`,106modules, JS545.85kB/gzip165.90kB, CSS45.82kB/gzip10.68kB; existing large-chunk warning. Locked npmci, no dependency/lockfile change. No npmdev/build/convert/full suite/browser run by writer. Product adds only the UI helper import/call and public data-recruit-hex hook; layout/art/sizes remain unchanged.
- Parent owns integrated full suite, distinct negative pin and actual engine-reachable Brush/Marsh/Tower/empty/capacity expected-name Chrome checks in both modes, including unchanged pending/Enter strategy and save/command behavior. Writer test oracles do not replace those independent named browser expectations. All writer-started processes ended, shared lock free; no writer merge/push/deploy.

QA: `.recruit-preview[data-recruit-hex="<legal target>"]`; unchanged title 'Best muster: <creature>', native Classic image or Animated art-only resting icon. Helper is `movementRecruitPreview` in ui/movementRecruitPreview.ts; full policy/boundaries in design/movement-recruit-preview.md.

### Dispatcher verification and release1.06: movement-target recommendations (2026-10-29)

COPIES:1 — movementRecruitPreview is the only UI ranking policy; recruitment eligibility remains listRecruitOptionsAt and strategic muster/AI remain unchanged.

Reviewed6e8aa51. Full integrated gate **0**,515passed/2todo,71files passed/1skipped,16existingwarnings0errors,37.69s,Node1024/worker1; peak NOT MEASURED. `.gate-logs/dispatcher-movement-recruit-rank/gate.log`. Production cheap **2** passes real tsc/Vite and version1.05→1.06 exactly once under /ColossusWeb/, `.gate-logs/release-1.06/gate.log` (JSindex-lDHbBPkA.js/CSSindex-CgUMh8ty.css). No engine algorithm, legality, network, save, map or asset changes; engine/recruit.ts removes only an obsolete comment claim about movement previews.

Own isolated gate/lock negative reversed skill > bestSkill to < bestSkill: A1passed SHA0544ced503476693e24b22551e7e0be81525c648177a263792e407508c0936bc; B1 failed specifically prefers higher skill when adjusted scores tie at SHA72802a56dd65bed114a89335097acba9201d9dd6044360f383a41c93940141fd; trap restored identical source, C1passed. Overall gate0. Raw logs retained under `.gate-logs/movement-recruit-rank-writer` before retiring writer branch/worktree (recovery6e8aa51).

Own Chrome `../output/verify-movement-recruit-rank.cjs --after` uses engine-searched reachable destinations, actual legal recruit options and independent named expected choices, without importing the new helper as oracle. Both Classic/Animated show Gorgon onBrush24 for2Cyclops; Ranger onMarsh122 for2Trolls; Centaur onTower100 for a Centaur/Ogre12-point tie; Gargoyle onTower100 when its flight bonus is available. Depleted caretaker and a full7-creature legion show no recruit. Existing strategic bestRecruitAt remains Cyclops/Troll/Ogre respectively; mode switching preserves exact saved bytes; zero page errors. The published old UI fails the known Brush expectation (Cyclops instead of Gorgon), retained old-ranking-negative.log. Fixtures, reports and screenshots in `../output/movement-recruit-rank-verification`.

Existing real muster UI harness also passes recruitment/undo against the engine, caretaker/public knowledge, hidden enemy slots, reduced motion, mode persistence and visible asset failure; zero page errors. Existing AI, Enter and current/pending muster paths remain unchanged and their full-suite pins pass. Automatic verified merge/push follows the owner's standing instruction. No manual app-host deployment.

## 2026-10-29 — writer fresh Animated victory, row32

COPIES: 1 — useVictoryCelebration observes the single App.putState presentation fanout; useBattleCamera supplies actual active lifetime for ordering, with no duplicate timer/controller.

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\victory-celebration`, branch `codex/victory-celebration-writer`, base4dce55a37e9992901559f4dde83ac4258aaff823. Authoritative winner state still commits immediately. One UI-only event observer covers local/remote wins, consumes Classic outcomes without replay, skips draws/finished loads, and resets on replacement/null. Native winner dialog waits until camera capture/overlay actual finish/cancel/error clears active. Name/score/exact color come from game players; no victory commands, game-outcome mutation or autosave/network fields. AI audit remains read-only; no AI/engine/net/persistence/map/assets changed. New1.07 follows published1.06.

- **Final focused gate0:52passed in3files**, victoryCelebration/battleCamera/animatedBattles, maxWorkers1, NODE_OPTIONS=--max-old-space-size=1024, Vitest2.99s; peak NOT MEASURED. `.gate-logs/victory-focused-final/gate.log`. Cheap override true, selected Vitest full override. Existing camera geometry/cancel and creature event/Strikeback assertions remain unchanged.
- 25 new victory cases include actual engine resignation and winning battle, nine exact player hues/name/score, unchanged state bytes, fresh versus notice/duplicate/load/replacement/null/draw, actual native-camera completion/cancellation ordering, Classic/no late enable replay, reduced/live preference behavior, native modal focus/Tab/Escape/all dismiss routes, bounded confetti parent versus particle end, missing winner and modal failure notice, cleanup with zero leftover presentation timers. Tests stub native platform APIs; jsdom's zero-delay dialog toggle is flushed at0 before leak assertion, so any longer product timeout remains detectable.
- Initial focused gate1 retained in victory-focused-initial: resignation fixture omitted required playerId (engine correctly refused it); two battle cases also hit jsdom's queued native dialog-toggle bookkeeping on teardown. Corrected fixture/platform cleanup, no product assertions removed. Next gate1 victory-focused-fixed left one failure: React had selected a prefixed animation event because jsdom lacked AnimationEvent at react-dom import. Hoisted standard browser AnimationEvent capability before import; victory-focused-browser-events then gate0/29passed. Actual Chrome separately verifies native animation-end removal. Raw failed logs retained; no rerun without a concrete correction and no VOID run.
- **Final cheap gate2:** real tsc/Vite passed,109modules, JS551.13kB/gzip167.58kB, CSS48.30kB/gzip11.27kB, existing >500kB warning. `.gate-logs/victory-cheap-final/gate.log`; initial cheap2 retained separately. Locked npmci, no dependency/lockfile change. No npmdev/build/convert or writer full suite.
- Bounded writer real Chrome at1440×1000 plus390×844: actual App resignation/winning-battle commands, full saves exactly match unchanged engine; native :modal true, initial View final board focus, explicit Tab/Shift+Tab cycle, Escape restores existing New game, finished reload/Classic skip,32particles removed after burst, reduced mobile still card fits(358×500 atx16/y172),0page errors. Battle-winner state commits while camera exists and dialog mounts only after its actual removal. WebSockets blocked; native browser/server close in finally. Artifacts `.gate-logs/victory-browser-report.json`, victory-desktop.png, victory-mobile-reduced.png, victory-after-camera.png; harness victory-preview.cjs.
- Initial real browser check exposed native modal traversal briefly leaving the two controls at the Tab edge. Added explicit scoped edge wrapping and a meaningful unit pin; subsequent Chrome check passes all cases. This was a product accessibility fix, separate from the jsdom fixture corrections.
- 32 deterministic CSS-only owner/gold/cream pieces animate once1450ms+atmost210stagger; parent1800ms animation removes their DOM. Reduced motion removes/hides particles and never starts a late burst. Dismissal/mode/reset/unmount remove dialog, native top-layer backdrop and all particles; no RAF/JS animation timer/global listeners or assets. Crown/medal is native SVG; existing markerInk selects readable white/dark contrast, including Black/Gold/Silver. Existing header New game/Leave game controller reused by focus ref; no copied game command callback.
- Parent owns complete suite, distinct negative, independent remote/responsive/Classic/video/native-focus and publication checks. Writer Chrome is bounded evidence, not final dispatcher verification. All writer-started foreground/gate/browser/server processes ended, shared lock released; no writer merge/push/deploy.

QA hooks: `.victory-celebration[open][data-winner-id][data-owner-color][data-reduced-motion]`, native `:modal`, `.victory-owner-face`, `.victory-score`, `.victory-confetti i`, `.victory-view-board`, `.victory-close`. Camera hooks unchanged; useBattleCamera.active is the shared completion seam. Full design in design/victory-celebration.md.

Row32 focus-cleanup follow-up: dispatcher full gate identified one new react-hooks warning from reading returnFocusRef.current inside cleanup. VictoryCelebration now captures the already-mounted fallback focus element during effect setup and uses that stable element on dismissal/unmount. The still-connected enabled previous control remains first choice; otherwise the same existing header control is focused. No visual/event/game behavior change. Initial focused attempt was VOID9 while dispatcher's earlier-commit full gate held the shared lock; retained `.gate-logs/victory-focus-ref-followup/gate.log`, not treated as verification. Final targeted lint/focused result is recorded below after the lock releases.

Final focus-ref follow-up gate0: targeted oxlint on VictoryCelebration.tsx emitted no warnings/errors, then25celebration tests passed (Vitest1.22s), worker1/Node1024, peak NOT MEASURED. `.gate-logs/victory-focus-ref-final/gate.log`. No cheap/full-suite/browser repetition requested for this capture-only change; parent owns final integration. Prior VOID9 log preserved. All processes ended and lock released; no writer merge/push/deploy.

### Dispatcher verification and release1.07: victory celebration (2026-10-29)

COPIES:1 — App.putState fans out to the camera and one fresh-victory observer; camera.active is the actual lifetime boundary. No engine/net/save/AI changes.

Reviewed4d9d88c and focus-cleanup follow-up81b0a7e. Final full gate **0**,540passed/2todo,72files passed/1skipped,16existingwarnings0errors,40.71s,Node1024/worker1; peak NOT MEASURED. `.gate-logs/dispatcher-victory-final/gate.log`. Real typecheck and production /ColossusWeb/ bundle included; version1.06→1.07 exactly once, JSindex-DP9Y5mtg.js/CSSindex-zJtoWevb.css. Earlier full gate0 also540passed but found one new cleanup-ref warning; the follow-up captures the already-mounted fallback and final lint returns to16existing warnings. No dependency/generation changes.

Own locked A/B/C negative: committed clean hook verified with Git filtered blob hash before mutation, physical SHA9ced284a9bcc0d02b19d78257002890af8eb315f4b3634785dfea03a77eecb0f. A actual Chrome acceptance passes; B removes only cameraActive guard, SHA24e09126eb6c06493cc0706360b186d83a3cb77b7888fd17681c85b35424b727, specifically fails Celebration appeared before exit camera completed; trap restores from committed HEAD, C identical physical SHA and acceptance passes. Gate0 `.gate-logs/dispatcher-victory-negative-fixed/gate.log`. Initial script preparation was rejected by automatic review because a HEAD restore could erase then-uncommitted writer work; no source mutation happened. Retried only after commit and clean-content proof, with explicit preflight before installing the trap. First preflight stopped before any arm because physical CRLF differs from Git LF (gate1, VOID as differential evidence); corrected to Git-filtered blob equality before mutation while still requiring physical SHA equality after restoration. Original failure log retained. This is a harness correction, not a product workaround.

Own final Chrome on81b0a7e, `../output/verify-victory.cjs`, uses actual engine battle-entry/concession commands and full expected serialized state. Winner Alice/color#bd0018/48points; exact game save equality; actual exit animations deliberately slowed beyond1second and card stays absent until actual completion.32particles remove on bounded animation end. Native modal focus, Tab/ShiftTab, Escape/restoration, View final board, Classic original result/message, finished-save load and later Animated enable do not replay.360×800 reduced-motion card stays inside viewport, no confetti or overflow. Zero page errors. Candidate, A/B/C and final artifacts are distinct under `../output/victory-verification`; final screenshots/report reflect integrated focus follow-up.

Own production preview at /ColossusWeb/, `../output/verify-victory-production.cjs`: no development dispatch hook; real Fight! and Concede buttons create the winning state, full save equals independent engine expectation, modal appears after exit and Escape dismisses. Both served hashed JS/CSS bytes match dist SHA256, zero page errors. `production-report.json` records hashes. Production artifact checked locally; no manual app-host deployment claimed.

Actual CDP compositor capture exported to victory-preview.gif:53native frames,2569ms,720×570,3574953bytes. No generated substitute imagery; screenshots and recording are from running final application. Metadata in preview.json. Writer logs/screens/recovery commits4d9d88c and81b0a7e preserved under `.gate-logs/victory-writer` before retiring its clean in-repo worktree and merged branch. Windows scoped process audit found only user's existing Vite PID19812; temporary test/browser/preview processes closed, shared lock free. Automatic master merge/push follows standing owner instruction.

Separate read-only AI audit at ../output/ai-audit/report.html includes web strategy sources and reproducible fixture links. Final parent custom gate0 proves forced Hydra-containing splits across four profiles, real engine lethal Drift and clock-hold cases; local252movement-call timing excludes tactical probes.30focused tactical tests passed separately. Crafted positions rather than missing original save; no tournament or win-rate claim; AI runtime unchanged. Initial parent command used wrong cwd (exit127, no tests), corrected afterward; earlier timer included tactical work, corrected before reporting final1.7ms legal-movement-only measurement.

## 2026-10-29 — writer stronger tactical AI, row34

COPIES: 1 — shared evaluateBattle decision seam; pure probability/legal-response helpers reuse engine authorities rather than duplicate combat rules.

Writer `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\ai-tactics`, codex/ai-tactics-writer, base1c39d623dbe6beeb024e806af30b7a85026ee936. Locked npm ci completed with no manifest/lockfile changes after sandbox DNS prevented the first install; elevated install succeeded. No new dependency. No npmdev/build/convert, fullsuite, browser, simulation tournament, differential, merge, push or deployment. All gates use elevated Git Bash, Node1024MB and explicit native status propagation; focused Vitest worker1.

- **Final focused gate0:96passed in9files**,1.85s; changed-file oxlint0warnings/0errors. Raw `.gate-logs/tactics-focused-final/gate.log`. Cheap override true; full override lints evaluateBattle/battleProbability/battleResponse/battlePlanner test, then selects battlePlanner, battleTactics, battleEntry, engine battleEntryDeploy/battleHazards/deadStrikeback/rules-rangestrike/rules-battle-hazards/rules-battle-timing. Focused evidence only. **Peak NOT MEASURED** (/usr/bin/time unavailable).
- **Final cheap gate2:** actual tsc/Vite passed, suite not requested. `.gate-logs/tactics-cheap-final/gate.log`:111modules,JS556.77kB/gzip169.47,CSS48.30kB/gzip11.27; existing >500kB chunk warning. Earlier cheap2 retained in tactics-cheap-initial. Typecheck/build does not run tracked variant conversion.
- First focused run was **RED**,36passed/1failed: safe C5 retreat was outside the optional shortlist, so the planner held an exposed Titan instead of retreating. The expectation was retained; an independent bounded Titan retreat scan now keeps that escape before candidate pruning. Corrected focused gate0/37passed at tactics-focused-safety. Two-half hazard and screen timing additions then passed40tests at tactics-focused-hazards; final expands authority coverage to96. No VOID writer gate. Raw red evidence stays tactics-focused-initial.
- Thirteen new tests prove exact binomial capped damage/kill/overflow including2000dice stability and invalid input; actual Hydra ranged Colossus priority over old Centaur threshold; Tundra Titan1HP avoids lethal Drift under normal/minimal optional budgets; escape from current lethal terrain despite budget exhaustion; actual Plains turn7 hold produces engine time-loss win; legal safe retreat from next-move Ogre reach; Titan2HP Drift dies across two actual engine halves if held and survives the new escape; native Troll immunity; retained screen prevents enemy movement; next-pre-strike casualties still block preceding movement; attacker still closes; unchanged input/deterministic commands and explicit work limits.
- Measured Node fixtures, not browser latency promises: small/default/larger whole-position analysis used respectively1/213/427 optional nodes plus27 mandatory safety nodes,1/9/17 completed candidates; combined elapsed12.850ms. Small explicitly reports exhausted; default/larger complete. Separate real7v7 normal decision used318optional+609safety nodes,9candidate positions,17.743ms; no exhaustion. Counters are asserted against2048optional/8192mandatory ceilings; no timing assertion or synthetic load. A larger budget explores more positions, not an unbounded lookplus search.
- Exact hazard authority is hazardDamageToCreature; response reuses legalBattleMoves/legalStrikes/getStrikeDice/getStrikeNumber and legal carry constraints. Current hazard casualties are absent from the next maneuver; a separate pre-next-strike snapshot keeps later casualties occupying their cells through Move. Newly slain ordinary enemies still strike. Both future target HP and delayed deterministic Titan loss are represented. Current combat remains conditional: no joint stochastic rollout, current kill simulation, or reinforcement forecasting. Enemy best replies can contest one cell, giving a conservative envelope; total alternative targets from one enemy are not charged as simultaneous strikes.
- Public move/hex/exposure scoring uses scratch units and leaves caller state unchanged. Normal defaults8moves+hold/2048optional response nodes; independent8192-node Titan safety and existing entry DFS do not weaken with optional difficulty budgets. Invalid budgets throw; work counters expose exhaustion. Existing simpleAi signatures remain compatible through an optional final options argument. No difficulty UI/save choice introduced here.
- Scope is evaluateBattle plus new tactical helpers/test and own docs. No engine/types/rules/net/save/setup/sim/asset/profile/strength/split/mainboard source edit. No changelog entry: strategy writer owns integrated1.08. Parent owns integrated fullsuite, distinct negative pin, paired old/new strength matches and actual browser responsiveness/gameplay. All writer-started foreground processes ended and its gate lock released; no server/browser was started.

## Row33 — strategic AI regression fixtures

`web/src/ai/__tests__/strategicPlanning.test.ts` uses real movement/recruit providers and dispatch: all four profiles HOLD Default4→103 forced-loss and4→140 roll-six-only traps, productive safe split remains, terminal Hydra/completed Cyclops group stay protected, opening/later forced splits legal, available stock and input determinism preserved. The real vacated1→2 route exposes five enemy rolls missed by original occupancy. Shared last-Hydra supply is counted once; in-place stock exhaustion/restoration updates development without changing legal options. Every personality's reinforce/post-reinforce/summon action agrees with estimated support and engine first-eligible-donor behavior; used windows and Titan's last escort are respected.

Writer focused command (through `scripts/gate.sh`, never direct): `GATE_CHEAP_CMD=true`, `GATE_FULL_CMD='cd web && npx oxlint && npx vitest run src/ai/__tests__ src/engine/__tests__/recruit-graph.test.ts src/engine/__tests__/recruit-preview.test.ts src/engine/__tests__/rules-split.test.ts src/engine/__tests__/rules-muster.test.ts src/engine/__tests__/rules-reinforce-summon.test.ts src/ui/__tests__/movementRecruitPreview.test.ts src/version/__tests__ --maxWorkers=1'`, Node heap1024. Cheap tier separate, exit2 means suite not run. Logs `.gate-logs/strategy-focused-final` and `strategy-cheap-final`; earlier red/refused runs retained. Parent owns integrated full, independent negatives, browser and paired outcome measurements. No strength percentage or difficulty-level claim from fixtures alone; no rules compliance-matrix changes for heuristic-only policy.

Writer result: focused gate0,158passed across20files,16pre-existing lint warnings/0errors,3.52sec Vitest; cheap gate2, real tsc/Vite,4.40sec. Node1024/worker1; peak memory NOT MEASURED (host has no /usr/bin/time). No full-suite/browser/tournament claim in this writer result.

Row33 execution follow-up: the same regression file now runs actual pickAiCommand→dispatch from optional Split through all six Move rolls for all four personalities, requiring legal separation/progress and deterministic unmutated decisions. Default Tower100/three Hydras at37/roll3 demonstrates the prior gap: after parent reaches5, generic movement chooses the threatened profitable Plains1 for Lion/Ogre, while the shared continuation protects a HOLD at100. Actual initial4:4 checks consumed teleport and fixed moved-piece occupancy; an adopted strong enemy at103 proves explicit least-loss legal separation preserving Titan and legal phase completion. `safeJointRoute` is shared by approval and Move; no test-only action path or stored route. Follow-up logs `.gate-logs/strategy-execution-final` and `strategy-execution-cheap`; probes retained outside tracked source, including one search that found no unsafe first-move fixture (not a product-test failure hidden by rerun).

Execution follow-up writer result: focused gate0,180passed/22files (AI plus recruit/split/movement/teleport/support/UI preview/version),16existing lint warnings/0errors,4.48sec Vitest; cheap2 realtsc/Vite4.79sec. Node1024/worker1; peakNOTMEASURED. Parent integrated full/independent negatives/browser/head-to-head still owed.
## 2026-10-29 — writer difficulty foundation, row35 (split wiring pending)

COPIES: 1 — ai/difficulty.ts owns strict normalization, labels and all level budgets, independent of personality and UI playback speed.

Worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\ai-difficulty`, branch codex/ai-difficulty-writer, base152a687. npm ci locked install completed with no dependency/manifest/lockfile changes. Did not touch active strategy writer's simpleAi/splitPlanning/evaluateMove. This is a coherent foundation, not whole-feature completion: split default wiring waits for STRATEGY-READY and rebase.

- Focused foundation gate0:30passed/4files,2.78s, Node1024/worker1, peak NOT MEASURED. `.gate-logs/difficulty-foundation-final/gate.log`; earlier29passed in difficulty-levels-focused,27passed in difficulty-foundation-focused. Cheap override true, full selects difficulty,battlePlanner,setupScreen and saveGame tests. The simulation option pin runs zero game steps; no tournament or strength claim.
- Foundation cheap gate2: actual tsc/Vite passed,114modules,JS562.77kB/gzip171.45,CSS48.36kB/gzip11.29, existing chunk warning. `.gate-logs/difficulty-foundation-cheap-fixed/gate.log`. Initial cheap gate1 is retained: newly inserted human placeholder dash had a single CP1252 byte; replaced that exact literal with UTF-8, verified edited files decode as UTF-8 while preserving surrounding bytes. No repeated blind gate; no VOID run.
- Actual battle-level work: Easy54replynodes/3positions, Normal213/9, Hard427/17; each same27mandatory safety nodes. The masterboard active seat was deliberately Easy while actual battle owner changed level, proving correct owner resolution. Native/terrain/clock/exact-strike behavior stays shared; all three levels avoid delayed Drift death and retain the safe turn7 hold.
- Constructor tests reject explicit invalid/null values and compare the entire same-seed state except difficulty across levels, including random personality, towers, caretaker and resources. Save tests pin explicit-level roundtrip, missing-fieldNormal migration on a clone, invalid read/write rejection and unchanged input blobs. Setup pins independent personality/level, AI→Human→AI preservation, omitted human payload, addedNormal rows and retained levels on removal. Optional simulator settings propagate to actual created players, reject wrong lengths/invalid IDs before simulation; maxSteps0 only.
- Own bounded headless Chrome preview `.gate-logs/difficulty-preview.cjs`:1920/1440/1280/1200/1100/900/768/390/360, no page overflow or intersecting row controls; selectedHard retained through kind toggle;0page errors. Screenshot difficulty-360.png. Own ephemeral Vite API server, blocked WebSockets, Node1024/Chrome512, both closed in finally. No user's server touched. This is writer QA, not parent-independent verification.
- No AI pacing/legality, net or resources changed. Same existing1.08 gains the levels note. Hidden enemy-content access remains; no fair-information claim. No fullsuite, source mutation, merge/push/deploy. Parent owns final integrated evidence and strength calibration.

## 2026-10-29 — final per-seat difficulty integration, row35

COPIES: 1 — ai/difficulty.ts carries normalization, labels and settings for constructor/save/setup plus actual battle and split-owner planning.

Committed foundation first, then rebased onto parent9157fc648e04c727fac6b82081ea3beea7e635f1 after STRATEGY-READY. The sole conflict was appended TESTING content; mechanically retained both histories, no source conflict. Git's configured editor was unavailable, so the staged rebase commit completed with git commit --no-edit followed by rebase --continue. Actual splitPlanning changes are only shared default lookup at existing planningLimits and actual group/legion-owner call sites. No simpleAi/evaluateMove/execution policy rewrite.

- Final focused gate0: **82passed in8files**,5.53s, changed-source oxlint0warnings/0errors. `.gate-logs/difficulty-final/gate.log`. Node1024/worker1, peak NOT MEASURED. Full override lints changed source/tests, then selects difficulty,strategicPlanning,battlePlanner,battleEntry,personalities,setupScreen,appSavedGame and saveGame. Cheap overridetrue; not complete-suite evidence. Earlier integrated focused66 and71 passed remain difficulty-rebased-focused/difficulty-focused-final. Resume-only3passed at difficulty-resume-focused. No focused red or VOID run.
- Final cheap gate2: actual tsc/Vite passed, suite not requested. `.gate-logs/difficulty-cheap-final/gate.log`:114modules,JS565.55kB/gzip172.13,CSS48.36kB/gzip11.29, existing large-chunk warning. No npmdev/build/convert or dependency changes.
- Actual default level work, rather than registry-only assertions: battle Easy/Normal/Hard completed3/9/17 positions and54/213/427 optional reply nodes, with identical27mandatory safety nodes; actual battle owner deliberately differs from masterboard active seat. Split approval used192/257/277 movement queries and30completed safety plans on the same productive fixture, no exhaustion; all selected Lion+Ogre. Single first-planner calls observed17.246/14.906/12.872ms in this run. Those noisy Node fixture observations are not a monotonic latency or strength claim. All approved splits execute through real dispatch and pickAiCommand on every roll1..6 at each level. Forced-loss Hydra HOLD, threatened child continuation, shared deployment safety, delayed/lethal Drift, exact ranged strike and clock hold remain pinned across levels.
- Difficulty is metadata/planning work only. Same-seed full state comparisons remove just that field, proving no starting resource/tower/personality RNG changes. No extra information is granted by level; existing AI can inspect hidden enemy contents, so no human-equivalent-information claim. Save version remains1 with strict migration/read/write normalization; malformed explicit values fail loudly. Setup controls remain native and independent, human payload omits difficulty, kind toggles retain it, added seats defaultNormal. Optional simulator propagation/length validation is tested at zero game steps.
- Parent independent Chrome reached a corrupt explicit difficulty save and found an unhandled rejection in existing App.continueSaved. Approved scope expansion wraps ONLY that existing callback in try/catch and uses existing setError; no save erasure or replacement. Actual App pins invalid difficulty, variant rejection and manifest rejection, requiring .boot.error with exact message and byte-identical retained storage. Parent owns repeat real-browser no-pageerror proof; its initial red log is retained by parent.
- Own UI preview described above still covers unchanged final setup source at360/390/768/900/1100/1200/1280/1440/1920 with no row overlaps/overflow and kind-toggle persistence. Its ephemeral server/browser closed in finally. No ongoing process, fullsuite, mutation test, tournament/win-rate claim, merge/push/deploy. Parent independently validates integrated full suite, negative pin, actual browser and paired strength; the sole existing1.08 entry is amended, no1.09.

## 2026-10-29 — calibration follow-up: simpler Easy coordination, row35

COPIES: 1 — shared ai/difficulty.ts settings and evaluateMove decision path; incomingThreatScore remains the common threat authority.

Parent's paired calibration did not separate the earlier planning budgets: Normalvsold64games37W25L2D; HardvsEasy32games15HardW16EasyW1max_turns, no failures. These are parent-reported observations, not writer-run tournaments or final strength claims. The authorized follow-up adds maxOptionalLegionMoves1 to Easy, null/unlimited toNormal/Hard. After shared split continuation and forced separation, Easy can finish quiet optional coordination once one legion moved. Threatened legally movable Titans bypass the limit; no random errors, resources or tactical-rule handicap.

New actual rescue fixture exposed an existing shared omission: Titan at1 threatened by enemy seven-Hydra stack at1000, own other legion already moved, roll6. Normal ranked safe destination7 with score0 and current incoming threat684, yet returned doneMove because continuation required positive growth. The common move picker now prioritizes legal risk-reducing Titan escapes at every level, including score0, while rejecting a losing engagement as a refuge. This preserves safety rather than making the old omission an Easy handicap. If no risk-reducing route exists, the shared ordinary evaluation remains; the change does not force a known worse move merely because it is legal.

- Final focused gate0:90passed/7files,3.47s, changed-source lint0warnings/0errors. `.gate-logs/easy-coordination-final/gate.log`, Node1024/worker1, peak NOT MEASURED. Cheap override true; full lints difficulty/evaluateMove/easyCoordination test then selects easyCoordination,difficulty,strategicPlanning,battlePlanner,battleEntry,moveSearch,boardSpatial. Existing level/profile safety and actual split execution pins remain unchanged.
- Twelve new tests exercise four personalities: quiet Easy actually dispatches doneMove after one safe move while Normal/Hard dispatch another useful legion; all four personalities at all three levels actually rescue the threatened Titan and lower incoming threat; Easy still dispatches mandatory split separation despite another moved legion, then completes legal movement. Input remains unchanged by picking. Existing exact strike, terrain/clock, shared8192-node tactical safety, six-roll split proof and held-child policy remain unchanged.
- Initial focused gate1:4failed/73passed from the rescue fixture, retained easy-coordination-focused. Longer-roll fixture4failed/8passed at easy-coordination-rescue; diagnostic4failed/8passed at easy-rescue-diagnostic proved the unchanged Normal result and score0 safe exit rather than assuming the cap caused it. The rescue assertion was retained and extended across all levels; common safety logic fixed the cause. Corrected focused90passed at easy-coordination-fixed before final lint run. No VOID run or source differential.
- Cheap gate2: real tsc/Vite passed,114modules,JS566.54kB/gzip172.42,CSS48.36kB/gzip11.29; existing chunk warning. `.gate-logs/easy-coordination-cheap/gate.log`. Same1.08 gains plain-language simpler-coordination wording; no1.09. No UI geometry, engine/save/net, split policy, tactical settings or playback timing change in this follow-up.
- No writer full suite, browser, matches, merge/push/deploy or lasting processes. Parent owns recalibration/fresh held-out matches, full gate and final browser. Larger work limits are still not a universal challenge hierarchy guarantee until independently measured.

Independent review refinement before landing: a broader cap bypass checked any legally movable threatened Titan after the actual improving-rescue list was empty. Parent corrected the brief's wording to require an EXECUTABLE IMPROVING rescue. Removed that broader bypass; existing ranked rescues already exclude held IDs and return first. New four-personality/three-level trap fixture has a moved escort, Titan at1, losing Hydra blockers at every legal exit7/1000, and an unrelated productive legion at200. Easy actually finishes without moving the unrelated legion; Normal/Hard retain ordinary productive movement. Losing engagements are never mislabeled refuges. No known worse Titan move is forced.

Final corrected focused gate0: **94passed/7files**,3.17s, changed-source lint0warnings/0errors; `.gate-logs/easy-coordination-trap-final/gate.log`, Node1024/worker1, peak NOT MEASURED. Final cheap2:114modules,JS566.44kB/gzip172.39,CSS48.36kB/gzip11.29, existing chunk warning; `.gate-logs/easy-coordination-trap-cheap/gate.log`. These supersede90-test/earlier build observations above. No writer source mutation, fullsuite, calibration matches, browser or push. Parent's calibration/full/browser remain owed.

## Row36 — actual Hard multi-turn board depth

`ai/__tests__/masterLookahead.test.ts` pins completed two-future-turn work and actual commands: Default two Lions at100/currentroll2, ordinary/one-turn142 versus Hard42, controlled future rolls1→6 execute42→1/recruitLion→7/recruitGriffon. Exact caretaker decrements and the bait's inability to produce Griffon on the same faces are engine-derived. Normal/Easy compare enabled/explicit-disabled search commands AND RNG counts; completed no-improvement/Done preserve the control. Node/frontier/query exhaustion and an incomplete later root discard positive partial comparisons; incoming enemy survival and current allied last-Hydra competition update actual projected stock without input mutation.

Current local sample in `.gate-logs/hard-master-control/gate.log`: depth2 reached2,104nodes/133memo hits,75expanded future musters,268generated moves,153movement queries,3complete candidates, no exhaustion,7.07ms search on the recruiting fork. Threat fixture (one strong enemy) reached2,71nodes/37memo hits,33future musters,127generated moves,325movement queries,3.40ms including its ranked-move setup. These are local fixture measurements, not browser latency or tournament evidence. Host peak memory is NOT MEASURED; Node1024/worker1 applies. Final focused gate and cheap gate logs `.gate-logs/hard-master-final` and `hard-master-cheap`; parent owns corrected independent full/negative/browser/paired policy results. Prior same-seed strength aggregate was withdrawn for benchmark controller ownership; do not reuse it as calibration evidence.

Row36 optional reach-mask review: synthetic disjoint/overlap events are unioned per player; independent player rolls multiply survival. Actual Default occupied-target masks are nested suffixes because movement stops on contact, so no hypothetical disjoint Default board fixture or observed bug is claimed. A real reachable Tower target keeps the same cached mask when caretaker Gargoyle changes the shared combat estimate from winning threat to safe reinforcement. Normal/Easy continue using their original count cache.

Row36 final writer checks: focused gate0,179passed across20files,16existing lint warnings/0errors,5.88sec Vitest; cheap2 realtsc/Vite8.72sec. Final depth fixture6.89ms with104nodes/133memo hits/75future musters/153queries/268generated/reacheddepth2; threat fixture3.93ms with71nodes/33future musters/325queries. Earlier cold fixture samples and probes remain in logs (fork about6.9–12.3ms), not a promised browser upper bound. No full-suite/production/browser/head-to-head claim from the writer. Existing count-path code in boardSpatial is unchanged; only an explicit optional roll-mask API/cache was added under dispatcher-approved scope. Same unpublished1.08; changelog/difficulty/engine/battle/simpleAi left untouched.
