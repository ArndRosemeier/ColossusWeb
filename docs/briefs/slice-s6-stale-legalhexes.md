# Slice S6 — a gameplay-breaking regression: a DERIVED field was preserved as if it were UI state

**Ledger row: 12.** Board line: the `IN-FLIGHT` row for `stale-legalhexes`. **This is a bug fix
for a live, owner-reported regression, and it outranks everything else.**

## The owner's report, verbatim

> "There is something wrong with moving now. I first rolled a 6 and movement worked as expected
> (could teleport a stack from tower and moved the other one normally). Other player also rolled a
> 6, worked well too. Then it was my turn again, rolled a 3. Now when i click on a stack target
> fields flash as if i rolled a 6 (which is wrong), but even worse, i can not move at all, neither
> a 6 nor a 3. This has been working before the multiplayer changes as far as i know."

## The cause, found and confirmed in the code

`web/src/net/sync.ts:429` declares

```ts
export const LOCAL_UI_FIELDS = ['selectedLegionId', 'legalHexes'] as const
```

and `preserveLocalUi` (`sync.ts:431-438`) then copies the LOCAL value over the adopted state:

```ts
next.legalHexes = selected === null ? [] : [...local.legalHexes]
```

**`legalHexes` is not UI state: the ENGINE derives it** from the selected legion and the current
roll — `GameEngine.selectLegion` sets `state.legalHexes = [...listAllMoves(state, legion,
state.movementRoll).keys()]` (`GameEngine.ts:638`, and the same at `:888`). It is a cached answer
to "where may THIS legion go, with THIS roll, from HERE".

So on adoption it is stale in **both** dimensions: the roll (6, from the previous turn, giving a
different reachable set) and the origin (the legion's position/identity may have changed). The
symptoms follow exactly: the board highlights the previous turn's set — the owner's "flashes as if
I rolled a 6" — and the real destinations are NOT in that set, so clicks are ignored and he "can
not move at all".

**This is the dispatcher's own error, and it is recorded as such.** The S3 brief required that
adoption "preserve the local UI-only fields (selection, animation) rather than resetting them";
the writer implemented it faithfully and wrote the pin `a remote snapshot is adopted and the local
UI-only fields survive` (`sync.test.ts:306`), which now PINS THE DEFECT. A derived field was
classified as a preference. That pin must change, not be deleted: the property worth keeping is
"the inspected legion survives", and the property being broken is "its reachable set is the
adopted state's".

## What to build

1. **Never copy `legalHexes` across an adoption.** It must be derived from the ADOPTED state, by
   the engine's ONE rule — `selectLegion` / `listAllMoves` — never a second implementation of
   "where may this legion go". If a clean seam is needed, export the engine's recompute as ONE
   pure helper and route both the engine and adoption through it (`COPIES:` must say so).
2. **Keep the inspected legion only if it still exists AND the engine would still select it.**
   Preserving `selectedLegionId` is a genuine nicety (a remote move should not deselect what I am
   looking at) — but the reachable set must always be recomputed for the adopted state. If the
   legion is gone (killed on the other player's turn) or no longer selectable, clear BOTH.
3. **Nothing else in the merge changes.** `diceRoll`, `pendingDice`, `message`, `log` still come
   from the adopted state, as the existing comment says.
4. **Check the sibling paths for the same mistake** while you are here — anywhere a DERIVED field
   is treated as a local preference. Report what you find rather than fixing beyond scope.

## Pins — each phrased as a statement, and the existing one MUST be replaced

The current pin asserts the defective behaviour. Replace it with pins that state the correct
property, including at least:

- **Adopting a state whose roll CHANGED shows the ADOPTED roll's legal hexes, not the previous
  roll's.** Construct the local state with a small roll and the adopted one with a LARGER roll (or
  vice versa) and assert the legal set equals the adopted state's — the old copy made these
  differ, so this pin fails under the old code.
- **Adopting a state where the inspected legion has MOVED recomputes the set for its new
  position** — a set computed for the old position must not survive.
- **The inspected legion survives the adoption when it still exists** (the nicety that is worth
  keeping).
- **A legion that no longer exists clears both** the selection and the reachable set, rather than
  leaving a dangling selection the UI can act on.
- **A full owner-shaped sequence**: turn 1 with one roll, a remote turn, then the local player's
  next turn with a DIFFERENT roll — assert the legal set is the new roll's, and that a move which
  is legal for the new roll is accepted (this is the reported scenario end to end).

## Out of scope

The engine's movement rules themselves; the `?prefix=`/limiter work (S5, landed); anything about
the store.

## Verification (yours)

1. The ONE gate command from the **root of your worktree**: `bash scripts/gate.sh`. A fresh
   worktree needs `(cd web && npm ci)` ONCE first or it exits 1 at preflight. Exit `9` = lock
   busy → wait and retry.
2. Your **own differential**: arms with PRINTED file hashes, lock held, restore from `HEAD` in a
   `trap`. **COMMIT BEFORE YOU INJECT** — `git checkout --` restores HEAD and will wipe an
   uncommitted change. **Arm A must be the defect itself**: put the copy back and watch the new
   pin go RED, which is what proves the pin holds this regression.
3. **THE SYMPTOM IS VISIBLE IN THE UI, SO A BROWSER CHECK IS REQUIRED** — two of the last five
   slices shipped a defect a DOM-free suite could not see. `scripts/browser-check/` holds a
   working CDP harness (an unreviewed starting point) and its README records the method: build the
   app against a fake store you control, drive the real UI, and assert what is on the BOARD (the
   highlighted set / an accepted move) — not merely that a function returned.
4. Commit, rebase on `origin/master`, push your branch.
5. **If you cannot finish, COMMIT the coherent partial state and report BLOCKED.**

**Do not seek or use a real access key, and add no test that calls the live service.**

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` row **12** (including the dispatcher's mis-classification, so the next
reader understands how the pin came to assert it); `docs/BOARD.md` (turn the `IN-FLIGHT` line
into `LANDED`); `docs/ARCHITECTURE.md` (derived-vs-local fields at the adoption seam — a row that
makes "is this field derived?" the question to ask before preserving anything); carry the
`COPIES:` line.

## Your report (short)

LANDED or BLOCKED, then: sha; gate exit + counts + peak; each arm with its printed hash and what
went red; the `COPIES:` line; **what the board does now on a roll change, as observed in the
browser**; the other derived-vs-local fields you checked; your judgement calls; the docs you
amended; and anything this brief got wrong.

Report NOTHING in between — silence until LANDED or BLOCKED.
