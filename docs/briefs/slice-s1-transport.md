# Slice S1 — the transport foundation

> **SUPERSEDED IN ONE POINT, MID-FLIGHT (2026-09-28).** The owner changed the key rule
> after this brief was dispatched: *"Players need to provide their key. With that key the
> app needs to try to connect to the colossus store and immediately reject it if it does
> not work. Otherwise store it in local storage."* So the key **is** persisted in
> `localStorage` (one entry, `colossusweb.key.v1`), and only **after** `whoami` accepted it;
> a stored key is re-validated on load and removed if it fails. Everything in §What to build
> item 4 and the pin "the key is never persisted" below is superseded accordingly; the
> design of record is `docs/design/multiplayer.md` §4.1 and the landing is recorded on
> `docs/BOARD.md`. The rest of this brief stands as written, and it is kept unedited below
> as the dispatch record.

**Ledger row: 7.** Board line: the `IN-FLIGHT` row for `mp-transport`.

## The owner's request (verbatim) and the intent

> "I want to use that to allow multiplayer games for this app, using the colossus store to
> store game states and handle the multiplayer as the only way to communicate. This would
> need named games that players could then find on their client so they can join."

Intent: **multiplayer with no server of our own** — ServerStore is both the storage and the
messaging. The full design, all measurements and the slice plan are in
`docs/design/multiplayer.md`; read it first, and `AGENTS.md` for the binding rules.

**This slice is the transport foundation ONLY.** No lobby, no game-state sync, no polling,
no turn authority. Those are S2-S4 and they must not appear here.

## Why this shape

The store's client contract exists and is pinned (`ServerStore/docs/API.md`), and the
things a browser needs are live and verified from this box: CORS answers a preflight on
`store.futuremagic.de` with `204` and `allow-headers: authorization, x-api-key,
content-type` (measured 2026-09-28). So the network is no longer the unknown — **the
unknown is our own code**, which is why the whole slice must be testable with **no network
at all**.

## What to build

1. **`web/src/net/transport.ts`** — the interface the rest of the game will depend on, so
   nothing above it ever imports `fetch`. Operations over named opaque objects in ONE
   store: list, get, put, remove, plus `whoami()`. Plain data in, plain data out.
2. **`web/src/net/serverStore.ts`** — the HTTP implementation. Base URL
   `https://store.futuremagic.de` (env-overridable), the key in the `Authorization: Bearer`
   header **only**, the `{error:{code,message}}` envelope parsed into a thrown error that
   carries **both** `code` and `message` (no silent fallback, per `AGENTS.md` rule 1), and
   the `x-serverstore-sha256` response header surfaced when present.
   Object names must satisfy the service's rule — `[a-z0-9][a-z0-9._-]{0,63}` — so validate
   and refuse an illegal name loudly rather than letting the server 400.
3. **`web/src/net/memoryTransport.ts`** — an in-memory fake implementing the **same**
   interface, used by tests and by anything that must run offline.
4. **`web/src/net/keyStore.ts`** — the caller's key, **in memory only**, plus `whoami()`
   identity (`{id, label, stores, perms}`). No persistence of any kind.
5. **A minimal UI affordance** — a small panel to paste a key, connect, and show the
   identity `whoami` reports (label + id) or the refusal, with a disconnect/forget action.
   Nothing else in the app may change behaviour.
6. **Wire nothing into the game.** No snapshot, no lobby, no polling.

## Pins — each phrased as a statement

Reuse the existing Vitest harness (`web/src/**/__tests__/*.test.ts`); never build a second
fixture set. A test's NAME must say what it protects.

- **The key is never persisted**: after connecting, `localStorage`, `sessionStorage`, the
  URL, `history` and `document.cookie` contain no key material. (Assert over the real
  storage objects, not by grep of the source.)
- **The key travels only in the `Authorization` header** — never a query string, never a
  path segment, never a body.
- **A failure is never silent**: an error envelope is surfaced with its `code` and its
  `message`, and the caller can branch on `code`.
- **One contract, two implementations**: the SAME suite of contract assertions runs against
  both the HTTP implementation (with a stubbed `fetch`) and the in-memory fake.
- **`whoami()` never returns key material** — no key, no hash, no prefix.
- **An illegal object name is refused locally**, before any request is made.

## Out of scope — say so in the report if you are tempted

The lobby and named games (S2); snapshots, polling and turn authority (S3); fork detection
and resume (S4); per-player stores, dice commit-reveal, rate-limit-friendly polling (S5).
**Do not add a store name to the transport:** it takes the store as a parameter, because
Fork 2 (one shared store vs per-player stores) is still open with the owner.

## Verification (yours)

1. The ONE gate command, from the **root of your worktree**: `bash scripts/gate.sh`. Keep
   the raw log (`.gate-logs/gate.log`). Exit `9` = lock busy → **wait and retry**; never
   reap another actor's processes.
2. Your **own differential**: every arm's file hash PRINTED, the lock held before injecting,
   restore from HEAD in a `trap`. Two arms with identical output are a VOID probe, not
   evidence. At least one arm must make a named pin go RED.
3. Commit, then `git pull --rebase origin master`, then push.
4. **If you cannot finish, COMMIT the coherent partial state on your branch and report
   BLOCKED.** Uncommitted work dies with the session.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` row **7**; `docs/BOARD.md` (turn your `IN-FLIGHT` line into a
`LANDED` line carrying your gate numbers); `docs/ARCHITECTURE.md` (add the new seam row).
Carry the `COPIES:` line — `COPIES: n→1 — <seam>` or `COPIES: 1 — checked (grepped: <what>)`.

## Your report (short)

LANDED or BLOCKED, then: sha; gate exit + counts + peak; each arm with its printed hash and
what went red; the `COPIES:` line; how the deliverable actually works; your judgement calls;
the docs you amended; and **anything this brief got wrong**.

Report NOTHING in between — silence until LANDED or BLOCKED. If you can PROVE a rule here is
wrong (including this brief's own design), report BLOCKED with the evidence rather than
implementing it.
