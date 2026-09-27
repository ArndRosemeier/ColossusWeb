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

SESSION | id=session-c415d674-2dd3-428b-97d2-809e492615e9 | model=deepseek-flash | state=dispatching to completion — OWNER AWAY, instruction "try to build this to completion"; S1 in flight, then S2, then S3, SERIALLY because they all touch `web/src/components/App.tsx`

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
  | verify=WRITER'S OWN, on the rebased tree: cheap tier GREEN (`tsc -b` + `vite build`, 70 modules, 366ms) · full gate **exit 0** · oxlint **14 warnings / 0 errors** (the base tree's count — no new warning) · vitest **328 passed | 2 todo (330)** in 51 files + 1 skipped · peak **314536 KB (~307 MB)** · raw log `.gate-logs/gate.log`
  | verify=DIFFERENTIAL, writer's own, 12 arms, lock held, no source edited (`scripts/differential.sh`, logs `.gate-logs/differential/*.log`). EVERY arm made a NAMED pin go RED on an otherwise-green tree, and every arm's target hash was printed before AND after and was unchanged: **A** wrong Bearer → `sends the key in the Authorization header and NOWHERE else` (keyStore `b534dab3…`, setup `31114aa4…`) · **B** key in the query string → same pin +3 (serverStore `5189619e…`, setup `2938a6c5…`) · **C** plain `Error` instead of `ServerStoreError` → `surfaces a failure envelope with its code AND its message, never silently` +8 (transport `c744f210…`, setup `11dac9ef…`) · **D** local name guard removed → `refuses an illegal object name locally, before any request is made` (transport `c744f210…`, setup `383ec04f…`) · **E1** key also written to `sessionStorage` → `writes the key to localStorage under the ONE named entry and nowhere else` +4 (keyStore `b534dab3…`, setup `813641ae…`) · **E2** persistence moved BEFORE validation → `persists NOTHING when the service refuses the key` +2 (keyStore `b534dab3…`, setup `9ee70e71…`) · **E3** `clearStoredKey` neutered → `REMOVES a stored key that no longer validates and surfaces the refusal` +2 (keyStorage `10e063cb…`, setup `a9fe4034…`) · **F** `whoami` carries the raw key → `reports the identity whoami returns, and never any key material` (serverStore `5189619e…`, setup `a65b728c…`) · **G** sha header dropped → `surfaces the x-serverstore-sha256 response header on a GET` +1 (serverStore `5189619e…`, setup `69e4e063…`) · **H** fake's `list` returns nothing → `lists the objects in a store as plain data` (memoryTransport `44b1856f…`, setup `6bba5f58…`) · **I** base URL hard-coded → `defaults to the documented base URL when nothing overrides it` (serverStore `5189619e…`, setup `2bffee8c…`) · **J** empty body accepted → `refuses an empty body, exactly as the service does` (memoryTransport `44b1856f…`, setup `05a1d6c2…`). Three probe bugs were found and fixed rather than reported: a `vi.mock` path resolved from the wrong directory, a scratch config outside `web/` (every arm "failed" at config load — VOID), and two arms whose injections could not affect the code under test.
  | docs=this file, docs/DECISION-LEDGER.md row 7, docs/ARCHITECTURE.md §2 (two seam rows + the `web/src/net/` layer row)
  | scope-not-taken=no lobby and no named games (S2), no snapshots/polling/turn authority (S3), no fork detection or resume (S4), no per-player stores or dice work (S5). No network call is made in any test.
  | note=**the live service has still never been called from a browser.** Every test stubs `fetch` or uses the in-memory twin, so the first real round trip is S2's first act — and it is the one thing this landing does NOT prove.
QUEUE | row=11 | also cross-project, lower priority: ServerStore has NO concurrency control (a PUT is an unconditional overwrite) and NO rate limiting. A snapshot design with writer-tagged names does not need concurrency control; a public poll loop does eventually want the rate limit
QUEUE | row=12 | design constraint to remember: there is NO per-object isolation in ServerStore (no ACL, no owner column), so any key with read/write on `colossus` can read, overwrite and DELETE every object in it, including other players'. Isolation is only available by partitioning into more stores

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

**NOTHING is in flight.** `feat/mp-transport` (S1) landed (see the `LANDED | row=S1` line) and
is the only branch besides `master`. It was steered mid-flight by the owner requirement change
(the key is now persisted in `localStorage` after a successful `whoami`, not held in memory),
so the brief's original no-`localStorage` pin is superseded — the six pins as finally
implemented are in `web/src/net/__tests__/`: the contract suite runs against BOTH
implementations (`transportContract.test.ts`), the key rules are asserted over the REAL
browser objects after a real connect (`keyPersistence.test.ts`), and the transport rules over
the requests the client actually made (`serverStore.test.ts`).

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

**If this session dies:** the record above is true as of `6c5d019`, one writer
(`1027ed8a-7af7-4354-9319-c4521b45290b`, slice S1) may have committed partial work on
`feat/mp-transport` — **salvage-check its branch log and worktree status before deleting
anything**. The unfilled briefs for S2/S3 do not exist yet; write them from
`docs/briefs/slice-s1-transport.md` as the template and `docs/BRIEF.md` as the contract.

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
