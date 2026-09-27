# Slice S2 — the lobby: Create / Join / Start

**Ledger row: 8.** Board line: the `IN-FLIGHT` row for `lobby`.

Read `/home/administrator/projects/ColossusWeb/worktrees/lobby/AGENTS.md` first (binding
rules), and `docs/design/multiplayer.md` §4.2 for the object protocol this implements. S1 is
**landed** on `master`: `web/src/net/` holds the transport interface, the HTTP client, the
in-memory twin, the validated key and the connect panel. Build on it; do not re-invent it.

## The owner's request (verbatim) and the intent

> "I would like to have the following in the end:
> * Create Multiplayer
> * Join Multiplayer
> * Start Multiplayer (only available to the creator)"

Intent: a player can **create a named game**, other players can **find and join it**, and the
**creator starts it**. This slice is the LOBBY LIFECYCLE only — it does not sync any game
state. That is S3, and must not appear here.

## The object protocol (from the design, and it is binding)

A game is objects in the `colossus` store. Object names must satisfy the service's rule
`[a-z0-9][a-z0-9._-]{0,63}` — **lowercase, ≤64 chars, no directories** — so a display name
("Tom's Game!") must be slugified for the NAME while the display name lives INSIDE the body.

- **`g.<gameid>.game`** — written **only by the creator**: at *Create*, and again at *Start*
  to flip the status. Exactly one writer, so it can never be clobbered.
- **`g.<gameid>.p.<playerid>`** — one object **per player**, written by that player when they
  join. `playerid` comes from `whoami().id` (lowercased; validate it against the name rule
  and refuse loudly if it cannot be made legal). Written by its owner, so two joins never race.

`gameid` = a lowercase slug of the display name plus a short random suffix, so two games with
the same name get different ids and cannot overwrite each other.

**Discovery is the store's own list route**, filtered client-side to names matching
`^g\.[a-z0-9._-]+\.game$`. There is no directory and no query API; do not invent one.

The store name is a **parameter of the transport** and must come from config, not a literal
sprinkled through the code: add a store-name setting (`colossus` as the default, overridable
like `VITE_SERVERSTORE_URL` already is in `web/src/net/serverStore.ts`).

## What to build

1. **A game-record module** — the plain-data shape of `g.<gameid>.game` (display name,
   variant, creator identity, `status: 'lobby' | 'started'`, max players, createdAt, and a
   schema version) and of a player record, with **parse and validate** functions. A body that
   does not parse is a LOUD failure, never a silent skip (`AGENTS.md` rule 1) — but one
   unreadable game must not make the whole lobby unusable, so say how a caller distinguishes
   "not a game" from "a game I cannot read".
2. **The lobby operations** over the transport: `createGame`, `listGames`, `joinGame`,
   `startGame` (and `leaveGame` if it falls out cheaply). Each takes the transport and the
   caller's identity; none of them imports `fetch`.
3. **The rules, enforced before any write:**
   - *Start is the creator's alone.* Refuse — do not write — when the caller is not the
     creator. This is a client-side rule (there is no server authority, `docs/design/
     multiplayer.md` §4.2); implement it as a guard that **fails loudly**, not a silent no-op.
   - Refuse to join a game that is already started, is full (`maxPlayers`), or that the caller
     is already in (joining twice must be idempotent, not a second object).
   - A *Start* on a game already started is refused, not repeated.
4. **The UI**: the three actions on the setup/lobby screen, reachable once a key is connected
   (S1's `ConnectPanel` shows identity). Create takes a display name (and the variant the app
   already lets you pick); Join lists the joinable games the store returns; Start appears
   **only for the creator** and is clearly the creator's action. Show refusals with the
   service's own code and message — never a blank or a silent reset.
5. **Hand-off**: `startGame` flipping the status is the end of this slice. Hand the started
   game to the existing new-game flow so the app can begin a local game exactly as it does
   today. Do NOT publish or poll any game state.

## Pins — each phrased as a statement

Reuse the existing harness (`web/src/**/__tests__/`, `environment: 'node'` by default,
`// @vitest-environment jsdom` where you need browser objects — `jsdom` is already a
devDependency because of S1). Drive the lobby against the **in-memory twin** and the
**stubbed HTTP client**; never the live service (see below).

- **Create writes exactly ONE object**, its name matches `g.<gameid>.game`, and its body
  parses as a lobby-status game record.
- **The name is legal whatever the display name is** — assert a name with spaces, capitals,
  punctuation and a very long string still yields an object name matching the service rule.
- **Two games created from the same display name get different `gameid`s** and do not touch
  each other's objects.
- **Join writes the caller's OWN `p.<playerid>` object** and modifies nothing else — assert
  the game object and another player's object are byte-identical afterwards.
- **Joining twice is idempotent** — one object, not two, and the body is unchanged.
- **Start is refused for a non-creator, and writes NOTHING** — assert no write happened, not
  merely that an error was thrown.
- **Start flips the status exactly once**; a second Start is refused.
- **Join is refused for a started game and for a full game**, and writes nothing.
- **Discovery ignores non-game objects** and surfaces an unreadable game record rather than
  silently dropping it.
- **No object body ever contains key material** (no key, no hash, no prefix).

## Out of scope — say so if you are tempted

Game-state sync, snapshots, polling, turn authority (S3); fork detection and resume (S4);
per-player stores, dice work, encryption (S5 — **declined by the owner**, do not build them);
any change to how a hotseat game plays.

## Verification (yours)

1. The ONE gate command from the **root of your worktree**: `bash scripts/gate.sh`. A fresh
   worktree needs `(cd web && npm ci)` ONCE first or the gate exits 1 at preflight (that is a
   preflight failure, not a test failure). Exit `9` = lock busy → wait and retry.
2. Your **own differential**: arms with PRINTED file hashes, the lock held before injecting,
   restore from `HEAD` in a `trap`. At least one arm must make a NAMED pin go RED.
3. Commit, rebase on `origin/master`, push your branch.
4. **If you cannot finish, COMMIT the coherent partial state and report BLOCKED.**

**One thing you cannot do, so do not pretend otherwise:** a real authenticated round trip
needs a valid key, and neither you nor the dispatcher holds one. Do not go looking for one, do
not put one in the repo, and do not add a test that needs the live service. What CAN be proven
without a key is that the client parses the live service's refusal; the dispatcher already did
that, so do not repeat it.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` row **8**; `docs/BOARD.md` (turn the `IN-FLIGHT` line into `LANDED`
with your gate numbers); `docs/ARCHITECTURE.md` (the new seams); and carry the `COPIES:` line.

## Your report (short)

LANDED or BLOCKED, then: sha; gate exit + counts + peak; each arm with its printed hash and
what went red; the `COPIES:` line; how the lobby actually works; your judgement calls; the docs
you amended; and **anything this brief got wrong**.

Report NOTHING in between — silence until LANDED or BLOCKED. If you can PROVE a rule here is
wrong, report BLOCKED with the evidence rather than implementing it.
