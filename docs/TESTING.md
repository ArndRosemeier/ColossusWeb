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
| *(no landings yet — the first landing fills this in)* | | | |

Coverage that already exists and should be extended rather than duplicated: the
`rules-*.test.ts` family (rules mechanics), `web/src/ai/__tests__/` (AI decisions),
`web/src/ui/__tests__/`, `web/src/persistence/__tests__/`, and the matrix in
`docs/rules/COMPLIANCE.md`.

## Per landing

*(no landings yet; the baseline above is not a landing)*

### <sha> — <row>

- **Gate:** <exit code> · <N>/<N> tests · peak <N>MB · raw log `<path>`
- **Differential:** arm A `<hash>` (baseline) · arm B `<hash>` → RED on `<named pin>`
- **VOID:** <any probe whose arms were identical, and therefore proved nothing>

## Honest records

A VOID probe, a wrong-file green, a discarded log and a verification run against a
stale tree are all **recorded, not hidden**. An honest unknown is worth more than a
confident green, and the failure modes above are information about the *process*, not
merely about the change.
