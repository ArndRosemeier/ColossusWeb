# The board — what is happening right now

**This file is the state of record.** It is true *before* any report reaches the owner.
A successor must be able to act within minutes from this file plus
`git log --oneline -10 origin/master` and `git worktree list`.

**One screen, overwritten in place.** A record that no longer describes the present
belongs in the decision ledger or nowhere.

The project's own rules are in [`../AGENTS.md`](../AGENTS.md); the shared process is
`WAY-OF-WORKING.md` in the Toolbox repo.

## The contract

1. **Updated in the same commit as the landing it records.**
2. **True BEFORE the dispatcher reports to the owner.** If this session dies the
   second after that report, a successor must be able to act from this file, the
   ledger and git alone.
3. **Every record names something checkable** — sha, branch, worktree, session id,
   path. "Probably fine" is not a record.
4. **Session start = reconcile first** (`bash scripts/board.sh`). Read it, check it
   against reality, fix what lied, report ONE line, then dispatch.
5. **Reconcile against the REMOTE branch, never a stale local one.**

## Record vocabulary

One line per record, `PREFIX | field=value | …`, so a query is a `grep` and the
answer is a line, not a paragraph.

| Prefix | Means |
| --- | --- |
| `reconciled: <sha> · <timestamp>` | the commit the rest of this file was checked against |
| `SESSION` | an actor that may dispatch (id, model, state) |
| `PROBE` | a read-only agent in flight and the question it answers |
| `IN-FLIGHT` | a writer: row, session, worktree, branch, base, **state**, and the full scope |
| `LANDED` | a verified landing: row, sha, **the dispatcher's own verification numbers**, what was retired, the docs amended |
| `PUBLISH` | a deploy to the static app host: slug, build command, target, **what was verified by CONTENT**, and the CDN state |
| `retired_branch=<name>` | a CLAIM that `<name>` is retired — the **only** form the reconciler parses, read literally, one line per branch. Prose about a retirement (especially one still OWED) must not use this key |
| `QUEUE` | owner requests and known debt not yet dispatched, with the row number reserved |
| `QUEUE-CLOSED` | a queue line whose scope is consumed |
| `TRAP` | a mistake that actually happened, with the rule that prevents it |
| `GUARD` | a mechanism protecting the process (host, memory, compaction) and how to verify it |
| `RECOVERY` | where a successor finds lost context |

**One deviation, deliberate.** A `LANDED` line for dispatcher-side setup names its
**base** and identifies its own commit as `lands=this commit`, because a file cannot
contain the hash of the commit that contains it. The `reconciled:` marker
independently names the verified base. See decision-ledger row 4.

---

## Board

```
reconciled: 6ff7115638d26f3b31d1de625ba17b7e0088d028 · 2026-09-27T23:10Z

SESSION | id=session-c415d674-2dd3-428b-97d2-809e492615e9 | model=deepseek-flash | state=dispatching to completion — OWNER AWAY, instruction "try to build this to completion"; S1 and S2 VERIFIED and RETIRED by the dispatcher, S3 (turn sync) LANDED on `feat/sync` by its writer and awaiting the dispatcher's own verification, SERIALLY because all three touch `web/src/components/App.tsx`

QUEUE | row=1 | owner: "be my chief of staff" — a designation, not yet a work order; awaiting the first task
QUEUE | row=5 | known debt: docs/ARCHITECTURE.md §2 (the seam index) is NOT surveyed — a read-only probe could fill it
QUEUE | row=6 | known debt: deploy-sync.ps1 / deploy-clean.ps1 still target the RETIRED FTP host (Migration README item 6) — now pointless; repoint at the apps root or delete
QUEUE | row=7 | known debt: the gate builds base `/` but the DEPLOYED artifact needs COLOSSUS_BASE=/ColossusWeb/ — no pin covers the subpath build, and a base regression renders a BLANK page
QUEUE | row=8 | follow-up: the superseded asset /ColossusWeb/assets/index-BOtDb2SA.js is retained only to survive the 4h CDN window on the unchanged index.html — prunable after that
QUEUE | row=9 | DESIGN ONLY, nothing dispatched: multiplayer over ServerStore. Proposal on disk at `docs/design/multiplayer.md` (constraints measured, architecture, slice plan S0-S5, pins). Two FORKS are with the owner: the CORS prerequisite and the secrets model
QUEUE-CLOSED | row=10 | **CORS RESOLVED AND VERIFIED LIVE 2026-09-28.** ServerStore landed it (`bd55b7e` "answer a browser on another origin, BEFORE the key guard"; its ledger rows 57/58) and restarted the service at 00:10:39 (their GUARD g5). Verified ON THE WIRE, not taken on trust: unauthenticated `OPTIONS` with `Origin: https://apps.futuremagic.de`, `Access-Control-Request-Method: PUT`, `Access-Control-Request-Headers: authorization,content-type` → **HTTP/2 204** carrying `allow-headers: authorization, x-api-key, content-type`, `allow-methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`, `expose-headers: x-serverstore-sha256`, `max-age: 600`; and an authenticated-route 401 also carries `access-control-allow-origin: *`, so a client can read error envelopes. The origin is the **wildcard** (their default; `SERVERSTORE_CORS_ORIGINS` can narrow it) — acceptable, because a key is still required and their pin O4 forbids `Allow-Credentials`
QUEUE-CLOSED | row=13 | **FORK 2 SETTLED BY THE OWNER — the HONOUR SYSTEM.** A shared snapshot may hold the plain truth; the UI redacts opponents' legions as it already does for hotseat. His risk call (*"no need for complicated security, ease of use is way more important here"*) is exactly the trade the honour system makes, so per-player stores and commit-reveal dice are **not planned and not queued**. S3 no longer waits on anything

LANDED | row=S1 | lands=this commit (`git log -1 --format=%H -- docs/BOARD.md`) | writer=1027ed8a-7af7-4354-9319-c4521b45290b | branch=feat/mp-transport | worktree=/home/administrator/projects/ColossusWeb/worktrees/mp-transport | base=470cd9a593431b6b8dcaccad925ca466f75ba3bb | rebased onto master `6c5d019` before pushing | ledger row=7 | brief=docs/briefs/slice-s1-transport.md
  | deliverable=THE TRANSPORT FOUNDATION ONLY. `web/src/net/transport.ts` is the ONE interface every later slice depends on (`list/get/put/remove/whoami` over a `(store, name)` pair, with the store READ from a parameter — never a constant). `serverStore.ts` is the HTTP client: the key travels in `Authorization: Bearer` and nowhere else, a non-2xx body is parsed as the service's `{error:{code,message}}` envelope into a thrown `ServerStoreError` carrying BOTH, `x-serverstore-sha256` is surfaced, and the object-name rule is enforced LOCALLY before any request. `memoryTransport.ts` obeys the same contract with no wire. `keyStorage.ts` owns the ONE `localStorage` entry (`colossusweb.key.v1`); `connect.ts` owns the ordering — paste → `whoami` → reject loudly and write NOTHING on failure, otherwise persist; a stored key is re-validated at start-up and REMOVED from storage if it fails; "Forget key" clears both. `ConnectPanel.tsx` renders identity or refusal on the setup screen.
  | verify=WRITER'S OWN, on the rebased tree: cheap tier GREEN (`tsc -b` + `vite build`, 70 modules, 369ms) · full gate **exit 0** · oxlint **14 warnings / 0 errors** (the base tree's count — no new warning) · vitest **329 passed | 2 todo (331)** in 51 files + 1 skipped · peak **306988 KB (~299 MB)** · raw log `.gate-logs/gate.log`
  | verify=DIFFERENTIAL, writer's own, 12 arms, lock held, no source edited (`scripts/differential.sh`, logs `.gate-logs/differential/*.log`). EVERY arm made a NAMED pin go RED on an otherwise-green tree, and every arm's target hash was printed before AND after and was unchanged: **A** a built-then-lost `Authorization` header → `sends the key in the Authorization header and NOWHERE else` + `an authenticated call WITHOUT the Bearer header is refused by the store` (keyStore `b534dab3…`, setup `279f974b…`) · **B** key in the query string → same pin +3 (serverStore `5189619e…`, setup `2938a6c5…`) · **C** plain `Error` instead of `ServerStoreError` → `surfaces a failure envelope with its code AND its message, never silently` +8 (transport `c744f210…`, setup `11dac9ef…`) · **D** local name guard removed → `refuses an illegal object name locally, before any request is made` (transport `c744f210…`, setup `383ec04f…`) · **E1** key also written to `sessionStorage` → `writes the key to localStorage under the ONE named entry and nowhere else` +4 (keyStore `b534dab3…`, setup `813641ae…`) · **E2** persistence moved BEFORE validation → `persists NOTHING when the service refuses the key` +2 (keyStore `b534dab3…`, setup `9ee70e71…`) · **E3** `clearStoredKey` neutered → `REMOVES a stored key that no longer validates and surfaces the refusal` +2 (keyStorage `10e063cb…`, setup `a9fe4034…`) · **F** `whoami` carries the raw key → `reports the identity whoami returns, and never any key material` (serverStore `5189619e…`, setup `a65b728c…`) · **G** sha header dropped → `surfaces the x-serverstore-sha256 response header on a GET` +1 (serverStore `5189619e…`, setup `69e4e063…`) · **H** fake's `list` returns nothing → `lists the objects in a store as plain data` (memoryTransport `44b1856f…`, setup `6bba5f58…`) · **I** base URL hard-coded → `defaults to the documented base URL when nothing overrides it` (serverStore `5189619e…`, setup `2bffee8c…`) · **J** empty body accepted → `refuses an empty body, exactly as the service does` (memoryTransport `44b1856f…`, setup `05a1d6c2…`). Three probe bugs were found and fixed rather than reported: a `vi.mock` path resolved from the wrong directory, a scratch config outside `web/` (every arm "failed" at config load — VOID), and two arms whose injections could not affect the code under test.
  | docs=this file, docs/DECISION-LEDGER.md row 7, docs/ARCHITECTURE.md §2 (two seam rows + the `web/src/net/` layer row)
  | scope-not-taken=no lobby and no named games (S2), no snapshots/polling/turn authority (S3), no fork detection or resume (S4), no per-player stores or dice work (S5). No network call is made in any test.
  | verify=DISPATCHER'S OWN, independent of the writer's, on the tree with the branch integrated into `master` (`git merge --ff-only`): the gate re-run by the dispatcher → **exit 0**, **329 passed | 2 todo (331)** in 51 files + 1 skipped, oxlint **14 warnings / 0 errors** (baseline unchanged), peak **311092 KB (~303 MB)** — reached independently, not restated.
  | verify=DISPATCHER'S ARM A — a property NO writer arm covered: the ROLLBACK. Broke the previous-key restore in `connect.ts` so a refused key WIPES the previous good one (`sha256 6c1c5371204779cd` → `245a9595c792ff78`) → **RED on the named pin** `keeps the previous good key when a newly entered one is refused` (1 failed | 12 passed); restored to `6c1c5371204779cd` — byte-identical — → 13 passed. Lock held, restore in a `trap`. Log `.gate-logs/dispatcher-armA.log`.
  | verify=DISPATCHER'S LIVE PROBE — closes part of the writer's own honest gap. Drove the REAL client (`createServerStoreTransport`, reading the key from `keyStore`) at the LIVE `store.futuremagic.de` with a bogus key: it parsed the service's own refusal into `{code:"unauthorized", status:401, message:"access key is unknown, revoked or expired"}`. So the owner's *"immediately reject it if it does not work"* path is proven against the real service, not a stub. The temporary probe test was DELETED (it would have made the suite network-dependent) and the tree is clean; the one `store.futuremagic.de` mention left in the suite (`serverStore.test.ts:136`) is a string assertion on the default, not a request.
  | note=**STILL NOT PROVEN: a SUCCESSFUL round trip against the live store** — that needs a real key, which the dispatcher does not hold and will not go looking for. A valid-key round trip is S2's first act.
  | dispatcher-amendment=one stale comment corrected in the landing commit: `transport.ts` described the per-player-store option as "still an open fork", which stopped being true when the owner settled Fork 2 (commit `6c5d019`). The writer's tree predated that closure by one commit, so its own docs pass could not catch it.
QUEUE | row=11 | also cross-project, lower priority: ServerStore has NO concurrency control (a PUT is an unconditional overwrite) and NO rate limiting. A snapshot design with writer-tagged names does not need concurrency control; a public poll loop does eventually want the rate limit
QUEUE | row=12 | design constraint to remember: there is NO per-object isolation in ServerStore (no ACL, no owner column), so any key with read/write on `colossus` can read, overwrite and DELETE every object in it, including other players'. Isolation is only available by partitioning into more stores

LANDED | row=S3 | lands=this commit (`git log -1 --format=%H -- docs/BOARD.md`) | writer=11f10bc0-3587-47f0-a4d4-6b569e35127e | branch=feat/sync | worktree=/home/administrator/projects/ColossusWeb/worktrees/sync | base=5326bd3f5e1c9c703cf2c0478047c40e773bcb36 | rebased onto master `6ff7115` before pushing | ledger row=9 | brief=docs/briefs/slice-s3-sync.md
  | deliverable=TURN SYNC — the slice that makes a started game PLAYABLE. `web/src/net/snapshot.ts` is the WHOLE snapshot protocol and is pure (no React, no fetch): the name `g.<gameid>.s.<tttt>.<sss>.<tag>` IS the ordering (zero-padded, tag = the writer's 8-char public handle, so two writers at one position make two objects), the body is a header plus the output of `serializeGame` — the ONE state serialiser, reused unchanged — and every field is validated LOUDLY on the way in (a name that disagrees with its own body, a turn/seq whose padding would sort wrongly, a parent from another game and a bad save version are all thrown `ServerStoreError`s, never empty data). `web/src/net/sync.ts` owns `publishSnapshot` / `fetchLatest` / `adopt` (adoption = `deserializeGame` + the local UI-only fields `selectedLegionId`/`legalHexes`), the ONE commit path (`createCommitPath`: every local command updates state AND publishes exactly one snapshot; UI-only selection publishes nothing; a pending physical throw defers until committed; a REMOTE adoption goes through the same seam and never publishes), the turn predicate, and the poll loop (~2s, ONE request in flight, **no request at all while the tab is hidden**, exponential backoff, `stop()` + `AbortSignal`). `web/src/net/activeGame.ts` is the ONE resume pointer (`colossusweb.multiplayer.v1`, a game id and nothing else), so opening or reloading offers to ADOPT the latest snapshot instead of starting a fresh game.
  | deliverable-seats=The game record is schema **v2** with a REQUIRED `seatOrder`, written by the creator at Start (creator first, then the joined sorted by tag, `seatOrderFor`), so every client derives the SAME seat mapping; a v1 record is `unsupported_record_version`, a started record with <2 seats is `bad_game_record`, and a spectator (seat −1) is told so in the lobby and read-only on the board — never silently seat 0. Turn authority is the STATE's answer, not a claim: `actingPlayerIds` = the active seat, the battle step's `activePlayerId`, the thrower of a pending physical roll, the defender awaiting a post-battle reinforcement, or BOTH parties to a pre-battle engagement (the defender must be able to flee/agree). It feeds the board's `interactive` flag; `applyCommand`'s own refusal is the backstop. Multiplayer seats are humans who hold keys: `assertHumanSeats` refuses an AI seat loudly and the AI autoplay effect is off whenever a session is open. `MultiplayerStatus.tsx` shows seat, whose turn, your-turn/read-only, poll state, a FORK warning and a sync failure.
  | deliverable-fork=A race is DETECTED and SURFACED, never silently resolved: `fetchLatest` returns the `SnapshotFork` at the greatest `(turn, seq)`, the status line renders it with both writer tags, and the choice among the fork's members is deterministic (the parent we hold, else the lowest tag). **The brief's own protocol was measured and corrected:** `GameState.turnNumber` is the ROUND (`GameEngine.ts:1137` increments it only when the active seat wraps past the last), so an independent per-writer `sss` reset each turn does not order states within a round — seat 0's older `s.0001.002` beats seat 1's newer `s.0001.000` and the move is lost. `sss` is therefore the SUCCESSOR of the parent snapshot's counter (adoption seeds the cursor); two clients deriving from the same parent still collide and fork. Three digits cap a round at 1000 publishes and `snapshotObjectName` REFUSES beyond that rather than minting a name that lies. Recorded in ledger row 9.
  | verify=WRITER'S OWN, on this commit's tree, gated three times (**exit 0** every time; two before the docs record and one FINAL on the tree with every doc and the differential script in place): cheap tier GREEN (`cd web && npx tsc -b && npx vite build`, **78 modules**) · full gate **exit 0** · oxlint **14 warnings / 0 errors** (the base tree's count — no new warning) · vitest **438 passed | 2 todo (440)** in 58 files + 1 skipped · final peak **328976 KB (~321 MB)** (earlier runs 333088 / 336212 KB — host-load variance, the same result) · raw log `.gate-logs/gate.log`; writer's copies `.gate-logs/s3-gate-run1.txt`, `s3-gate-run2.txt`, `s3-gate-final.txt`. The lock was released (`.gate-lock` absent) after every run.
  | verify=DIFFERENTIAL, writer's own, **9 S3 source arms appended to `scripts/differential.sh`** (the project's ONE differential harness), alongside S1's 12 and S2's 5: **26/26 RED as intended, FAILED=0**, under the shared suite lock, each target's sha256 PRINTED before and after and restored from HEAD in the `cleanup` trap. Every arm broke a REAL rule at its line: **Q** `sss` is not seeded from the parent (`sync.ts` `213cdd63…`; `tracker.seq + 1` → `0`, so two snapshots in one turn collide on the same name and the first is overwritten) → RED `a local command publishes exactly ONE snapshot named for its turn/seq; UI-only commands publish none` (1 failed | 16 passed) · **R** a state with a pending throw IS published → RED `a state with a pending throw is NOT published until the throw is committed` · **S** adoption resets the local selection (→ `null`) → RED `a remote snapshot is adopted and the local UI-only fields survive` · **T** the fork is never detected (`group.length < 2` → `< 999`) → RED `two writers at the same (turn, seq) produce two names; the fork is surfaced` · **U** the name fields are not zero-padded (`snapshot.ts` `3e7c3244…`; `String(value).padStart(digits, '0')` → `String(value)`) → RED `sorts names into state order, padded, across a turn boundary and at the seq ceiling` (6 failed | 4 passed) · **V** turn authority ignores an engagement (the defender could never flee) → RED `enables only the active seat, and follows a battle, a throw and a reinforcement` · **W** polling ignores visibility → RED `polls while visible, makes NO request while hidden, and stops when torn down` · **X** the key is smuggled into the snapshot body → RED `a published body contains no key material and no key-shaped field` · **Y** Start writes the seat order in JOIN order (`lobby.ts` `f11d23a3…`) → RED `Start writes the explicit seat order: creator first, then the joined by tag` (2 failed | 41 passed). Every target hash was identical after restore and `git status --porcelain` was EMPTY. Logs `.gate-logs/differential/*.log`, transcript `.gate-logs/s3-differential-run2.txt`.
  | verify=PROBE BUG FOUND AND FIXED, not reported as a finding: arm R's first run injected a literal `&&` into a sed REPLACEMENT, where `&` means the whole match — the injected file became a PARSE error and vitest said "no tests", which the harness correctly called **VOID**, not RED (transcript `.gate-logs/s3-differential-run1.txt`, FAILED=1). The trap is now written into `scripts/differential.sh`'s header so it cannot recur.
  | COPIES: 11→1 — every path in `App.tsx` that changes the GAME state now goes through `createCommitPath` (`web/src/net/sync.ts`); `grep -n 'setState(' App.tsx` finds exactly ONE bare setter (inside `putState`, the commit path's only `setState`), where before S3 there were eleven scattered writers. Also folded: 2→1 — `MIN_SEATS` (`gameRecord.ts`) is the ONE seats floor, re-exported as `lobby.ts`'s `MIN_PLAYERS_TO_START` (the strict v2 parser and the lobby rule can no longer drift); 2→1 — `readPlayerRecords` is the ONE bulk reader of `p.` bodies, used by both `readLobby` and `startGame`; and the snapshot body reuses `serializeGame`/`deserializeGame` unchanged — grepped `serializeGame\|deserializeGame` under `web/src/net`, the only non-test call sites are `sync.ts:280` (publish) and `sync.ts:390` (adopt), so there is no second state format.
  | docs=this file, docs/DECISION-LEDGER.md row 9, docs/ARCHITECTURE.md §1 (the `web/src/net/` dependency row) + §2 (eight new seam rows and the state-flow diagram) + §3 (the `turnNumber`-is-the-round gotcha)
  | scope-not-taken=no automatic fork RESOLUTION (detect and surface only); no AI seats on the multiplayer path; no push/WebSocket transport; no per-player stores, dice commit–reveal or encryption (owner-declined); no change to the rules engine; no cleanup of finished games (S4). Every test runs against S1's in-memory twin or a stubbed `fetch` — no test calls the live service.
  | note=**STILL NOT PROVEN** (writer's own honest gap): the live `colossus` store has still never been written to by this client, and no authenticated call has been made from a browser — that needs a valid key, which this writer does not hold and did not go looking for. The pins prove the protocol against the in-memory twin only.

LANDED | row=S2 | lands=this commit (`git log -1 --format=%H -- docs/BOARD.md`) | writer=345c61c6-a65c-4e3e-bca9-e646d3d71923 | branch=feat/lobby | worktree=/home/administrator/projects/ColossusWeb/worktrees/lobby | base=162364071c769255a64f44d8c2c2f2456301ec04 | rebased onto master `1c48bdf` before pushing | ledger row=8 | brief=docs/briefs/slice-s2-lobby.md
  | deliverable=THE LOBBY LIFECYCLE ONLY, implementing the owner's Create Multiplayer / Join Multiplayer / Start Multiplayer (creator only). `web/src/net/gameRecord.ts` owns the object shapes and names: `g.<gameid>.game` (creator-only writer) and `g.<gameid>.p.<tag>` (owner-only writer), with `gameid` = a ≤23-char slug + 8 random hex so two same-named games cannot collide and BOTH names fit the service's 64-char rule; the display name is uncapped and lives in the body. The player tag is the first 8 lowercased characters of the full `whoami().id` (ServerStore's own public prefix) while the full id stays in the body for identity comparison, so a tag collision is refused (`player_tag_collision`) instead of overwriting. `web/src/net/lobby.ts` owns the operations (`createGame`/`listGames`/`joinGame`/`leaveGame`/`startGame`/`readLobby`) and enforces every rule BEFORE any write, as a thrown `ServerStoreError` the ONE error surface renders: Start is the creator's alone (`not_creator`), a second Start is refused (`already_started`), Start needs ≥2 joined players (`not_enough_players` — a decision taken in this slice because the hand-off requires two seats), a started game takes no joins (`game_started`), a full game takes no joins (`game_full`), and a re-join returns the existing object with NO write. Discovery is the store's own list route filtered to `g.<id>.game`: a non-game name is in NEITHER result list, while a malformed or unfetchable game is reported in `GameListing.unreadable` with the service's own code and message — never dropped. `web/src/net/storeName.ts` is the ONE place the store name comes from (`colossus`; `VITE_SERVERSTORE_STORE` overrides). `web/src/components/LobbyPanel.tsx` renders Create / Join / Start, shows Start only to the creator, and hands a started game to the existing local new-game flow; `SetupScreen.tsx` now owns ONE `useConnection()` state and passes it to both panels (ConnectPanel takes it as a prop).
  | verify=WRITER'S OWN — this commit's tree was gated FOUR times, **exit 0** every time: before and after the docs record, and again on the tree REBASED onto `1c48bdf`. Last (rebased) run: cheap tier `tsc -b` + `vite build` GREEN, **74 modules**, 412ms · full gate **exit 0** · oxlint **14 warnings / 0 errors** (the base tree's count — no new warning) · vitest **395 passed | 2 todo (397)** in 54 files + 1 skipped · peak **323184 KB (~315 MB)**. Peaks across the four runs (319132 / 316012 / 340188 / 323184 KB) are host-load variance, not different results. Raw log `.gate-logs/gate.log`; writer's copies `.gate-logs/s2-gate-run1.txt`, `s2-gate-final.txt`, `s2-gate-rebased.txt`
  | verify=DIFFERENTIAL, writer's own, **5 S2 source arms appended to `scripts/differential.sh`** (the project's ONE differential harness), alongside S1's 12: **17/17 RED as intended, FAILED=0**, under the shared suite lock, each target's sha256 PRINTED before and after and restored from HEAD in the `cleanup` trap. **L** removed the creator guard in `startGame` (`lobby.ts` `6e553228…` → `a30c49be…`) → RED `Start is refused for a non-creator and writes NOTHING` (2 failed | 39 passed) · **M** made a re-join write again (`lobby.ts` `6e553228…` → `bc14c995…`) → RED `joining twice is idempotent: one object, unchanged body, no second write` (6 failed | 35 passed) · **N** made discovery drop an unreadable game (`lobby.ts` `6e553228…` → `2dac5066…`) → RED `Discovery ignores non-game objects and surfaces an unreadable game record` (4 failed | 37 passed) · **O** removed the slug cap (`gameRecord.ts` `931cb4d2…` → `3c7a653f…`) → RED `gives a legal name for BOTH object kinds whatever the display name is` + `the LONGEST legal display name still names both objects legally` (2 failed | 11 passed) · **P** smuggled the key into the game body (`lobby.ts` `6e553228…` → `c287dc05…`) → RED `no object body and no request body ever contains key material` (3 failed | 38 passed). Every target hash was identical after restore; `git status --porcelain` showed only the harness edit, no source. The whole 17-arm run was repeated against the final commit's HEAD and gave the same result. Logs `.gate-logs/differential/*.log`, transcript `.gate-logs/s2-differential-run3.txt`.
  | docs=this file, docs/DECISION-LEDGER.md row 8 (with the `COPIES:` line), docs/ARCHITECTURE.md §1 (`web/src/components/` may depend on `net`; `web/src/net/` now carries the lobby) + §2 (four seam rows: failure→screen, object names/records, lobby operations, store name)
  | scope-not-taken=no game-state sync, snapshots, polling or turn authority (S3); no fork detection or resume (S4); nothing for the declined per-player-store / dice work (S5); no change to how a hotseat game plays. Every test runs against the in-memory twin or a stubbed `fetch` — no network call is made in any test.
  | note=**STILL NOT PROVEN** (writer's own honest gap): the live service has never been called by this client from a browser and nothing has ever been written to the live `colossus` store — that needs a valid key, which this writer does not hold and did not go looking for. And a started lobby currently begins a **local** game: no state is published or adopted, so two clients that start the same game do not yet exchange moves (that is S3).
  | verify=DISPATCHER'S OWN (the `dispatcher-owed` line this replaces is now discharged for the gate and the differential): integrated with `git merge --ff-only`, then the gate re-run by the dispatcher → **exit 0**, **395 passed | 2 todo (397)** in 54 files + 1 skipped, oxlint **14 warnings / 0 errors** (baseline unchanged), peak **314056 KB (~307 MB)**. Reached independently, not restated. Log `.gate-logs/dispatcher-s2-gate.txt`.
  | verify=DISPATCHER'S ARMS B and C — the two rules NO writer arm touched (their L/M/N/O/P covered the creator guard, re-join, unreadable records, the slug cap and key leakage). Arm B broke the **>=2 players to start** rule (`lobby.ts` `6e553228e66b7c74` → `080c64b0aaa23c5f`, `playerCount < MIN_PLAYERS_TO_START` → `< -1`) → **RED on the named pin** `Start refuses a lobby with fewer than two joined players, and writes nothing` (2 failed | 39 passed). Arm C broke the **full-game** rule (→ `0a9b38e0a09d996c`, `>= maxPlayers` → `>= 999`) → **RED on** `Join is refused for a FULL game and writes nothing`. Both restored to `6e553228e66b7c74` — byte-identical — and the control run was **41 passed**. Lock held, restore in a `trap`. Logs `.gate-logs/dispatcher-arm{B,C}.log`.
  | dispatcher-error=**the brief I wrote asserted a fact from plausibility and was WRONG.** It told the writer a ServerStore key id is "UUID-shaped (~36 chars)". Measured afterwards in `ServerStore/src/core/keys.ts:5,49`: the id is **12 base64url characters (9 random bytes)**. The writer caught it, used the real shape, and documented the correction; the short tag it was told to use is still correct (and conservative) — but the dispatcher asserted a number it had never checked, which is the exact failure mode this process names. Recorded so the next brief checks `keys.ts` before quoting a shape.
  | still-owed=**the live round trip.** Nothing has ever been written to the live `colossus` store, and no authenticated call has been made by this client. It needs a valid key, which the dispatcher does not hold and will not go looking for. It is the first thing to do when a key is available, and it is S3's opening act.

LANDED | row=0 | lands=this commit (`git log -1 --format=%H -- docs/BOARD.md`) | base=48be1070d11b6d0edfc7f5a24610734573ac40be
  | verify=DISPATCHER'S OWN, on the base tree: cheap tier GREEN (tsc -b + vite build, 61 modules,
  387ms) · full gate exit 0 · oxlint 14 warnings / 0 errors · vitest 271 passed | 2 todo (273)
  in 45 files + 1 skipped file · peak 302712 KB (~295 MB) · raw log .gate-logs/gate.log
  | acceptance=BOARD RECONCILED (exit 0) + GATE_TESTS=0 -> exit 2, both as the scaffold requires
  | retired=nothing (no writer was dispatched; this was dispatcher-side setup)
  | docs=this file, docs/TESTING.md (baseline), docs/DECISION-LEDGER.md rows 1-4, AGENTS.md, scripts/*

PUBLISH | slug=ColossusWeb | target=/home/administrator/apps/ColossusWeb -> /home/administrator/projects/Migration/apps/ColossusWeb
  (a SYMLINK into the Migration tree; the target is a real directory, as are all 12 sibling apps)
  | build=(cd web && npx tsc -b && COLOSSUS_BASE=/ColossusWeb/ npx vite build) -> asset index-BOtDb2SA.js
  | method=rsync -ai --exclude='.htaccess' web/dist/ ~/apps/ColossusWeb/ (NO --delete) | exit 0
  | verify=BY CONTENT, not by 200: served mtime 2026-09-26T19:07 -> 2026-09-27T22:32; sha256 manifests equal,
  all 1374 files byte-identical to the build; `.htaccess` correctly NOT published; over http://127.0.0.1:8082/ColossusWeb/
  the entry references /ColossusWeb/assets/index-BOtDb2SA.js, that asset hashes f0d6765a2e6c125f… == dist, and
  variants/Default/variant.json is 200
  | cdn=public URL cf-cache-status: DYNAMIC — new bytes already served, no stale HIT
  | hub=bash ~/projects/futuremagic/scripts/publish-apps-root.sh exit 0; 13 cards written, ColossusWeb card present
  | note=the served bytes ALREADY matched HEAD before this publish (same asset hash), so it was a content-IDENTICAL
  republish; the proof it landed is the mtime change plus byte-equality, NOT a changed hash. Do not expect a hash
  change to be the evidence next time either — compare manifests.

PUBLISH | slug=ColossusWeb | delivers=the ARCH gate fix (lands=0b1fa3d)
  | build=(cd web && npx tsc -b && COLOSSUS_BASE=/ColossusWeb/ npx vite build) -> asset index-tJplBtH_.js
  | method=rsync -ai --exclude='.htaccess' web/dist/ ~/apps/ColossusWeb/ (NO --delete) | exit 0
  | verify=BY CONTENT: the served entry references /ColossusWeb/assets/index-tJplBtH_.js; 1374 files byte-identical
  to web/dist apart from the ONE deliberately retained superseded asset; `.htaccess` not published; over
  http://127.0.0.1:8082/ColossusWeb/ the new asset is 200 and hashes dd24aa29… == dist; the published URL was loaded
  in headless Chrome (tree reaped to 0)
  | cdn=the superseded asset index-BOtDb2SA.js is KEPT on purpose, so a client holding the 4h-cached index.html can
  still resolve the old hash in the entry it was served
  | hub=bash ~/projects/futuremagic/scripts/publish-apps-root.sh exit 0; 13 cards written

RECOVERY | publish=(cd web && npx tsc -b && COLOSSUS_BASE=/ColossusWeb/ npx vite build) · rsync -ai --exclude='.htaccess' web/dist/ ~/apps/ColossusWeb/ · bash ~/projects/futuremagic/scripts/publish-apps-root.sh
RECOVERY | repo=/home/administrator/projects/ColossusWeb | remote=origin=https://github.com/ArndRosemeier/ColossusWeb.git
RECOVERY | branch=master | base=6ff7115638d26f3b31d1de625ba17b7e0088d028 (S3's base was 5326bd3f) | gate=bash scripts/gate.sh (from the tree ROOT)
RECOVERY | product=web/ (TypeScript, verifiable) | reference=Colossus/ (Java, NOT buildable on this host)
RECOVERY | logs=.gate-logs/gate.log (gitignored) | worktrees=./worktrees/ (gitignored)
```

retired_branch=feat/mp-transport
retired_branch=feat/lobby

**S1 AND S2 ARE VERIFIED AND RETIRED; S3 IS LANDED ON `feat/sync` AND AWAITS THE
DISPATCHER'S OWN VERIFICATION.** (This paragraph previously said S2 awaited the
DISPATCHER'S OWN VERIFICATION; S3 IS NEXT.** `feat/mp-transport` is gone locally AND on the
remote, and its worktree is removed — the `retired_branch=` line above is the claim the
reconciler reads. S2's branch is **not** retired: it holds the lobby landings above and is the
dispatcher's to verify, integrate and retire. S1 was steered mid-flight by the owner
requirement change (the key is now persisted in `localStorage` after a successful `whoami`,
not held in memory), so the brief's original no-`localStorage` pin is superseded — the pins as
finally implemented are in `web/src/net/__tests__/`: the contract suite runs against BOTH
implementations (`transportContract.test.ts`), the key rules are asserted over the REAL browser
objects after a real connect (`keyPersistence.test.ts`), and the transport rules over the
requests the client actually made (`serverStore.test.ts`). S2's pins live in
`web/src/net/__tests__/lobby.test.ts` (operations, run against BOTH transports),
`web/src/net/__tests__/gameRecord.test.ts` (names and record shapes) and
`web/src/components/__tests__/lobbyUi.test.ts` (Start is the creator's alone). S3's pins are
`web/src/net/__tests__/snapshot.test.ts` (the name IS the ordering, the padding and the
64-character budget, fork detection and the deterministic choice, LOUD body validation),
`web/src/net/__tests__/sync.test.ts` (publish → fetch → adopt, exactly one snapshot per shared
command, UI-only commands publish nothing, the pending throw defers, remote adoption preserves
the local UI and never publishes, the fork is surfaced, turn authority, polling while
hidden/torn down with backoff, seats/seeds and the AI refusal, no key material, migration),
`web/src/net/__tests__/activeGame.test.ts` (the one resume pointer) and
`web/src/components/__tests__/multiplayerStatus.test.ts` (whose turn / read-only / fork /
failure are visible).

**DISPATCHER'S OWN ERRORS, recorded rather than quietly corrected** (per `AGENTS.md`):
1. **A masked exit code.** `git branch -d feat/mp-transport | tail -2` printed `[branch delete
   exit: 0]` — the exit status of `tail`, not of `git`. The delete had in fact FAILED. The
   rule this project already has ("never pipe a check") applies to *any* command whose status
   you intend to quote, including git housekeeping. Caught only because the branch was still
   listed afterwards.
2. **`-D` was then used deliberately, and why it was safe:** `-d` refused because the branch's
   upstream `origin/master` had not yet received the landing, not because the work was
   unmerged. `git merge-base --is-ancestor feat/mp-transport master` returned **0** first, so
   every commit was provably in the tree being pushed; `-D` removed a branch whose content was
   already integrated. The true exit code (`0`) was taken without a pipe.
3. **S3's brief asserted a fact from plausibility and was WRONG — caught by the writer's own
   measurement, not by the gate.** The brief's protocol says `sss` is "a per-writer counter
   within that turn (reset each turn)" and that `tttt` is `state.turnNumber`. Measured in
   `GameEngine.ts:1137` and confirmed with a 3-player probe (2026-09-28): `turnNumber` is the
   **ROUND**, incremented only when the active seat wraps past the last, so `activePlayerIndex`
   runs 0 → 1 → 2 while `turnNumber` stays 1. An independent per-writer counter therefore does
   not order states inside a round: seat 0's older `s.0001.002` beats seat 1's newer
   `s.0001.000`, and the newer move is silently ignored — the exact failure the protocol exists
   to prevent. The writer implemented the brief's INTENT (greatest name = newest state) by
   seeding `sss` from the parent snapshot's counter, which is what the `parent` field is for;
   two clients deriving from the same parent still fork. Recorded in ledger row 9 and in
   `ARCHITECTURE.md §3` so the next brief checks the field before quoting a meaning.

**This worktree has no `web/node_modules` until `(cd web && npm ci)` is run once** — a fresh
worktree fails the gate's preflight with exit 1 (not a test failure) until then. `jsdom` is
now a devDependency for the one pin that must see real `localStorage`; it is added to
`web/package.json`/`package-lock.json` in this landing.

## The owner's multiplayer acceptance criteria

The feature is done when all four of these are true. Verbatim, because they are the
acceptance test and not a summary of one:

> * Create Multiplayer
> * Join Multiplayer
> * Start Multiplayer (only available to the creator)
> * Players need to provide their key. With that key the app needs to try to connect to the
>   colossus store and immediately reject it if it does not work. Otherwise store it in
>   local storage.

Consequences already folded into the design:

- **Create / Join / Start are lobby actions**, so they belong to slice **S2**, not to S1
  (the transport foundation the panel sits on). "Start" is the transition from lobby to a
  live game, and only the creator's client may perform it.
- **"Only the creator" is a client-side rule.** There is no server authority anywhere in
  this design — the store is a shared bucket and any key on `colossus` can write any object
  — so it is enforced by the apps and said so plainly: a player who edits their own client
  can ignore it. It is a rule of the game, not a security boundary.
- **The key persists in `localStorage`** after a successful `whoami` (the owner's explicit
  choice): paste → validate → reject loudly and store nothing on failure → otherwise store →
  re-validate on load and drop it if it stops working, plus a "Forget key" button.
  **The risk is ACCEPTED AND CLOSED — do not build key-management scaffolding.** The owner's
  words: *"The risk for that key getting misused is minimal and the store is isolated anyways,
  so there is no need for complicated security, ease of use is way more important here. Worst
  case is that some game data is broken... which is not critical at all."* He is right about
  the isolation and it is checkable — a key's scope is enforced per store, so a `colossus` key
  is refused `403` everywhere else (`ServerStore/docs/API.md:119-124`) — hence the worst case
  is broken game data and nothing more. See `docs/design/multiplayer.md` §4.1.

## How "completion" is being driven (read this first if you are a successor)

The owner is away and said: *"try to build this to completion."* A successor must be able to
take over from this file alone.

**Completion means:** all four acceptance criteria above work end to end, AND a started game
is actually **playable** — moves made by one player reach the others. A lobby that creates
and starts a game whose moves never sync is not multiplayer, so **S3 is in scope**; that is
the dispatcher's reading of "completion", recorded here so the owner can correct it.

**Execution order and why it is serial.** S1 → S2 → S3, one writer at a time. They are not
parallelisable in practice: all three touch `web/src/components/App.tsx`, and the rule is
that a shared file means SERIALIZE. Each slice runs in its own worktree off the then-current
`origin/master`, and each landing is verified by the dispatcher before the next is dispatched.
All three have now landed; nothing is in flight. The slices remaining in the design
(`docs/design/multiplayer.md` §7) are **S4** (fork RESOLUTION, reconnect, cleanup of finished
games) and the closed S5.

**Per landing, the dispatcher (not the writer) must:**
1. read the writer's diff before dispatching the next slice (sequencing is proven, not predicted);
2. run the gate itself on the integrated tree and quote the raw exit code and counts;
3. run its OWN differential — an injection with a PRINTED file hash, lock held, restore in a
   `trap` — and watch a NAMED pin go red;
4. retire the writer's worktree AND branch (`git worktree remove`, `git branch -d`), and mark
   the branch claim as its own `retired_branch=<name>` line;
5. amend this board in the same commit as the landing.

**If this session dies:** the record above is true as of the S3 landing on `feat/sync`. The S3
writer (`11f10bc0-3587-47f0-a4d4-6b569e35127e`) committed the turn-sync landing there and pushes
it with this record — **salvage-check its branch log and worktree status before deleting
anything**. `feat/sync` is the dispatcher's to verify, integrate and retire, and the worktree
`/home/administrator/projects/ColossusWeb/worktrees/sync` holds its raw gate and differential
logs under `.gate-logs/`. `feat/lobby` (S2) is likewise still the dispatcher's to retire. The
next work is **S4** — fork RESOLUTION (S3 detects and surfaces a fork but deliberately does not
resolve it), reconnect, and cleanup of finished games — briefed from
`docs/briefs/slice-s3-sync.md` as the closest template and `docs/BRIEF.md` as the contract.

## Guards

Each was **verified**, not assumed, on 2026-09-27 at the base commit.

- **`GUARD` — the suite lock.** `scripts/gate.sh` takes an atomic `mkdir` lock derived
  from the git COMMON dir, so it is ONE lock from the main tree and every worktree. A
  second concurrent run is refused (exit 9) and is VOID. *Verified:* the full run
  acquired `/.gate-lock`, wrote its owner file, and released it on exit (`git status`
  and the lock dir were clean afterwards).
- **`GUARD` — the memory peak.** The full tier runs under `/usr/bin/time -v`; the gate
  prints `peak: <n> KB` and the raw log keeps `Maximum resident set size`.
  *Verified:* `peak: 302712 KB (~295 MB)` printed, exit 0. If the timer is missing the
  gate says `peak: NOT MEASURED` rather than printing a misleading zero.
- **`GUARD` — the gate excludes `npm run convert`, so it cannot dirty a tree.**
  *Verified:* immediately after a full gate, `git status --short` showed no modification
  to any tracked file (only `.gate-logs/` and `web/dist/`, both gitignored).
- **`GUARD` — the committed variant JSON is in sync with the XML.**
  *Verified:* `npm run convert` on the clean base produced **0 tracked changes** — the
  1372 committed paths under `web/public/variants/**` are byte-identical to what
  `web/scripts/convert-variant.mjs` regenerates as of `48be107`.
- **`GUARD` — the Java tree is correctly excluded.** *Verified:* `command -v javac ant
  mvn` → all absent; `ls /opt/java` → no such directory.
- **`GUARD` — a push to `master` does not deploy.** *Verified:* no `.github/workflows/`
  exists (the `deploy-*.ps1` scripts are manual and Windows-side), and `.git/hooks/`
  holds only samples, so there is no pre-push gate to bypass.

## Recovery pointers

- **The gate command and its exit codes** (`0` green · `1` failed · `2` cheap only ·
  `9` refused, VOID): `bash scripts/gate.sh`, from the ROOT of the tree you mean to gate.
- **The cheap tier** (blocks a push): `GATE_TESTS=0 bash scripts/gate.sh` → `2` when
  green, and `2` is NOT "the gate passed".
- **Raw logs:** `.gate-logs/gate.log` — never piped through `tail`/`head`.
- **Open writer branches/worktrees:** `git worktree list` · `git branch -a`
- **Rule coverage:** `docs/rules/COMPLIANCE.md` (the project's own matrix) and the
  Vitest suites under `web/src/**/__tests__/`.
- **The owner's convention for this machinery:** every one of his other projects
  (`Campaigner`, `FracVibe`, `Expert`, `Imager`) tracks `AGENTS.md` + `scripts/gate.sh`
  **on the remote** — checked 2026-09-27.

## Traps (each with the rule that prevents it)

- `TRAP` — **in a `sed` REPLACEMENT, `&` means THE WHOLE MATCH.** S3's differential
  arm R injected a literal `&&` (`s|&& !next.pendingDice|&& true|`); sed expanded both
  `&`s into the matched text, the file became a PARSE error, and vitest reported
  "no tests" — which the harness correctly called **VOID**, not RED. The arm proved
  nothing and looked finished. **The rule:** write `\&\&` in a replacement, and treat a
  "no tests" result as a probe bug to FIX, never as a finding to report. Now encoded in
  `scripts/differential.sh`'s header (mistake 3).
- `TRAP` — **`GameState.turnNumber` is the ROUND.** S3's brief asserted it was the
  player's turn and built the ordering on that; it is not (see §3 of
  `docs/ARCHITECTURE.md`). **The rule:** before a brief quotes a field's MEANING, read
  the line that assigns it, and let a pin drive two writers through a real sequence
  rather than trusting the field name.
