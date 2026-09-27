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
reconciled: 6c5d0196252ac65bc1bb322d5797b4c62dea73be · 2026-09-27T22:36Z

SESSION | id=session-c415d674-2dd3-428b-97d2-809e492615e9 | model=deepseek-flash | state=dispatching to completion — OWNER AWAY, instruction "try to build this to completion"; S1 and S2 both VERIFIED and RETIRED by the dispatcher, S3 next, SERIALLY because they all touch `web/src/components/App.tsx`

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

IN-FLIGHT | row=S3 | worktree=/home/administrator/projects/ColossusWeb/worktrees/sync | branch=feat/sync | base=PENDING | session=PENDING | state=queued | brief=docs/briefs/slice-s3-sync.md | ledger row assigned=9
  scope=TURN SYNC, the slice that makes a started game PLAYABLE. The snapshot protocol (`g.<gameid>.s.<tttt>.<sss>.<tag>`, body = header + `serializeGame`'s state, `parent`-linked so a race is a visible FORK rather than a lost update); publish after every local command; poll ~2s only while the tab is visible, with backoff; adopt the GREATEST name with deterministic, fork-SURFACING handling; an explicit seat order written by the creator at Start; input enabled only for the seat whose turn it is; and resume-by-adoption instead of starting a fresh local game. Every local state change must funnel through ONE commit path so nothing can change state without publishing. OUT OF SCOPE: automatic fork resolution, AI seats, any push transport, and the declined per-player-store / encryption work

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
RECOVERY | branch=master | base=6c5d0196252ac65bc1bb322d5797b4c62dea73be (S1's base was 470cd9a5) | gate=bash scripts/gate.sh (from the tree ROOT)
RECOVERY | product=web/ (TypeScript, verifiable) | reference=Colossus/ (Java, NOT buildable on this host)
RECOVERY | logs=.gate-logs/gate.log (gitignored) | worktrees=./worktrees/ (gitignored)
```

retired_branch=feat/mp-transport
retired_branch=feat/lobby

**S1 AND S2 ARE VERIFIED AND RETIRED; S3 IS NEXT.** (This paragraph previously said S2 awaited the
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
`web/src/components/__tests__/lobbyUi.test.ts` (Start is the creator's alone).

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

**Per landing, the dispatcher (not the writer) must:**
1. read the writer's diff before dispatching the next slice (sequencing is proven, not predicted);
2. run the gate itself on the integrated tree and quote the raw exit code and counts;
3. run its OWN differential — an injection with a PRINTED file hash, lock held, restore in a
   `trap` — and watch a NAMED pin go red;
4. retire the writer's worktree AND branch (`git worktree remove`, `git branch -d`), and mark
   the branch claim as its own `retired_branch=<name>` line;
5. amend this board in the same commit as the landing.

**If this session dies:** the record above is true as of the S2 landing on
`feat/lobby`. The S2 writer (`345c61c6-a65c-4e3e-bca9-e646d3d71923`) committed the lobby
landing there and pushes it with this record — **salvage-check its branch log and worktree
status before deleting anything**. `feat/lobby` is the dispatcher's to verify, integrate and
retire, and the worktree `/home/administrator/projects/ColossusWeb/worktrees/lobby` holds its
raw gate and differential logs under `.gate-logs/`. The brief for S3 does not exist yet; write
it from `docs/briefs/slice-s1-transport.md` / `slice-s2-lobby.md` as the templates and
`docs/BRIEF.md` as the contract.

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

- `TRAP` — none recorded yet. The first one gets written here with the rule that
  prevents it.
