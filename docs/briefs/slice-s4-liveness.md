# Slice S4 — lobby liveness (the owner's first live test)

**Ledger row: 10.** Board line: the `IN-FLIGHT` row for `liveness`.

Read `AGENTS.md` first, then `docs/design/multiplayer.md` §4.2 (the lobby) and §4.3 (turn sync).
S1 (transport), S2 (lobby) and S3 (turn sync) are landed and verified on `master`. This slice
changes LOBBY behaviour only; the game's sync is S3's and already works.

## What the owner actually did and saw (his words)

> "I was able to create a multiplayer game in browser A. I was able to join that game in browser B
> (so far so good). Browser A does not see that Browser B joined. Maybe poll every 10 seconds or
> something like that? Or is there a more elegant way? I see no way to start the multiplayer game.
> But that maybe connected to the prior problem."

**Both symptoms have ONE cause, and the second is the first's consequence:** the lobby never
refreshes, so browser A still believes it is alone — and because Start requires two joined players
*as the creator's own view sees them*, A's Start stays disabled. The owner reasonably read that as
"there is no way to start".

The current design says so explicitly (`LobbyPanel.tsx:20-22,297-299`): *"nothing polls… the lobby
does not poll the store: WATCHING it is the game's job (`net/sync.ts`), and a lobby that watched
would be a second poll loop."* **That constraint was right when it was written and is now wrong:
the lobby must be live, and the "second poll loop" worry is answered by ONE loop doing both jobs.**

## What to build

1. **ONE session-level poll loop, not two.** The session already polls during a game
   (`net/sync.ts`). Extend THAT loop — one timer, one cadence decision, one visibility rule — to
   also do the lobby's job:
   - in the LOBBY: refresh the game list and the active game's participant list;
   - in a GAME: fetch the latest snapshot (existing behaviour, unchanged).
   A second independent timer is a defect, not an implementation detail: assert ONE.
2. **Cadence ~5s in the lobby** (a game keeps its existing ~2s, where turn latency matters).
   Justify the number in a comment. **Only while the tab is visible**, with **backoff on error**,
   and a **stop handle** on teardown — S3's poll already has these; reuse them, do not copy them.
3. **A freshness signal in the UI** so a list that has not changed does not look broken: e.g.
   "updated 3s ago" / a live indicator beside the lobby list, and the existing "Refresh games"
   button stays. A user must be able to tell "nothing has changed yet" from "this is dead".
4. **Make Start's blocking reason impossible to miss.** The creator with one player must see the
   Start control AND a plain reason ("waiting for a second player — 1/2 joined"), not just a
   disabled button. When the second player appears, Start becomes enabled without any manual
   action. Keep it honest: this is the rule working, not an error.
5. **Make the participants visible in the active game** so the creator watches players arrive —
   the thing the owner was looking for.
6. Update the comments and docs that assert "the lobby does not poll" so the record does not
   contradict the code (that comment is now a lie).

## Pins — each phrased as a statement

Reuse the existing harness; drive everything against S1's **in-memory twin**, never the live
service.

- **The lobby refreshes on the poll while visible** — a game created by another writer appears in
  the list within one tick, with NO manual refresh.
- **A second player joining appears in the creator's active-game view within one tick**, and
  **Start becomes enabled as a result** (the owner's exact scenario, end to end).
- **Exactly ONE poll loop exists**: while the lobby is open there is ONE timer and ONE list
  request per tick — not two loops, not two requests.
- **The poll makes NO request while the tab is hidden**, and stops on teardown.
- **The Start blocking reason is rendered** for the creator with one player (assert the text, not
  merely that the button is disabled).
- **A poll failure backs off and is surfaced** — never silent (`AGENTS.md` rule 1) — and a
  subsequent success recovers.
- **Your own action still refreshes immediately** (no waiting for a tick).

## Out of scope — say so if tempted

Any ServerStore change (a `since=`/prefix filter, a push channel); auto-starting a game; changing
the game's own sync cadence or its pins; per-player stores or encryption (owner-declined).

## Verification (yours)

1. The ONE gate command from the **root of your worktree**: `bash scripts/gate.sh`. A fresh
   worktree needs `(cd web && npm ci)` ONCE first or the gate exits 1 at preflight. Exit `9` = lock
   busy → wait and retry.
2. Your **own differential**: arms with PRINTED file hashes, lock held before injecting, restore
   from `HEAD` in a `trap`. At least one arm must make a NAMED pin go RED. **The file must be
   COMMITTED before you inject** — `git checkout --` restores HEAD and will wipe an uncommitted
   change (that trap cost the dispatcher a fix this session).
3. Commit, rebase on `origin/master`, push your branch.
4. **If you cannot finish, COMMIT the coherent partial state and report BLOCKED.**

**Do not seek or use a real key, and add no test that calls the live service.** The owner tests
live; your evidence is the in-memory twin.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` row **10**; `docs/BOARD.md` (turn the `IN-FLIGHT` line into `LANDED`);
`docs/ARCHITECTURE.md` (the loop is now ONE seam serving two jobs — update the state-flow row);
carry the `COPIES:` line.

## Your report (short)

LANDED or BLOCKED, then: sha; gate exit + counts + peak; each arm with its printed hash and what
went red; the `COPIES:` line; **the cadence you chose and why**; how a join reaches the creator;
your judgement calls; the docs you amended; and anything this brief got wrong.

Report NOTHING in between — silence until LANDED or BLOCKED.
