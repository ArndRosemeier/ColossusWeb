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
reconciled: 48be1070d11b6d0edfc7f5a24610734573ac40be · 2026-09-27T22:12Z

SESSION | id=session-c415d674-2dd3-428b-97d2-809e492615e9 | model=deepseek-flash | state=ready — no work order in hand

QUEUE | row=1 | owner: "be my chief of staff" — a designation, not yet a work order; awaiting the first task
QUEUE | row=5 | known debt: docs/ARCHITECTURE.md §2 (the seam index) is NOT surveyed — a read-only probe could fill it

LANDED | row=0 | lands=this commit (`git log -1 --format=%H -- docs/BOARD.md`) | base=48be1070d11b6d0edfc7f5a24610734573ac40be
  | verify=DISPATCHER'S OWN, on the base tree: cheap tier GREEN (tsc -b + vite build, 61 modules,
  387ms) · full gate exit 0 · oxlint 14 warnings / 0 errors · vitest 271 passed | 2 todo (273)
  in 45 files + 1 skipped file · peak 302712 KB (~295 MB) · raw log .gate-logs/gate.log
  | acceptance=BOARD RECONCILED (exit 0) + GATE_TESTS=0 -> exit 2, both as the scaffold requires
  | retired=nothing (no writer was dispatched; this was dispatcher-side setup)
  | docs=this file, docs/TESTING.md (baseline), docs/DECISION-LEDGER.md rows 1-4, AGENTS.md, scripts/*

RECOVERY | repo=/home/administrator/projects/ColossusWeb | remote=origin=https://github.com/ArndRosemeier/ColossusWeb.git
RECOVERY | branch=master | base=48be1070d11b6d0edfc7f5a24610734573ac40be | gate=bash scripts/gate.sh (from the tree ROOT)
RECOVERY | product=web/ (TypeScript, verifiable) | reference=Colossus/ (Java, NOT buildable on this host)
RECOVERY | logs=.gate-logs/gate.log (gitignored) | worktrees=./worktrees/ (gitignored)
```

Nothing is in flight. No writer branches, no worktrees:
`git worktree list` → only the main tree. `git branch -a` → `master`, `origin/master`.

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
