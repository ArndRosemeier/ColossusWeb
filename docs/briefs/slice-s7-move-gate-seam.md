# Slice S7 — the owner's real "cannot move": TWO authorities for who may act

**Ledger row: 13.** Board line: the `IN-FLIGHT` row for `move-gate-seam`. **This is the fix for the
owner's reported "cannot move at all", and it is the highest priority.**

The cause is not the state, not the sync, and not the S6 derived field (that was a real bug, fixed).
It is a **UI seam bug**, and it was reproduced in a real browser against the owner's OWN snapshot
chain by a read-only probe.

## The reproduced chain, with the evidence

1. **The board paints fields that a click will refuse.** When the selected legion is not the active
   player's, `MasterBoardView.tsx:216-219` paints `listEnemyMovePreview` (`movement.ts:235-251`) —
   the UNION over rolls 1–6 — as `.preview-roll` fields. On the owner's state that is **45 fields**.
   That is his "target fields flash as if i rolled a 6": a union over all six rolls looks like a
   6-roll set.
2. **A click on one silently deselects.** `GameEngine.ts:1571` (`getMovesForSelected`) returns an
   EMPTY map because the selected legion is not the active player's, so `App.tsx:503` finds `info`
   undefined and `App.tsx:512` dispatches **`{type:'deselectLegion'}`**. The fields vanish instantly
   — the "flash" — and **nothing is published** (measured: PUT 0→0), because `deselectLegion` is a
   `LOCAL_ONLY` command (`sync.ts:521-528`). That is why *everything published after that stopped*.
   Clicking his OWN stack restores the true set and the move publishes, so for the active seat this
   is a TRAP rather than an absolute lock — but from the owner's side it is "I click and nothing
   moves", repeated.
3. **The seam.** The painted set derives from `activePlayer(state)` = `players[activePlayerIndex]`
   (`MasterBoardView.tsx:211-217`), while the click gate derives from `isMyTurn`/`actingPlayerIds`
   (`sync.ts:485-513`), which can legitimately name a DIFFERENT player (`pendingDice`, `battle`,
   `activeEngagement`) — and **the rings are not gated by `interactive` at all**.
4. **The same seam bites the non-active client.** `preserveLocalUi` keeps `selectedLegionId` across
   adoptions (`sync.ts:439-444`), so the other client carried its own selection into the opponent's
   turn and painted **12 preview fields** during p0's Move while every click was refused by the
   spectator gate (`App.tsx:410-412` → `:485`/`:518`). A player who is merely watching sees
   action-looking fields that do nothing.

Ruled out by the probe, with evidence (do not re-investigate): the state (the engine says movable and
a browser moves it), the seat/id translation, `diceMode`/pending-throw, the S6 stale `legalHexes`
(write-only), a preserved selection entering the Move phase (`beginMovePhase` clears it,
`GameEngine.ts:796`), a stuck move animation, and a roll-display mismatch.

## What to build

**One authority, three consumers.** The same predicate must decide (a) whether the board is
interactive, (b) which fields are PAINTED as actionable, and (c) whether a click is accepted.
`actingPlayerIds` is the correct authority — it already accounts for a pending throw, a battle and an
engagement — so the PAINT must stop using a different one. Where the two genuinely must differ (an
enemy preview is a feature: it answers "what could this stack do?"), the difference must be VISIBLE
and must never swallow a click.

1. **Never paint an actionable-looking field that a click will refuse.** If the local player may not
   act, the board paints no actionable fields.
2. **No silent deselect.** A click that is not a legal move must produce a VISIBLE message saying
   why — "not a legal destination for this legion with a roll of 3", "that is an opponent's legion;
   its fields are only a preview", "it is not your turn" — through the app's ONE existing error/
   message surface. A click must never silently change state so that the highlights vanish.
   (`AGENTS.md` rule 1: no silent fallbacks.)
3. **Keep the enemy MOVE PREVIEW as a feature, clearly distinct from your own legal destinations** —
   or remove it while it is not your turn, if you can show that is the better call. Decide, justify
   it in the report, and make the two states tell themselves apart at a glance.
4. **Do not break deselection.** Clicking empty space / Escape must still deselect. The rule is about
   a click on a FIELD that is not a legal destination.

## Pins — each phrased as a statement

- **The painted actionable set EQUALS the accepted set**, for any state: whatever is painted as a
  destination is clickable, and nothing else is painted as one. Assert this as a property over
  several states (your turn; an opponent's legion selected; not your turn; a battle pending).
- **With an opponent's legion selected, a click on a previewed field does NOT silently deselect**:
  the selection survives, a message is surfaced, and NOTHING is published. (The owner's exact trap,
  and the pin that must fail without the fix.)
- **As the non-active player the board paints no actionable fields**, and a click surfaces a reason
  instead of doing nothing.
- **A legitimate move by the active player still publishes exactly one snapshot** — the probe's
  single-client and two-client sequences must both still move and publish (a regression guard).
- **Deselecting on empty space still works**, and publishes nothing.

## The reproduction you should reuse — do not rebuild it

A read-only probe already built a faithful harness against the owner's REAL data, and it is on disk:
**`.gate-logs/probe-stuck/repro.py`** (CDP driver with real `Input.dispatchMouseEvent`, Python fake
ServerStore on the same origin) and **`.gate-logs/probe-stuck/fixture.json`** (all 21 objects read
from the live database, sha256-verified). It builds the app with
`VITE_SERVERSTORE_URL=/storeapi` into `.gate-logs/probe-stuck/dist`. Its engine ground truth, for
the owner's state: leg-1@100 with roll 3 reaches `[5,141,1]`, leg-3@22 with roll 3 reaches
`[2000,6000,25]`, and leg-1 with roll 6 reaches 45 hexes. **Reuse this harness; copy what you need
into your own worktree.** Do not point it at the live store, and never use a real key.

## Verification (yours)

1. The ONE gate command from the **root of your worktree**: `bash scripts/gate.sh`. A fresh worktree
   needs `(cd web && npm ci)` ONCE first or it exits 1 at preflight. Exit `9` = lock busy → retry.
2. Your **own differential**: arms with PRINTED hashes, lock held, restore from `HEAD` in a `trap`.
   **COMMIT BEFORE YOU INJECT.** **Arm A must be the defect itself** — restore the silent deselect
   (or the ungated paint) and watch the named pin go RED.
3. **A browser check is REQUIRED** — this bug is invisible to a DOM-free suite and was found by a
   browser. Use `scripts/browser-check/` (README records the method) and the probe's fixture.
4. Commit, rebase on `origin/master`, push your branch.
5. **If you cannot finish, COMMIT the coherent partial state and report BLOCKED.**

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` row **13** (carrying the probe's evidence, since this is the diagnosis of a
live bug); `docs/BOARD.md` (turn the `IN-FLIGHT` line into `LANDED`); `docs/ARCHITECTURE.md` (a seam
row: **"who may act now" has ONE authority, and paint/click/interactive all read it** — this is the
duplication that caused the bug, so the row is the prevention); carry the `COPIES:` line.

## Your report (short)

LANDED or BLOCKED, then: sha; gate exit + counts + peak; each arm with its printed hash and what
went red; the `COPIES:` line; **what the board does now when an opponent's legion is selected, as
OBSERVED IN THE BROWSER**; your judgement call on the enemy preview; your judgement calls; the docs
you amended; and anything this brief got wrong.

Report NOTHING in between — silence until LANDED or BLOCKED.
