# Slice S3 — turn sync: make a started game PLAYABLE

**Ledger row: 9.** Board line: the `IN-FLIGHT` row for `sync`.

Read `AGENTS.md` first (binding rules), then `docs/design/multiplayer.md` §4.3 (turn sync) and
§4.1 (identity). S1 (transport) and S2 (lobby: Create/Join/Start) are **landed on `master`** and
verified. Build on them — `web/src/net/` is the ONLY way to the store, and `serializeGame` /
`deserializeGame` in `web/src/persistence/saveGame.ts` is the ONLY state serialiser.

## The intent

The owner's lobby criteria are met; a game that starts but never syncs is not multiplayer. This
slice makes **moves made by one player reach the others**, so a started game is actually played.

## The snapshot protocol (binding)

The authoritative state is **the latest snapshot object**. After a local command the acting
client writes a new one; everyone else polls, notices it and adopts it.

**Name** — the service caps names at 64 chars and sorts them lexicographically, so the name
IS the ordering. Use zero-padded fields:

    g.<gameid>.s.<tttt>.<sss>.<tag>

- `tttt` = the state's `turnNumber`, zero-padded to 4; `sss` = a per-writer counter within that
  turn, zero-padded to 3 (reset each turn). Padding makes "greatest name" = "newest state" with
  no clock trust. **Assert the longest legal name still fits 64** — `gameid` is ≤32 by S2's
  `MAX_GAME_ID_LENGTH`, the tag is 8, so the budget is known; do not let it drift.
- The **tag** is the writer's S2 player tag (first 8 lowercased chars of the full id). Two
  writers at the same (turn, seq) therefore produce two DIFFERENT names — a race is a visible
  fork, never a silent lost update. The service has no ETag/If-Match, so this is the whole
  concurrency story.

**Body** — JSON: a small header plus the game state.

- header: `schemaVersion`, `name` (its own object name), `gameId`, `turn`, `seq`, `writerTag`,
  `seat` (the writer's seat index), `parent` (the FULL NAME of the snapshot it was derived
  from — see the adoption rule), `createdAt`.
- state: the output of `serializeGame(state)` (which already strips `variant`). Do not invent a
  second serialiser, and do not put `variant` in a snapshot: every client loads the same variant
  from the game record.

**Adoption rule (precise, because it must be deterministic):** pick the **greatest name** among
the game's snapshots. If more than one snapshot exists at that same (turn, seq) — a fork — do
NOT resolve it silently: **surface it loudly** and then pick deterministically: the one whose
`parent` equals the name of the snapshot currently held, else the lowest tag. Record the fork so
a human can see it happened. (Resolving forks automatically is NOT this slice.)

## Seat mapping

`GameState` has `activePlayerIndex`; the game has human players who joined in S2. They must
agree on which index is whose:

- Extend S2's game record with an explicit **seat order** written by the creator at **Start**:
  the creator first, then the other joined players in a deterministic order (sort by tag), so
  every client derives the SAME mapping. Bump the record's `schemaVersion` and keep the parser
  strict — an old record without a seat order is a loud error, not a guess.
- The local player's seat = the index of their own **full id**'s tag in that list. A spectator
  (joined but not seated) must be told so, not silently treated as seat 0.

## Turn authority — and its honest limit

Enable the local player's input **only when it is their seat's turn**; when it is not, the board
is read-only and says whose turn it is. There is **no server authority**, so this is a UI rule
plus the engine's own refusal — `applyCommand` already rejects an illegal command into
`state.message`, which is the backstop, not the mechanism.

**AI seats are OUT OF SCOPE.** Multiplayer seats are humans who hold keys. If a started game
contains an AI seat, refuse to start it loudly (or file it as unsupported) rather than have two
clients each drive the same AI and diverge. Say which you chose.

## What to build

1. **`web/src/net/snapshot.ts`** — the name builder/parser, the body shape, `parse`/`serialize`
   with LOUD validation (`ServerStoreError`, the app's one error surface), and the ordering +
   fork-detection helpers. Pure, no React, no fetch: those helpers are what the pins test.
2. **`web/src/net/sync.ts`** — `publishSnapshot(transport, identity, record, state)`,
   `fetchLatest(transport, gameId)`, `adopt(remote, local)` (state in, state out, preserving the
   UI-only fields), and a polling loop helper with an explicit interval and an `AbortSignal`/stop
   handle. Interval ~2s, **only while the tab is visible**, with backoff on error.
3. **Wire it into the app at the ONE seam.** `web/src/components/App.tsx` already owns applying a
   command (`apply`, ~line 159) and also calls `engDispatch` directly in a few places — funnel
   those through ONE local-commit function so every local command both updates state AND
   publishes a snapshot. Do not leave a path that changes state without publishing.
4. **Resume**: when a player opens or reloads a started game, adopt the latest snapshot rather
   than starting a fresh local game. The lobby's Start hand-off becomes: creator publishes the
   first snapshot, everyone else adopts it.
5. **UI**: whose turn it is, the connection/poll state, a fork warning, and the existing
   refresh/error surfaces. Keep it small and in the app's existing style.

## Pins — each phrased as a statement

Reuse the existing harness (`web/src/**/__tests__/`, `environment: 'node'` by default,
`// @vitest-environment jsdom` where browser objects are needed). Drive everything against the
**in-memory twin**; never the live service.

- **Names sort into state order** — the greatest name is the newest state, including across a
  turn boundary and at 3-digit seq rollover (assert the padding, and assert the longest legal
  name still fits 64).
- **A published snapshot round-trips** — publish, then `fetchLatest`, and the state deserialises
  to an equal state (compare on a normalised copy; the dice ids are `Date.now()`+`Math.random`
  and MUST be excluded or normalised, or the comparison is flaky).
- **A local command publishes exactly one new snapshot** and the object name encodes the new
  turn/seq.
- **A remote snapshot is adopted**, and adopting preserves the local UI-only fields (selection,
  animation) rather than resetting them.
- **Two writers at the same (turn, seq) produce two distinct names** and the fork is SURFACED,
  not silently resolved; adoption is still deterministic.
- **Input is disabled when it is not my seat's turn**, and enabled when it is.
- **Polling stops** when the view is torn down and while the tab is hidden.
- **A resume adopts the latest snapshot instead of starting a new game.**
- **No snapshot body contains key material**, and no state serialisation drops a field silently
  (`deserializeGame` already migrates — use it).

## Out of scope — say so if tempted

Resolving forks automatically (detect and surface only); AI seats; per-player stores, dice
commit-reveal, encryption (**declined by the owner — do not build**); any change to the rules
engine; a push/WebSocket transport (the store has no push channel).

## Verification (yours)

1. The ONE gate command, from the **root of your worktree**: `bash scripts/gate.sh`. A fresh
   worktree needs `(cd web && npm ci)` ONCE first, or the gate exits 1 at preflight. Exit `9` =
   lock busy → wait and retry.
2. Your **own differential**: arms with PRINTED file hashes, lock held before injecting, restore
   from `HEAD` in a `trap`; at least one arm makes a NAMED pin go RED.
3. Commit, rebase on `origin/master`, push your branch.
4. **If you cannot finish, COMMIT the coherent partial state and report BLOCKED.**

**Do not seek, use, print or commit a real access key, and add no test that calls the live
service.** An authenticated round trip needs a key neither you nor the dispatcher holds; the
live refusal path is already proven. Your evidence is the in-memory twin.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` row **9**; `docs/BOARD.md` (turn the `IN-FLIGHT` line into `LANDED`
with your numbers); `docs/ARCHITECTURE.md` (the new seams and the state-flow direction); and
carry the `COPIES:` line.

## Your report (short)

LANDED or BLOCKED, then: sha; gate exit + counts + peak; each arm with its printed hash and what
went red; the `COPIES:` line; how a move actually reaches the other player; your judgement calls
(especially the AI-seat decision and the turn-authority predicate you used); the docs you
amended; and **anything this brief got wrong**.

Report NOTHING in between — silence until LANDED or BLOCKED. If you can PROVE a rule here is
wrong, report BLOCKED with the evidence rather than implementing it.
