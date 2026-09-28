# Slice S9 — game hygiene: give up a game, and delete a game you were in

**Ledger row 15.** Board line: the `IN-FLIGHT` row for `game-hygiene`. Two features the owner asked
for together; they are separate in code but both touch the lobby/game UI, so ONE writer does both.

## The owner's request, verbatim

> "Anybody needs to have the option to give up the game (outside battles is enough)"
> "Anybody with a key needs to be able to delete all games that have him as a participant. Right
> now, games just accumulate."

## Part A — GIVE UP (resign)

Any player may give up, **outside a battle** (the owner's own scope: inside a battle is not
required). It changes shared game state, so it is a COMMAND that is published like any other — it
must NOT be added to `LOCAL_ONLY_COMMANDS`.

1. **Reuse the existing ending, do not invent one.** The engine already eliminates a player and
   ends the game when only one remains (`checkTitanDeath`, `GameEngine.ts:648`). Resigning should
   route through that machinery rather than adding a second notion of "the game is over".
2. **The rules are the authority.** Establish from `docs/rules/` (authority order in
   `docs/rules/README.md`) and the Java reference what resignation does — how the legions leave the
   board, whether the opponent scores, and whether a game continues below two players. Quote
   `file:line` and the rule text in your report. **If the authority contradicts this brief, implement
   the authority and say so.**
3. **UI**: a "give up" control that is DISABLED or absent inside a battle, behind a CONFIRMATION
   (it is irreversible), and it must say clearly to the other player whose game just ended and how.

## Part B — DELETE the games you were a participant in

`leaveGame` already exists (`lobby.ts:487`) and only removes the CALLER's own join object; games
therefore accumulate. This is the cleanup.

1. **Only games the caller was IN.** A game qualifies when the caller's OWN player object exists for
   it — `player.<gameid>.<their tag>`, found with the prefix listing (S5). Do not offer to delete a
   game the caller never joined.
2. **Delete everything belonging to that game and nothing else**: the `game.<gameid>` record, every
   `player.<gameid>.*`, and every `snap.<gameid>.*`. There is no bulk API — one `DELETE` per object
   (`transport.remove`). A long game has 100+ snapshots.
3. **DELETE THE RECORD LAST.** If it fails midway, a partially-deleted game must stay VISIBLE and
   still deletable, rather than vanishing from the lobby and leaving invisible orphaned snapshots.
4. **`delete` is an OPT-IN permission and the owner's current player keys DO NOT HAVE IT** (measured:
   keys `Test` and `Test2` on `colossus` are `read,write`). So today a `403 forbidden` is the
   EXPECTED outcome. It must be surfaced **LOUDLY** with the store's own `code` and `message` plus an
   actionable sentence — *"this key cannot delete: ask the operator to grant the delete permission"* —
   and the app must NEVER claim a game was deleted when it was not. Half-done work must be reported
   as exactly what was and was not removed.
5. **Respect the rate limiter.** A big delete is many requests; use S5's retry rule
   (`nextPollDelayMs`/`Retry-After`) and show progress, so a 100-object delete does not look frozen or
   get refused halfway.
6. **UI**: a delete affordance on games the caller was in, behind a CONFIRMATION that names what is
   about to go (the game and its object count).

## Pins — each phrased as a statement

- **Giving up removes the resigner from the game and publishes**; for two players the game ends, and
  with more than two it continues — asserted against the engine, not just the UI.
- **Giving up is REFUSED (or unavailable) inside a battle**, loudly.
- **Deleting removes the record, every player object and every snapshot of THAT game** — and touches
  nothing belonging to another game (assert another game's objects are byte-identical afterwards).
- **The game record is deleted LAST** (a failure part-way leaves it visible).
- **A caller cannot delete a game they were not a participant in.**
- **A `403` (no `delete` permission) is surfaced with the store's code and message**, the app does not
  report success, and it says what remains — the owner's current situation, so it must be good.
- **A partial failure reports exactly what was and was not deleted.**

## Verification (yours)

1. The ONE gate command from the **root of your worktree**: `bash scripts/gate.sh`. A fresh worktree
   needs `(cd web && npm ci)` ONCE first or it exits 1 at preflight. Exit `9` = lock busy → retry.
2. Your **own differential**: arms with PRINTED hashes, lock held, restore from `HEAD` in a `trap`.
   **COMMIT BEFORE YOU INJECT**, and **Arm A must be the defect itself**.
3. **A browser check is REQUIRED** — both features are UI flows. `scripts/browser-check/` has a
   working CDP harness; its README records the method and its known traps (a harness may need its
   bundle built by hand first). Use a fake store that can grant/deny `delete`, so the 403 path is
   exercised for real.
4. Commit, rebase on `origin/master`, push your branch.
5. **If you cannot finish, COMMIT the coherent partial state and report BLOCKED.**

**Do not seek or use a real access key**, and add no test that calls the live service. **Do not touch
the owner's live data** — his game is in progress.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` row **15** (with what the rules say about resignation); `docs/BOARD.md`
(`IN-FLIGHT` → `LANDED`); `docs/ARCHITECTURE.md` (the lifecycle seams: resign, delete, and the
"record last" rule); carry the `COPIES:` line.

## Your report (short)

LANDED or BLOCKED, then: sha; gate exit + counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; **what the rules say resignation does, with evidence**; what the delete does
on a 403 today; your judgement calls; the docs you amended; and anything this brief got wrong.

Report NOTHING in between — silence until LANDED or BLOCKED.
