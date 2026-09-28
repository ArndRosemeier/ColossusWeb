# Slice S5 — use the store's `prefix=` filter, and obey its rate limiter

**Ledger row: 11.** Board line: the `IN-FLIGHT` row for `prefix-ratelimit`.

Read `AGENTS.md` first, then `docs/design/multiplayer.md` §4.2–§4.3. S1–S4 are landed and
verified on `master`. ServerStore has since shipped **two** changes that this slice reacts to;
both were verified against their code by the dispatcher (board `VERIFIED-LIVE`, and do not
re-derive them):

## What the store now offers, measured

**A `prefix=` filter on the listing** (`GET /stores/{store}/objects?prefix=<name>`): returns
only entries whose name STARTS WITH the prefix. Measured on a scratch instance of their code:

| request | result |
| --- | --- |
| absent | every object (unchanged — backward compatible) |
| `prefix=game.` | exactly the game records |
| `prefix=player.<gameid>.` | exactly that game's participants |
| `prefix=snap.<gameid>.` | exactly that game's snapshots |
| `prefix=zzz` | `200` with `{"objects":[]}` — never `404` |
| `prefix=GAME.` or `prefix=` | **`400 invalid_name`** — never the whole store |

The prefix obeys the SAME rule as a name (`[a-z0-9][a-z0-9._-]{0,63}`).

**A rate limiter, on by default**: `600` requests per **client IP address** per fixed
60-second window — `CF-Connecting-IP`, else the first `X-Forwarded-For` hop, else one shared
`local` bucket. Over it: **`429 rate_limited`** with **`Retry-After: <whole seconds>`**. It runs
**before** the key guard, so a `401` COUNTS. `/healthz`, the console assets and CORS preflights
are never limited. Measured: 5 allowed, then 429 + `Retry-After: 60`.

## Part A — kind-led names, and one narrow request per access pattern

Our names are prefix-hostile: `g.<gameid>.game`, `g.<gameid>.p.<tag>`, `g.<gameid>.s.<turn>.<seq>.<tag>`
means `prefix=g.` returns **everything**, so the filter would buy us nothing today. Rename so the
KIND leads, one prefix per access pattern:

- **`game.<gameid>`** — the record. `prefix=game.` is EXACTLY the lobby list.
- **`player.<gameid>.<tag>`** — a participant. `prefix=player.<gameid>.` is exactly one game's players.
- **`snap.<gameid>.<turn>.<seq>.<tag>`** — a snapshot. `prefix=snap.<gameid>.` is exactly one
  game's sync, and NOTHING else.

All fit the 64-char rule (the longest, `snap.`, is 55 at `gameid` = 32). Keep the zero-padded
`turn`/`seq` and the 8-char tag EXACTLY as they are — the ordering and fork rules must not move.

1. **Add the prefix to the transport**: `list(store, prefix?)`, validated LOCALLY against the
   same name rule before any request (a loud `invalid_name`, matching the existing local name
   guard) and sent as `?prefix=` (URL-encoded). The in-memory twin must implement the same
   filtering — it is held to the same contract suite, so extend that suite rather than writing
   a second one.
2. **Use it at every list call site**: the lobby (`game.`), a game's participants
   (`player.<gameid>.`), and the sync (`snap.<gameid>.`). This is the whole point: today the
   lobby lists the WHOLE store every 5s, and snapshots dominate it — one object per move — so
   it degrades as a game runs.
3. **Old-scheme objects must be IGNORED, never mis-parsed.** The live store holds three `g.*`
   objects from the owner's test game. They are test data and are **deliberately orphaned** —
   the owner's own risk call is that broken game data is not critical — but the client must not
   crash on them, must not treat them as games, and must not delete them. Pin that.

## Part B — obey the limiter

1. **Surface `Retry-After`**: a `429` must reach the caller as a `rate_limited` error that CARRIES
   the retry delay (whole seconds). The transport is the ONE place that reads response headers
   today (`x-serverstore-sha256`); extend that, do not add a second reader.
2. **The poll must wait it out**: on a `rate_limited` failure the next tick is scheduled no
   sooner than `Retry-After`, INSTEAD of the existing doubling backoff — whose cap is
   `interval × 8` (16s in a game, 40s in the lobby) and would therefore retry INSIDE a 60-second
   window it was told to leave alone. A non-429 failure keeps the existing backoff, unchanged.
3. **Say it in words, not as a catastrophe**: the status surface should read as "the store is
   busy — slowing down", with the wait, rather than an unexplained failure. Follow the existing
   `PollStatus.detail` pattern; do not invent a second status channel.

## Pins — each phrased as a statement

- **Names lead with the kind**, and every name builder still fits the service's 64-char rule at
  the maximum `gameid`.
- **`prefix=game.` returns only game records**, `prefix=player.<gameid>.` only that game's
  players, `prefix=snap.<gameid>.` only that game's snapshots — asserted for BOTH transport
  implementations through the ONE contract suite.
- **A prefix is validated locally** and an illegal one is refused before any request is made.
- **A prefix matching nothing is an empty list, not an error** (measured behaviour).
- **An old-scheme `g.*` object is ignored**: it is not listed as a game, not parsed as one, and
  not deleted.
- **A `429` carries its `Retry-After`**, and the next poll is scheduled no sooner than that many
  seconds — assert the SCHEDULED delay, not merely that an error was thrown.
- **A non-429 failure still uses the existing doubling backoff** (this slice must not change it).
- **A snapshot publish still names the successor from its parent** exactly as S3 pinned; the
  ordering and fork rules are untouched by the rename.

## Out of scope — say so if tempted

Any ServerStore change; `since=`/`limit`/pagination (not offered); `ETag`/concurrency; migrating
or deleting the old `g.*` objects; the shared-IP bucket arithmetic (that is their server's
behaviour, recorded, not ours to fix).

## Verification (yours)

1. The ONE gate command from the **root of your worktree**: `bash scripts/gate.sh`. A fresh
   worktree needs `(cd web && npm ci)` ONCE first or it exits 1 at preflight. Exit `9` = lock
   busy → wait and retry.
2. Your **own differential**: arms with PRINTED file hashes, lock held, restore from `HEAD` in a
   `trap`. **COMMIT BEFORE YOU INJECT** — `git checkout --` restores HEAD and will wipe an
   uncommitted change (this cost the dispatcher a fix), and compare the restored hash to the
   pre-arm hash.
3. Commit, rebase on `origin/master`, push your branch.
4. **If you cannot finish, COMMIT the coherent partial state and report BLOCKED.**

**Do not seek or use a real access key, and add no test that calls the live service.** The live
store is the owner's; prove everything against the in-memory twin and a stubbed `fetch`.

**A browser-level check is expected for anything the owner can SEE** (the status wording): two of
the last four slices shipped a defect a DOM-free suite could not see. `scripts/browser-check/`
holds a working CDP harness (an unreviewed starting point) and its README records the method.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` row **11**; `docs/BOARD.md` (turn the `IN-FLIGHT` line into `LANDED`);
`docs/ARCHITECTURE.md` (the name doctrine and the prefix-at-each-call-site rule; the retry rule);
`docs/design/multiplayer.md` §4.2 (the new names) and §5; carry the `COPIES:` line.

## Your report (short)

LANDED or BLOCKED, then: sha; gate exit + counts + peak; each arm with its printed hash and what
went red; the `COPIES:` line; how the prefixes map to the three call sites; the retry behaviour
you implemented; your judgement calls; the docs you amended; and anything this brief got wrong.

Report NOTHING in between — silence until LANDED or BLOCKED.
