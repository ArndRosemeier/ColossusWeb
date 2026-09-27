#!/usr/bin/env bash
#
# gate.sh — THE one way the suite runs in ColossusWeb.
#
# It is the single place where correctness, the machine and the shared host are
# handled at once. Do not hand-roll a test command; do not add a second gate.
#
# EXIT CODES ARE THE VOCABULARY — quote them exactly, never inflate them:
#   0  GREEN    the requested tier ran and passed
#   1  RED      the requested tier ran and FAILED (read the raw log)
#   2  CHEAP    the cheap tier passed and the expensive tier DID NOT run
#   9  REFUSED  another run holds the lock: VOID — not a failure, not evidence
#
# Usage:
#   bash scripts/gate.sh                 # full: cheap + suite (takes the lock)
#   GATE_TESTS=0 bash scripts/gate.sh    # cheap tier only (takes NO lock)
#   GATE_PLAN_ONLY=1 bash scripts/gate.sh
#
# Run it from the ROOT of the tree you mean to gate (the main tree or your worktree):
# both tiers execute in the CALLER's cwd. The log and the lock are deliberately
# derived from the git COMMON dir instead, so they are the SAME path from the main
# tree and from every worktree — that is what makes this ONE lock across writers.
#
# Env (defaults in brackets):
#   GATE_CHEAP_CMD   blocking tier: typecheck + bundle
#                    [cd web && npx tsc -b && npx vite build]
#   GATE_FULL_CMD    expensive tier: lint + suite
#                    [cd web && npx oxlint && npx vitest run]
#   GATE_LOG_DIR     where the raw log is written           [<repo>/.gate-logs]
#   GATE_LOCK_DIR    the atomic lock                        [<repo>/.gate-lock]
#   GATE_STALE_MIN   a lock with no live owner older than this is STALE [30]
#   GATE_TIME_BIN    peak-RSS timer for the full tier       [/usr/bin/time]
#
# `npm run convert` is deliberately NOT part of either tier: it rewrites TRACKED
# files under web/public/variants/ (1372 tracked paths), so gating with it would
# dirty every gated tree and make the result non-reproducible. See AGENTS.md.

set -u

# --- where the repo is (the COMMON dir, so one lock across all worktrees) -----
GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ -n "$GIT_COMMON" ]; then
  REPO_ROOT="$(cd "$GIT_COMMON/.." && pwd)"
else
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))"
fi

CHEAP_CMD="${GATE_CHEAP_CMD:-cd web && npx tsc -b && npx vite build}"
FULL_CMD="${GATE_FULL_CMD:-cd web && npx oxlint && npx vitest run}"
LOG_DIR="${GATE_LOG_DIR:-$REPO_ROOT/.gate-logs}"
LOCK_DIR="${GATE_LOCK_DIR:-$REPO_ROOT/.gate-lock}"
STALE_MIN="${GATE_STALE_MIN:-30}"
TESTS="${GATE_TESTS:-1}"
PLAN_ONLY="${GATE_PLAN_ONLY:-0}"
TIME_BIN="${GATE_TIME_BIN:-/usr/bin/time}"

LOG="$LOG_DIR/gate.log"
LOCKED=0
if [ "$TESTS" = "0" ]; then TIER="cheap"; else TIER="full"; fi

echo "tree:  $(pwd)"
echo "repo:  $REPO_ROOT"
echo "tier:  $TIER (GATE_TESTS=$TESTS)"
echo "cheap: $CHEAP_CMD"
[ "$TESTS" = "0" ] || echo "full:  $FULL_CMD"
echo "log:   $LOG"

if [ "$PLAN_ONLY" = "1" ]; then
  echo "PLAN ONLY — nothing was run."
  exit 2
fi

# --- preflight: fail LOUDLY rather than letting npm emit a confusing error ----
# No silent fallback: a tier that cannot run must never be recorded as a pass.
if [ ! -f web/package.json ]; then
  echo
  echo "PREFLIGHT FAILED — ./web/package.json not found under $(pwd)."
  echo "Run the gate from the ROOT of the tree you mean to gate (main tree or worktree)."
  exit 1
fi
if [ ! -d web/node_modules ]; then
  echo
  echo "PREFLIGHT FAILED — web/node_modules is missing. Install it first:"
  echo "  (cd web && npm ci)"
  echo "This is a PREFLIGHT failure, not a test failure: NO tier ran."
  exit 1
fi

mkdir -p "$LOG_DIR"
: > "$LOG"

release_lock() { if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi; }
trap release_lock EXIT INT TERM

write_owner() {
  printf 'pid=%s\nstarted=%s\ntier=%s\ntree=%s\n' \
    "$$" "$(date -u +%FT%TZ)" "$TIER" "$(pwd)" > "$LOCK_DIR/owner"
}

# The cheap tier deliberately takes NO lock: it touches nothing shared, so it can
# run alongside an expensive one.
if [ "$TESTS" != "0" ]; then
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    write_owner; LOCKED=1
  else
    OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
    if [ -n "$OWNER_PID" ] && kill -0 "$OWNER_PID" 2>/dev/null; then
      echo "REFUSED — the gate is already running (pid $OWNER_PID). This run is VOID."
      echo "A refusal is the lock WORKING: not a failure, not evidence. Exit 9."
      exit 9
    fi
    if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +"$STALE_MIN" 2>/dev/null)" ]; then
      echo "STALE lock (no live owner, older than ${STALE_MIN}m) — removing it and saying so."
      rm -rf "$LOCK_DIR"
      if mkdir "$LOCK_DIR" 2>/dev/null; then write_owner; LOCKED=1; fi
    fi
    if [ "$LOCKED" != "1" ]; then
      echo "REFUSED — lock held (pid ${OWNER_PID:-unknown}), not yet stale. VOID. Exit 9."
      exit 9
    fi
  fi
  echo "lock:  acquired $LOCK_DIR"
fi

run_tier() {
  local label="$1" cmd="$2" timeit="${3:-0}"
  printf '\n=== %s ===\n$ %s\n' "$label" "$cmd" | tee -a "$LOG"
  # tee keeps the FULL raw log; PIPESTATUS[0] keeps the COMMAND's own status.
  # Never `| tail`: that destroys the failing evidence AND the exit code, so a
  # `&& commit && push` chain lands unverified work under a message claiming a pass.
  # The full tier is timed so the record can quote a peak, per docs/GATE.md.
  if [ "$timeit" = "1" ] && [ -x "$TIME_BIN" ]; then
    "$TIME_BIN" -v bash -c "$cmd" 2>&1 | tee -a "$LOG"
  else
    bash -c "$cmd" 2>&1 | tee -a "$LOG"
  fi
  return "${PIPESTATUS[0]}"
}

report_peak() {
  local kb
  kb="$(sed -n 's/.*Maximum resident set size (kbytes): \([0-9]*\).*/\1/p' "$LOG" | tail -1)"
  if [ -n "$kb" ]; then
    echo "peak:  ${kb} KB (~$((kb / 1024)) MB) — from /usr/bin/time -v"
  else
    echo "peak:  NOT MEASURED (no $TIME_BIN) — an honest unknown, not a zero"
  fi
}

if ! run_tier "cheap tier (blocks a push)" "$CHEAP_CMD" 0; then
  echo
  echo "RED — the cheap tier failed. Raw log: $LOG"
  exit 1
fi

if [ "$TESTS" = "0" ]; then
  echo
  echo "CHEAP TIER GREEN — the suite did NOT run. Exit 2."
  echo "This is NOT 'the gate passed'. The expensive tier is owed when code changes."
  exit 2
fi

if ! run_tier "full tier (this is what makes it VERIFIED)" "$FULL_CMD" 1; then
  echo
  echo "RED — the full tier failed. Raw log: $LOG"
  echo "Fix the cause; never re-run until green, and never re-run to get a different answer."
  exit 1
fi

echo
report_peak
echo "GATE GREEN — both tiers passed. Raw log: $LOG"
exit 0
