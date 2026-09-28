# Multiplayer over ServerStore — design proposal

**STATUS: PROPOSAL.** Nothing here is built. Two decisions are the owner's (marked
**FORK**); the rest are engineering calls I have taken and can reverse.

Everyone's words, intent and evidence are recorded here rather than in a chat, so a
successor session can pick this up cold.

## 1 · The intent

The owner, verbatim:

> "There is a sister project, ServerStore that published a life storage server on
> store.futuremagic.de. I created a sub store named colossus. I want to use that to allow
> multiplayer games for this app, using the colossus store to store game states and handle
> the multiplayer as the only way to communicate. This would need named games that players
> could then find on their client so they can join."

Extracted: **no game server of our own.** ServerStore is the whole transport — state
storage *and* messaging. Players create named games, others discover and join them. Titan
is turn-based, so a poll-based store is a legitimate fit (ServerStore's own ledger row 28
says exactly that: *"Turn-based / async fits this store as-is (1–5s polling)"*).

## 2 · What is already true (measured, not assumed)

### 2.1 ServerStore (`~/projects/ServerStore`, read-only — it is another project)

| Fact | Evidence |
| --- | --- |
| Live and answering: `probe-live.sh https://store.futuremagic.de` → **PASS exit 0** | ran 2026-09-27 |
| Reachable at `https://store.futuremagic.de`; the service itself listens on loopback `:8477`; Cloudflare Access in front was **removed**, so the key is the only perimeter | `ServerStore/docs/API.md:20-51` |
| A store holds **opaque byte objects under flat, lowercase names**, `[a-z0-9][a-z0-9._-]{0,63}` (1–64 chars, no directories) | `API.md:192-200` |
| Routes: list all objects; GET/PUT/DELETE by name; mint keys; `GET /whoami` | `API.md:167-183` |
| **`PUT` is an unconditional overwrite. No `ETag`, `If-Match`, version or CAS** — "two writers racing one name lose one update". The doc's own advice: serialise on one writer, or one key per object | `API.md:470-474` |
| **No CORS and no preflight handling** — "a browser page served from a different origin cannot call it directly with fetch" | `API.md:475-478` |
| No rate limiting, no GC (DELETE drops the row, bytes stay), lists are unpaginated and have **no `since=`**, no per-store permissions, 64 MiB object cap | `API.md:463-502`, `:364-380` |
| A key is scoped to a **SET of stores**, with `read`/`write`/`delete`/`admin`. Keys are minted by an admin and **shown once**; `GET /whoami` tells a client which key it holds | `API.md:81-160`, `:212-224` |
| The admin UI for stores + keys **already exists** (same origin, no build) | `API.md:53-79` |
| A `src/` landing needs a **service restart** to take effect: `systemctl --user restart serverstore` (user unit, active, started 2026-09-27 23:39:39, `ExecStart` loads `src/server/main.ts` once at boot) | `ServerStore/docs/DECISION-LEDGER.md` row 43b (GUARD g5); `docs/BOARD.md:714-720` |
| **THE `colossus` STORE ALREADY EXISTS** in the live database (`/home/administrator/serverstore-data/serverstore.db`, kind `bytes`, created **2026-09-27T21:45:32Z**), and a key's scope row already names it. **No objects yet** (no blob directory) | live DB, read by byte inspection; no key material printed |
| **THERE IS NO PER-OBJECT ISOLATION, AT ALL.** Authorization is store-membership plus one global perms set — no object ACL, no owner column. **Any key with read/write on `colossus` can list, read, overwrite and DELETE every object in it**, including other players' | `src/server/app.ts:121-138`, `src/core/db.ts:36-44`, `API.md:492-495` (non-goal 9) |
| Their multiplayer gaps, in dependency order, are **queued and gated on the owner's sync model**: (1) concurrency control, (2) CORS, (3) rate limiting, (4) per-player keys — all three of (1)(2)(3) measured **absent and un-dispatched** | `ServerStore/docs/BOARD.md` queue row 28; `src/` grep for `cors`/`etag`/`if-match`/`412`/`since`/`rate` → 0 hits |

**This is not a new idea to that project.** Its ledger row 28 is the owner asking the same
question before; its own words are *"D/E gate the game on a public browser."*

### 2.2 ColossusWeb engine

| Fact | Evidence |
| --- | --- |
| `GameState` is **plain JSON** — no classes, functions, Maps or DOM. `dispatch` does `structuredClone(state)` and re-attaches `variant` (comment: "variant is plain data") | `web/src/engine/types.ts:214-258`, `GameEngine.ts:294-296` |
| **A serialiser already exists and is tested**: `saveGame` strips `variant`, round-trips through JSON, and runs field migrations | `web/src/persistence/saveGame.ts:5,26-38,102-194` |
| Commands are a plain discriminated union; `dispatch(state, cmd)` is a pure reducer | `types.ts:260-299`, `GameEngine.ts:289` |
| **BUT dice are not in the log.** `diceMode` defaults to `'rng'`, and faces are drawn from an ambient RNG at *apply* time (`rollDie` = `1 + Math.floor(rng()*6)`), so two clients replaying the same command log **diverge** | `types.ts:230-231`, `GameEngine.ts:74-85`, `movement.ts:253-255` |
| Faces *are* in the log only in `diceMode:'physical'`, where a `commitDice` command carries `values` — and `commitDice` **without** values silently falls back to the RNG | `GameEngine.ts:441-462`; the app does that in AI/instant paths, `components/App.tsx:42,49,179,223` |
| **Secrets are real and are carried in the state.** `legion.creatures` is the truth; `knownPublic` is what opponents may see. `publicViewSlots` gives **full contents to any human-owned legion regardless of who is asking** | `engine/publicKnowledge.ts:1-4,76-99`; `publicKnowledge.test.ts:93-100` |
| So a broadcast `GameState` **leaks every human seat's composition**, and `state.log`/`message` can embed contents too | `GameEngine.ts:519,551` |
| **There is no notion of "this client's player"** — the UI assumes hotseat and gates all input on whoever is active | `App.tsx:366,495-519`; `GameEngine.ts:281-283` |
| The one command seam is `apply` in `App.tsx:159-186`, but `engDispatch` is also called directly at `:149,155,179,220-224` | probe report |
| Dice ids are `dice-${Date.now()}-${Math.random()}` — they differ between clients even for identical games | `GameEngine.ts:53-55` |

## 3 · The blocking prerequisite — **FORK 1**

> **RESOLVED 2026-09-28 — option (a) was chosen and is LIVE.** ServerStore landed CORS
> (`bd55b7e`, "answer a browser on another origin, BEFORE the key guard"; its ledger rows
> 57/58) and restarted the service. Verified on the wire from this box: an unauthenticated
> `OPTIONS` carrying `Origin: https://apps.futuremagic.de` and
> `Access-Control-Request-Method: PUT` answers **204** with `allow-headers: authorization,
> x-api-key, content-type`, `allow-methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`,
> `expose-headers: x-serverstore-sha256`, `max-age: 600`; and a 401 on an authenticated
> route also carries `access-control-allow-origin`, so error envelopes are readable. The
> allowed origin is the **wildcard** (their default; `SERVERSTORE_CORS_ORIGINS` narrows it)
> — acceptable here because a key is still required and their pin O4 forbids
> `Access-Control-Allow-Credentials`. The analysis below is kept as the reasoning that
> produced the request.

**The browser could not talk to the store at all** before that. The app is served from
`apps.futuremagic.de → 127.0.0.1:8082` (a plain static file server); the store is
`store.futuremagic.de → 127.0.0.1:8477`. Different origins, and the store sends no
`Access-Control-Allow-*` headers and does not answer `OPTIONS` — in fact its key guard
matches **every** path before routing, so a preflight would come back `401`.

| Option | What it costs | Verdict |
| --- | --- | --- |
| **(a) Add CORS to ServerStore** — answer `OPTIONS` **before** the auth guard, return the exact origin, `Allow-Headers: authorization, x-api-key, content-type`, `Allow-Methods: GET, PUT, DELETE, OPTIONS`, `Vary: Origin` | One small slice in that project, then a service restart (GUARD g5) | **RECOMMENDED** — it is already on their queue as step E, it is the smallest change, and it fixes the problem for any future app, not just this one |
| (b) Serve the game from `store.futuremagic.de` (same origin, no CORS) | That service serves exactly three literal routes today (`/`, `/app.js`, `/app.css`) and has no static subsystem — so it means adding one **plus** bending the app to its origin | Rejected — bigger than (a) in the project we do not own |
| (c) New hostname + a proxy that fronts both app and store | A new tunnel ingress (a restart drops `dsh`, `opencode` and `openclaw` for a few seconds — their TRAP t1) plus a new service to run | Rejected — the most moving parts |
| (d) A Cloudflare Transform Rule adding the headers | Transform Rules rewrite responses; they **cannot answer a preflight**, so the browser still fails | Rejected — does not work |

**Until (a) — or an equivalent — exists, no amount of ColossusWeb work can produce a
working multiplayer game.** This is the first thing to settle.

**Concretely, the change is small and its seam is known.** `app.use("*", guard)`
(`src/server/app.ts:304`) runs on **every** method and demands a key, so today an
unauthenticated `OPTIONS` gets `401` and an authenticated one falls through to `404`.
A CORS middleware must therefore be mounted **before** that guard, must answer `OPTIONS`
without a key, and must send `Access-Control-Allow-Origin` (the exact origin, or `*` —
`Authorization` is a header, not a CORS *credential*, so `*` is legal),
`Access-Control-Allow-Headers: authorization, content-type, x-api-key`,
`Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS`, and
`Access-Control-Expose-Headers: x-serverstore-sha256` (that response header is set at
`app.ts:642` and a client wants to read it). Then **restart the service** (GUARD g5) and
re-run `scripts/probe-live.sh`.

## 4 · Architecture (the part I can design now)

### 4.1 Identity
Each player holds **their own** ServerStore key, scoped to the stores they may touch,
minted by the owner in the admin UI he already has ("key for tom"). The app calls
`GET /whoami` to learn `{id, label}`; that id is the player's identity and the writer tag
in object names. **No key is ever shipped in the app.**

**The owner has settled where the key lives, verbatim:**

> "Players need to provide their key. With that key the app needs to try to connect to the
> colossus store and immediately reject it if it does not work. Otherwise store it in local
> storage."

So the flow is: **paste → validate immediately via `whoami` → reject loudly and persist
nothing if it fails → otherwise store it in `localStorage` → re-validate on load and drop it
if it no longer works.** A "Forget key" control removes it.

**The risk call is the owner's, and he has made it — CLOSED, not to be relitigated.** His
words: *"The risk for that key getting misused is minimal and the store is isolated anyways,
so there is no need for complicated security, ease of use is way more important here. Worst
case is that some game data is broken... which is not critical at all."* He is right about
the isolation, and it is checkable: a key's scope is enforced **per store** — a key scoped to
`colossus` is refused `403` on every other store (`API.md:119-124`, `app.ts:121-138`) — so the
worst case is broken game data and nothing else. **Therefore nothing is built for key
management: no expiry policy, no per-device ceremony, no session-only escape hatch.** A
"Forget key" control stays because it is one button and pure ease of use. The only thing
retained is mandatory `whoami` validation on entry, and that is the owner's own requirement
rather than a security measure.

### 4.2 The lobby — named games you can find
A game is two kinds of object in the `colossus` store:

- **`g.<gameid>.game`** — written **only by the creator**: first at *Create*, then again at
  *Start* to flip the status. Exactly one writer, so it can never be clobbered — the store's
  "serialise on one writer" rule satisfied by construction rather than by luck.
- **`g.<gameid>.p.<keyid>`** — one object **per player**, written by that player when they
  join. Written by its owner, so two joins never race.

Discovery is then a read of the store's object list, filtered client-side by prefix —
nothing else is needed, and the list route already exists. A player joins by writing their
own `p.` object; the creator's client sees it on its next poll.

**The list route is for LEARNING NAMES, never for reading content (S4).** The list returns
`{name, sha256, size, createdAt}` for every object, and `sha256` is a content address, so a
polling client remembers `{name -> sha256}` and **point-reads a body by name only when that
name is new or its hash changed** (`web/src/net/contentCache.ts`). Before S4 a tick re-read
the newest snapshot body and every listed game's body every time; now the steady state of a
tick — nothing happened — is **one list request and zero body reads**, and a change costs
exactly the bodies that changed. A name that disappears, or whose hash moves, is dropped, so
the cache can never serve stale or resurrected content, and it changes nothing about which
snapshot wins, fork detection or adoption.

**Honest limit, measured rather than hidden:** this shrinks the BODY reads, not the list.
The list still returns **every object in the store, unpaginated**, because that is all the
service offers; a `since=`/prefix filter is queued on the ServerStore side and is out of
scope here.

**Name budget — it is tighter than it looks.** Object names are capped at **64 characters**,
so `g.<gameid>.p.<playerid>` must fit with room to spare, and S3's snapshot names have to fit
too. A ServerStore key id is UUID-shaped (~36 chars), which leaves almost no headroom.
Therefore: the **name uses a short, stable player tag — the first 8 characters of the
lowercased key id, the same public handle the service renders itself — while identity
comparisons keep using the full `whoami().id`.** `gameid` is a capped slug plus a short
random suffix, and a pin asserts that the longest legal display name still produces a legal
name for **both** object kinds. Nothing may rely on a long name happening to fit.

`gameid` is a lowercase slug plus a short random suffix (`g.tonights-game-7f3a`), because
names are lowercase, flat and capped at 64 characters — the *display* name lives inside the
object and can be anything.

### 4.3 Turn sync — one writer at a time, by the game's own rule
The authoritative state is **the latest snapshot object**. After a local command the
client writes a new one; everyone else polls the object list, notices a new/changed name
(via `sha256`, which the list already returns), reads it and adopts it.

**Why this cannot clobber:** Titan's rules give exactly one seat the right to act at any
moment (`activePlayerIndex`, plus the battle step for engagements), and `applyCommand`
already enforces that from the state. So **the right to write a snapshot is derived from
the state, not claimed by a client.** The client disables input unless the state says it is
its turn.

I am *not* trusting that alone. Snapshot names carry the writer's id —
`g.<gameid>.s.<turn>.<seq>.<writerid>` — so a race between two clients produces **two
detectable objects** (a fork) instead of a silent lost update, which is precisely the
failure `API.md:470-474` warns about. Fork resolution is a rule, not a hope: the
turn-owner's snapshot wins and the other author re-issues.

**The trust model has to be stated plainly, because the store gives us no authority.**
There is no per-object isolation (§2.1): a key with `read`/`write` on `colossus` can list,
read, **overwrite and DELETE every object in it** — other players' joins, other games'
snapshots, the lobby entries. Writer-tagged names and state-derived turn authority defeat
**accidental** races and stale writes; they do not restrain a player who edits their own
client or curls the store with their own key. Nothing we can build inside the app changes
that, because the app is not in the request path: the store is. So v1 multiplayer is a
game among people who already trust each other with a shared bucket, and its real defences
are detection (a fork is visible) and social (the owner can revoke a key). If that is not
acceptable, the only lever the service offers is **partitioning into more stores** — which
buys isolation between players, not authority over a shared public object.

Object names sort lexicographically, so zero-padded `turn`/`seq` make "newest" a simple
max — no clock trust, no `since=` needed.

### 4.4 Secrets — **FORK 2**
`publicViewSlots` reveals a legion's full contents to *any* client when the owner is human,
and the truth (`legion.creatures`) rides inside `GameState`. So a shared snapshot is
readable-truth, and a player who leaves the app and curls the store with their own key can
see an opponent's legions.

| Option | Cost | Verdict |
| --- | --- | --- |
| **(a) Honour system** — the shared snapshot holds the truth; the UI redacts opponents' legions exactly as it does today for hotseat | No engine change. Cheating needs deliberate out-of-app effort | **RECOMMENDED for v1** — a game among people who already share a store key |
| (b) **Per-player stores** — public store + one private store per person; each key scoped to `{colossus, colossus-<them>}`, so the service itself refuses to serve A's secrets to B. Zero cryptography, real enforcement — **and measured to be the ONLY mechanism that exists**: there is no object ACL, so isolation can come from partitioning or from nowhere (`src/server/app.ts:121-138`) | The engine must run on partial knowledge, and legions must be revealed at engagement (which is the actual game rule). This is a real state-model refactor | The hardening path, as its own slice |
| (c) Encrypt each player's secrets with a key only they hold | Needs keypair distribution and a reveal protocol on top of (b)'s refactor, for no extra guarantee | Rejected — (b) already gets the guarantee from the service for free |

Note (b) is the more faithful model anyway: on a real table each player holds their own
legion's chits, and leggings are revealed when they engage.

### 4.5 Dice
Whoever rolls, rolls — their client produces the faces and the snapshot carries them.
That is forgeable in principle. Commit–reveal (each player publishes a hash before the
roll, the faces derive from all secrets) closes it and costs a round-trip per roll. For v1
the roller is trusted, exactly as a physical game trusts the person throwing the dice; it
is recorded here as a known limit rather than an oversight.

One mechanical trap the probe found: in `diceMode:'rng'` the faces are **not** in the log,
and `commitDice` without `values` silently falls back to the RNG. Any log/replay-based
transport must force `diceMode:'physical'` and refuse a `commitDice` with no values. A
snapshot-based transport does not replay and so is immune — another reason to prefer it.

## 5 · Decisions I am taking myself (reversible, low-friction)

1. **Snapshots, not a command log, for v1.** A snapshot reuses `saveGame`'s existing,
   tested (de)serialiser — one seam instead of two — and is immune to the dice-replay
   problem in §4.5. A log can follow as an optimisation (it also gives replays and audit).
2. **One `colossus` store, filtered client-side by prefix**, rather than a store per game.
   Per-game stores would need the owner to edit every player's key scope for every new
   game (`PATCH /keys/{id}` exists, but it is manual). Revisit if the object list grows
   enough to matter.
3. **`variant` is not in the snapshot.** `saveGame` already strips it; a game names its
   variant and every client loads the same one.
4. **Poll every ~2s in a GAME and ~5s in the LOBBY, only while the tab is visible**, with
   backoff on error — ONE loop carrying two jobs (`web/src/net/sync.ts`'s `pollLoop`; the
   lobby's job is `web/src/net/lobbyWatcher.ts`). There is no push channel and no rate limit,
   so the interval is the only throttle we control; turn latency is what a player feels in a
   game, while the lobby's event is the human-paced "somebody pressed Join", and 5s is under
   the threshold where a person concludes a screen is dead.
5. **Dice ids are normalised or excluded from equality**, since they differ per client.
6. **A game's objects are DELETEd when it finishes** — the store has no GC, and the lobby
   list is unpaginated, so finished games must be cleaned up by the host client.

## 6 · The two forks for the owner

**FORK 1 — the CORS prerequisite (§3).** Recommend **(a) add CORS to ServerStore**. It is
their queued step E, it is the smallest change, and it is the only option that does not
grow infrastructure. Rejected: (b) same-origin via the store service, (c) new hostname +
proxy, (d) Cloudflare Transform Rule (cannot answer a preflight).

**FORK 2 — secrets (§4.4): SETTLED by the owner's risk call — the HONOUR SYSTEM (a).** He
prioritised ease of use over protection and accepted that the worst case is broken game
data, which is precisely the trade the honour system makes. Per-player stores (b) are
therefore **not planned and not queued**; they would only come back if the owner ever wants
cheating to be *hard*, and that would be a new decision rather than a slice waiting in line.
Rejected as before: (c) per-player encryption.

## 7 · Slice plan (nothing dispatched yet)

| # | Where | Slice | Blocks |
| --- | --- | --- | --- |
| **S0** | ServerStore | ~~**CORS + `OPTIONS` preflight before the auth guard**~~ — **DONE 2026-09-28**, landed by ServerStore (`bd55b7e`) and verified live from here (§3). No ColossusWeb work needed | — |
| S1 | ColossusWeb | Store client behind a transport interface (list/get/put/delete), key entry in memory, `whoami` → identity. A fake in-memory transport so the lobby and sync are testable **without the network** | S2+ |
| S2 | ColossusWeb | **The owner's three lobby actions: Create Multiplayer, Join Multiplayer, and Start Multiplayer (creator only).** Create writes `g.<id>.game`; Join writes the caller's OWN `g.<id>.p.<keyid>`; Start flips the game to started and only the creator's client performs it. Discovery is the prefix-filtered object list | S3 |
| S3 | ColossusWeb | Turn sync: publish a snapshot after each local command; poll and adopt; input disabled unless the state says it is your turn | S4 |
| S4 | ColossusWeb | Robustness: writer-tagged fork detection and resolution, reconnect/resume, cleanup of finished games | — |
| S5 | both | ~~per-player stores, commit–reveal dice~~ — **DROPPED by the owner's risk call** (a shared snapshot may hold the plain truth; no crypto, no partitioning). What remains, and only if it ever actually bites: polite polling and ServerStore rate limiting | — |

Pins I would require from S1–S3, phrased as statements: *the key reaches `localStorage`
only after `whoami` accepted it, is re-validated on load and removed when it fails, and
travels only in the `Authorization` header* (S1 — this supersedes the earlier "no key is ever
written to storage" wording, which §4.1 has since settled); *a snapshot written by a seat that
may not act is rejected*; *two clients fed the same snapshot sequence converge on the same
state*; *a lobby lists only games that are joinable*; *a join by player B cannot overwrite
player A's join*.

## 8 · Honest unknowns

- ~~Whether the `colossus` store exists~~ — **verified**: it is in the live database
  (`/home/administrator/serverstore-data/serverstore.db`, kind `bytes`, created
  `2026-09-27T21:45:32Z`), with a key already scoped to it, and **no objects yet**. I did
  not read or use any key material to establish this.
- The real size of a snapshot (state minus `variant`) — `saveGame` fits in `localStorage`,
  so it is small, but it has not been measured.
- Whether ~2s polling is acceptable in practice against the tunnel, and what it costs the
  box. No rate limit exists to tell us.
- Whether the owner wants **registered players** (keys minted per person) or an open
  "anyone with the store key" model. The key model implies the former.
- Nothing here has been prototyped; every engine claim above is from reading, not running.
