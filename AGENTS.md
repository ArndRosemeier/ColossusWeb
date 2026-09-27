# ColossusWeb — agent/workspace rules

A **TypeScript browser port of Colossus** (the board game *Titan*): hotseat + AI play.
`web/` is the product — React 19 · Vite · Vitest · oxlint, Node 24. `Colossus/` is the
original **Java** implementation, kept as the behavioural reference; it is **not** built
or shipped here.

Read `docs/rules/README.md` before touching game rules, and `docs/ARCHITECTURE.md`
before touching a subsystem. The owner's rule-coverage matrix is
`docs/rules/COMPLIANCE.md` — it is this project's own record of which rules are
implemented and which tests cover them. **Amend it; do not duplicate it.**

The full process — roles, the board, verification doctrine, the brief template — is in
the shared doc `WAY-OF-WORKING.md` (Toolbox repo). Read it when you are new to this
workflow. This file holds only what is **binding here**.

## Host facts that change what is verifiable

These are measured properties of the machine, not preferences.

1. **There is NO Java toolchain on this host.** `java`, `javac`, `jar`, `ant` and `mvn`
   are all absent; `/opt/java` does not exist. (A `java` process can appear in `ps`
   belonging to another tenant — that is not ours and does not make a JDK available.)
   Therefore **`Colossus/**/*.java` cannot be compiled, run or tested here**, and no
   gate covers it.
   - **Consequence:** the Java tree is **read-only reference**. A claim about Java
     behaviour is evidenced by quoting `Colossus/<file>.java:<line>` and the rule it
     implements — never by "it builds", and never by a test that does not exist.
   - `docs/rules/README.md` sets the authority order: Colossus Java when it
     *intentionally* differs → official Titan rules → noted MVP simplifications.
2. **`web/` is the only verifiable stack**, and `scripts/gate.sh` is the one way to
   verify it.
3. **`npm run convert` rewrites TRACKED files** — `web/public/variants/**`, 1372 tracked
   paths — from `Colossus/variants/*.xml`. It is a *data-generation* step and is
   **deliberately excluded from both gate tiers**, because gating with it would dirty
   every gated tree and make a green result non-reproducible. Run it deliberately when
   variant XML changes, and commit its regenerated JSON in the same commit.
4. **The default branch is `master`** (not `main`). Wherever the shared docs say `main`,
   read `master`.
5. `Colossus/` is the only place a JDK would be needed, and installing one is out of
   scope until an owner request actually needs it.

## Binding engineering rules

1. **No silent fallbacks.** When data, parsing or a step fails, propagate a LOUD
   error. Forbidden: finalizing an artifact from an empty or failed draft,
   `catch`-and-continue around parsing, logging an error with no user-visible
   surface, placeholder values standing in for required data. Defaults are allowed
   only for genuine user preference or optional enrichment — never to mask a
   failure.
2. **Errors must be visible** through the app's one error surface.
3. **Validate at every boundary.** Machine output is parsed against a schema; a
   validation failure fails the step. It never becomes empty data.
4. **Centralize, and keep it simple.** When one idea is implemented in more than one
   place, make it ONE seam and route callers through it. When you touch an
   already-distributed pattern, folding it is part of the change — unless that is
   genuinely more expensive than the defect, in which case say so in writing where
   the next reader will hit it.
5. **A cross-cutting discovery starts with the seam question, and the answer is
   WRITTEN DOWN.** Every brief and every landing report carries ONE greppable line:
   `COPIES: n→1 — <the seam that now carries it>` when copies were folded, or
   `COPIES: 1 — checked, no duplication (grepped: <what>)` when the change is
   genuinely single-site. A brief without it is incomplete; a landing without it is
   not verified.

## Standing rule: critique the instruction

**The owner's instructions are INTENT, not design.**

1. **Extract the intent first** — the felt problem behind the literal ask.
2. **Say it when the ask is flawed**, plainly and briefly, with the better route and
   its reasoning.
3. **Do not silently substitute.** A different design may replace the asked-for one
   only when it serves the SAME intent *and* the owner has been told. The owner must
   always be able to see which decisions were theirs.
4. **Judge the friction.** Minor imperfections get decided in one line, not debated.
5. **Route the critique through reality, not taste.** "This breaks X, here is the
   code that proves it" is a critique; "this feels off" is not.
6. **Bind briefs to it too.** Every brief tells the writer to report BLOCKED — with
   evidence — rather than implement something it can prove is wrong, **including
   when the flaw is in the brief's own design**.
7. **The decision stays the owner's.** Present the better way once; if the owner
   reaffirms, execute it well and stop re-arguing.

## Reading the owner's reports

Unusual characters in a pasted report are the **transport**, not a symptom — text can
be mangled before anything of ours sees it. Do not scope work from a mangled glyph,
and do not report one as a defect. Diagnose a real encoding problem only from what
the owner says he **sees on screen**, or from an artifact you can render yourself.

## Parallel writers

Read-only agents always run in parallel. **At most TWO writing agents** may be in
flight, and only in **separate worktrees** (`git worktree add`) — writers sharing one
working tree share one git index, and `git commit` commits the whole index, so file
disjointness does NOT protect the commit phase.

1. **File disjointness applies to source files and CANNOT hold for the docs.** Every
   landing amends the board and usually the ledger, so two concurrent writers WILL
   conflict there. The dispatcher assigns the ledger row number in every brief; a
   writer that still hits a docs conflict resolves it as a mechanical UNION,
   renumbers its OWN row only, touches nothing of the other landing, proves that with
   `git diff --name-only`, re-gates on the rebased tree, and pushes.
2. **A conflict anywhere else** means the disjointness check missed something: STOP
   and report; do not resolve it.
3. **Rebase before every push** (`git pull --rebase origin master`), then push. Where
   the main branch deploys, it is not a staging area.
4. **Absolute paths in every brief.** Every shell call runs in a fresh shell whose
   cwd is the session workspace, and file tools resolve relative paths against it —
   so a writer told to work in a worktree edits the MAIN tree unless every path is
   absolute.
5. **Worktrees live INSIDE the repo** (`<repo>/worktrees/<slice>`, gitignored and
   excluded from lint) — never in `/tmp`, whose behaviour depends on a sandbox mode
   that is not yours to rely on.
6. **A writer that cannot finish must COMMIT the coherent partial state on its
   branch and report BLOCKED.** Uncommitted work dies with the session.
7. **Cadence contract.** Writers report on LANDING or BLOCKED, nothing in between.
   The dispatcher waits in silence; a clean tree with no new commit while a writer
   runs is normal.

## The gate

One command — `bash scripts/gate.sh` — run from the ROOT of the tree you mean to gate.
Run it; do not invent another. See `scripts/gate.sh` for the exit-code vocabulary
(`0` green · `1` failed · `2` cheap tier only · `9` refused, VOID) and `docs/BOARD.md`
for how a result is recorded.

- **The cheap tier blocks a push; the expensive tier makes a change VERIFIED.**
- **A red gate is information, not an obstacle.** Fix the cause; never re-run until
  green.
- **Never pipe a check through `tail`/`head`** — it destroys the failing evidence,
  and the pipeline's exit status becomes the last command's, so unverified work lands
  under a message claiming a pass. The gate itself uses `tee` + `PIPESTATUS`; do not
  "simplify" that.
- **One expensive check at a time**, enforced by the lock, not by a glance.
- **`GATE_TESTS=0` returning `2` is not a pass.** `2` means the suite did not run.

## Host hygiene

The box is shared; the discipline that protects it protects every other session on
it.

1. **At most two writers in flight.** Count the registry before dispatching.
2. **No synthetic load, ever.** A flake is proved deterministic by delaying its
   cause, never by loading the machine.
3. **Every run carries a memory ceiling**, and one suite runs at a time. The full
   tier runs under `/usr/bin/time -v` and the record quotes the peak it printed.
4. **An interrupted turn's processes are the dispatcher's to reap** — a turn that
   dies does not kill what it started. The audit includes **browsers** (`chrome`,
   `chromium`, `headless_shell`, `playwright`), not only test runners.
5. **Kill by PID captured in a SEPARATE call — never by a pattern in the same
   shell.** A `for p in $(pgrep -f "<pattern>"); do kill $p; done` one-liner
   SIGTERMed the shell running it **twice in one session**, and the `[x]` bracket
   trick fails when the pattern is also literal text in that same argv. Capture
   (`pgrep -f '<pat>' > pids.txt`), then kill (`xargs -r kill < pids.txt`), then
   verify with a count that cannot self-match (`ps -eo comm= | grep -c '^chrome$'` —
   expect `0`).
6. **A headless browser is a process TREE, and its kill belongs in a `trap`.** ONE
   headless-Chrome run left **33 Chrome processes** alive — browser, zygote, GPU and
   renderer children. Killing the launcher does not kill the tree, and a cleanup that
   runs only on the happy path is skipped entirely when a page fails to render. Start
   a browser in-turn, kill the tree before you report, on success and failure alike.
7. **Nothing outlives the writer:** scratch harnesses live under its own worktree,
   never `/tmp`; every process it starts — a browser included — is foreground or
   killed before it reports.
