# Architecture — the seam index

The seam index answers *"how does this codebase work, and where is the ONE place that
does X?"* — the layer map, the seam rows, the gotchas and the known debt. It is what a
brief is scoped against and what a writer reads before touching an area.

The point of it: **duplication is invisible when a copy is BORN.** Nothing fails, and
each copy is correct where it was written. So the index is what makes "there is one way
to do this" a fact you can check rather than a thing everyone remembers.

> **Status: PARTIALLY SURVEYED.** The layer map below is taken from the project's own
> `web/README.md` (authored by the owner, not by an agent). **Section 2 is not yet
> surveyed** — no dispatcher session has walked `web/src` seam by seam. Treat a missing
> row as *unknown*, not as *absent*: do not cite this file as proof that a seam does not
> exist. Filling it in is legitimate work for a read-only probe.

## The rule

- **An index entry is CHECKABLE, never prose.** It names a seam and where it lives.
  "We agreed there is one way to do X" is not an entry; `escapeHtml — src/lib/text.ts:14`
  is.
- **Updated in the same commit as the change.** A landing that adds, moves or deletes a
  seam updates its row in that landing. An unamended seam is treated as missing.
- **A decision is history; a seam is the present.** Superseded decisions go to the
  [decision ledger](DECISION-LEDGER.md) and stay there.
- **The index does not restate behaviour.** Behaviour lives in a test. The row holds the
  pointer.
- **Obligation before the work:** when a change touches more than one site, or the same
  idea is found written twice, the FIRST examination is whether one seam can carry it —
  never how to fix each copy. The answer is written down in the brief and the landing as
  the `COPIES:` line (see [`BRIEF.md`](BRIEF.md)).

## 1 · Layer map

Two trees, one product. **`Colossus/` is not built here** — see `AGENTS.md §Host facts`.

| Path | What it is | May depend on |
| --- | --- | --- |
| `web/src/variant/` | board construction, ported from Java `MasterBoard` | `types` |
| `web/src/engine/` | game phases, movement, recruit, battle — the rules core | `variant`, `types` |
| `web/src/ai/` | random-legal + heuristic AI (move/battle/split evaluation, muster search) | `engine`, `variant` |
| `web/src/ui/` | non-React UI logic (dice physics, animation, path tween, speed) | `engine` |
| `web/src/components/` | React views (master board SVG, battle, controls, connection and lobby panels) | `engine`, `ai`, `ui`, `net` |
| `web/src/persistence/` | save/load | `engine`, `types` |
| `web/src/net/` | ServerStore transport, the multiplayer lobby, **and turn sync** — **no React** | `types`, `persistence` (the ONE save serialiser), engine types |
| `web/src/sim/` | headless simulations + tournaments (`npm run simulate`, `tourney`) | `engine`, `ai`, `variant` |
| `web/public/variants/**` | **generated + tracked** variant JSON (see `AGENTS.md` fact 3) | — |
| `Colossus/**` | original Java implementation — **reference only, not buildable here** | — |
| `docs/rules/` | authoritative rules references + the project's own `COMPLIANCE.md` matrix | — |

Dependency direction is asserted from `web/README.md` and directory shape, **not** yet
verified by import analysis. Verify before relying on it.

**The state-flow direction (one arrow each way, and they meet at one setter).**

```
board input ─▶ commitPath.local(reducer, command) ─▶ putState(next) ─▶ publishSnapshot ─▶ ServerStore
                                                        ▲
ServerStore ─▶ pollLatest ─▶ fetchLatest ─▶ commitPath.remote(body) ─▶ adopt(state) ─┘
```

A LOCAL command and a REMOTE adoption both end at the same `putState`; only the
local side publishes. `App.tsx` has no other write to the game state, so "no
path changes state without publishing" is structural rather than a convention.

## 2 · The one way to do X

| Seam | The ONE way | Where | Notes |
| --- | --- | --- | --- |
| Master-hex gate shapes | `archGeometry` / `blockOutline` / `arrowTriple` / `gateLen` / `pts` | `web/src/components/gateGeometry.ts` | Pure maths, **no React**, so it is directly testable and the component file exports components only. Ported from `GUIMasterHex.drawGate()`. **ARCH must stay a rounded cap + stem, never the BLOCK rectangle** — `masterHexGates.test.ts` pins both the geometry and the renderer's dispatch; see decision-ledger row 5. |
| Store transport | `ServerStoreTransport` (`list` / `get` / `put` / `remove` / `whoami`) over one `(store, name)` pair | `web/src/net/transport.ts` | **Nothing above `web/src/net/` may import `fetch`.** The store name is a PARAMETER, never a constant (FORK 2 is settled as the honour system but the seam keeps the choice open). Object names are validated HERE, once, for both implementations. A failure is a thrown `ServerStoreError` carrying the service's `code` **and** `message`. Two implementations behind it: `serverStore.ts` (HTTP) and `memoryTransport.ts` (no wire). The shared contract suite runs against both — `transportContract.test.ts`. |
| Where the player's key lives | `localStorage` entry `colossusweb.key.v1`, written ONLY by `writeStoredKey` | `web/src/net/keyStorage.ts` | The owner's rule (`docs/design/multiplayer.md` §4.1): the key is validated by `whoami` **before** it is persisted, re-validated on load and removed if it fails. "Forget key" clears it. Never `sessionStorage`, a cookie, the URL, `history` or a log — `keyPersistence.test.ts` asserts that over the REAL browser objects (`// @vitest-environment jsdom`). The ordering lives in `connect.ts`; the memory copy in `keyStore.ts`. |
| A failure → the screen | `describeFailure` (title + the service's `code` and `message`, verbatim) | `web/src/net/failure.ts` | The ONE mapping; `useConnection` and `LobbyPanel` both render its result and neither invents a message. The title is chosen by code class, so a lobby refusal (`game_full`) is never captioned as a key problem. |
| A game's object names and record shapes | `GameRecord` / `PlayerRecord` + `gameObjectName` / `playerObjectName` / `parseGameObjectName` / `parseGameObjectRecord` / `parseGameRecord` | `web/src/net/gameRecord.ts` | The ONLY place `g.<gameid>.game` and `g.<gameid>.p.<tag>` are built and parsed. `gameid` is a ≤23-char slug + 8 random hex (`MAX_GAME_ID_LENGTH = 32`), so both object names fit the service's 64-character rule regardless of the display name; the tag is the first 8 lowercased characters of the full id (`playerTagFor`), while the full id rides in the body. A body that does not parse is a thrown `bad_game_record` / `bad_player_record` / `unsupported_record_version` — never empty data. |
| A lobby operation | `createGame` / `listGames` / `joinGame` / `leaveGame` / `startGame` / `readLobby`, over a `LobbyContext` | `web/src/net/lobby.ts` | The ONE way to Create, Join, Start, Leave and discover games. Each rule is a predicate (`joinBlockedReason`, `startRefusal`) used by BOTH the operation and the UI, enforced before any write; every refusal is a thrown `ServerStoreError`, never a silent no-op. Discovery is the store's own list route filtered client-side; an unreadable game is reported in `GameListing.unreadable`, never dropped. No `fetch`, no React, no polling (S3 owns sync) — `lobby.test.ts` drives it against both transports. |
| Which store the lobby talks to | `serverStoreName()` (default `colossus`) | `web/src/net/storeName.ts` | The ONE place the store's name is decided; `VITE_SERVERSTORE_STORE` overrides it, exactly as `VITE_SERVERSTORE_URL` overrides the base URL. The store stays a PARAMETER of every transport call, so partitioning remains a config change. |
| A game's seats | `seatOrderFor` / `seatIndexOf` + `GameRecord.seatOrder` | `web/src/net/gameRecord.ts` | The ONE seat mapping: creator first, then the joined sorted by tag, written by the creator at Start and read by everyone. The record is schema **v2** and `seatOrder` is REQUIRED and status-dependent (empty in `lobby`, ≥2 distinct ids in `started`); a v1 record is `unsupported_record_version`, never guessed. A spectator is `-1`, never seat 0. |
| A snapshot's name and body | `snapshotObjectName` / `parseSnapshotObjectName` / `serializeSnapshot` / `parseSnapshot` / `detectFork` / `chooseSnapshot` | `web/src/net/snapshot.ts` | The ONE place `g.<gameid>.s.<tttt>.<sss>.<tag>` is built and parsed. The name IS the ordering; the body is a header plus `serializeGame`'s blob. A turn/seq whose padding would sort wrongly and a name that disagrees with its own body are thrown `ServerStoreError`s. No key material, no `variant` payload. See the gotcha below for what `sss` actually counts. |
| A local state change | `createCommitPath` (`local` / `remote` / `publishCurrent`) | `web/src/net/sync.ts` | The ONE path a command takes (`App.tsx` has no other write to the game state). `local` updates state AND publishes exactly one snapshot for a shared command; UI-only selection publishes nothing and a pending physical throw defers until committed. `remote` adopts through the same seam and NEVER publishes. |
| State → the store, and back | `publishSnapshot` / `fetchLatest` / `adopt` | `web/src/net/sync.ts` | The ONE writer/reader of game state. `adopt` is `deserializeGame` (the ONE deserialiser — migration included) plus the local UI-only fields (`selectedLegionId`, `legalHexes`); `fetchLatest` takes the greatest name and returns any FORK rather than resolving it silently. |
| Whose turn it is | `actingPlayerIds` / `isMyTurn` | `web/src/net/sync.ts` | The ONE turn-authority predicate, and it is the STATE's answer, not a claim: the active seat, the battle step's `activePlayerId`, the thrower of a pending physical roll, the defender awaiting a post-battle reinforcement, or BOTH parties to a pre-battle engagement. It feeds the board's `interactive` flag; the engine's own refusal is the backstop. |
| Watching the store | `pollLatest` + `browserVisibility` | `web/src/net/sync.ts` | The ONE poll loop: ~2s, ONE request in flight, **no request at all while the tab is hidden**, exponential backoff on error, and a `stop()` handle plus an `AbortSignal`. The lobby deliberately does not watch the store. |
| The game to resume | `rememberActiveGame` / `readActiveGame` / `forgetActiveGame` | `web/src/net/activeGame.ts` | The ONE local pointer (`colossusweb.multiplayer.v1`) and it holds a game id and nothing else. It is what makes a reload offer to ADOPT a started game instead of starting a fresh one; a pointer to a deleted game is forgotten, a corrupt one is loud. |
| The multiplayer status line | `MultiplayerStatus` (seat, turn, read-only, poll state, fork, failure) | `web/src/components/MultiplayerStatus.tsx` | Presentational, so "it says whose turn it is" and "a fork is surfaced" are checkable with `react-dom/server`. |
| *(rest not yet surveyed)* | | | |

## 3 · Gotchas

- **`npm run convert` regenerates TRACKED files.** `web/public/variants/**` (1372 paths)
  is build output that lives in git, produced by `web/scripts/convert-variant.mjs` from
  `Colossus/variants/*.xml`. It looks like source; it is not. Editing it by hand creates
  a change the next `convert` silently reverts.
- **The build the gate makes is NOT the build that gets deployed.** `web/vite.config.ts:33` is
  `base: process.env.COLOSSUS_BASE ?? '/'`. The gate's cheap tier builds with the default `/`,
  but the app is served under the subpath `/ColossusWeb/`, so publishing requires
  `COLOSSUS_BASE=/ColossusWeb/`. A root-absolute base-`/` build served under a subpath renders a
  **BLANK page**, and **the gate would not catch it** — the two artifacts differ only in this env
  var. Always verify with `grep -o '/ColossusWeb/assets/[^"]*' web/dist/index.html` before
  publishing.
- **`GameState.turnNumber` is the ROUND, not one player's turn.** `GameEngine.ts:1137`
  (`advanceToNextLivingPlayer`) increments it only when the active seat wraps past the
  last, so in a 3-player game `activePlayerIndex` runs 0 → 1 → 2 while `turnNumber`
  stays 1 (measured with a probe, 2026-09-28). Anything that orders or timestamps
  per-player turns must NOT use `turnNumber` alone: the snapshot protocol's `sss`
  component is the successor of the counter of the snapshot a state was derived from
  (`net/snapshot.ts`), which is what keeps the name monotonic within a round. An
  independent per-writer counter here would silently lose moves.
- **The rules test suite is organised by rule family, not by module.**
  `web/src/engine/__tests__/rules-*.test.ts` and `docs/rules/COMPLIANCE.md` are the
  project's own coverage map — check it before writing a new rules test, so a second
  fixture set is not born.

## 4 · Known debt

- **This index is not surveyed** (section 2 empty). Cost: briefs cannot name a seam from
  the index and must name `file:line` directly. A fix is a read-only probe over
  `web/src/**` producing rows.
- **The Java reference has no compile check on this host.** Cost: a "port matches Java"
  claim rests on reading source, not on execution. See `AGENTS.md §Host facts`.
- **No pin covers the deployed subpath build.** Cost: a change that breaks
  `COLOSSUS_BASE=/ColossusWeb/` (or a base regression) passes the gate and ships a blank page;
  only the pre-publish `grep` above catches it. A fix would run the subpath build in the gate.
- **`deploy-sync.ps1` / `deploy-clean.ps1` are dead and misleading.** They still FTP to the
  retired `www.futuremagic.de` host (Migration README retirement item 6), and `BUILD.md` / `README.md`
  still describe `ant` builds that cannot run here. Cost: a new contributor follows them into a
  dead target.
