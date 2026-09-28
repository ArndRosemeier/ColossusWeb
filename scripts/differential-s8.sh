#!/usr/bin/env bash
#
# differential-s8.sh — the S8 writer's OWN differential probe (one arm per pin).
#
# S8's defect was that ONE command started a battle unilaterally, so the
# defender's window never opened. The fix put the rule at ONE seam — the guard
# inside `startBattleFromEngagement` — and made the OVERLAY answer the seat
# question. Every arm below restores one of those broken behaviours by editing
# the REAL source line; the named pin in the named suite must go RED.
#
# Each arm prints the target's sha256 BEFORE and AFTER (they must be identical
# after the restore) and restores from HEAD both immediately and in the ONE
# cleanup `trap`, so an interrupted run cannot leave an injected tree behind.
# HEAD must be the committed landing — `git checkout --` restores HEAD and would
# WIPE an uncommitted fix; commit first.
#
# The shared suite lock is held for the whole run so no second expensive check
# can run beside it. Exit 0 = every arm went RED as intended.
#
# Usage: bash scripts/differential-s8.sh   (from anywhere; paths are absolute)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
GIT_COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)"
LOCK_DIR="$(cd "$GIT_COMMON/.." && pwd)/.gate-lock"
LOG_DIR="$ROOT/.gate-logs/differential-s8"
mkdir -p "$LOG_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "REFUSED — the gate/suite lock is held ($LOCK_DIR). This run is VOID. Exit 9."
  exit 9
fi
printf 'pid=%s\nstarted=%s\ntier=differential-s8\ntree=%s\n' "$$" "$(date -u +%FT%TZ)" "$ROOT" \
  > "$LOCK_DIR/owner"

ENGINE="web/src/engine/GameEngine.ts"
ENGINE_SUITE="src/engine/__tests__/rules-engagement-choice.test.ts"
OVERLAY="web/src/components/BoardDecisionOverlay.tsx"
OVERLAY_SUITE="src/components/__tests__/engagementChoice.test.ts"
TARGETS="$ENGINE $OVERLAY"

cleanup() {
  git -C "$ROOT" checkout -- $TARGETS 2>/dev/null || true
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

hash_of() { sha256sum "$ROOT/$1" | cut -d' ' -f1; }

# run_arm <arm> <target> <suite> <sed-expression> <pin>
run_arm() {
  local arm="$1" target="$2" suite="$3" sed_expr="$4" pin="$5"
  local file="$ROOT/$target"
  local before after rc passed failed

  echo
  echo "=================================================================="
  echo "ARM $arm"
  echo "  pin under test : $pin"
  echo "  target module  : $target"
  before="$(hash_of "$target")"
  echo "  target BEFORE  : $before"

  if ! sed -i "$sed_expr" "$file"; then
    echo "  VERDICT        : VOID — sed did not apply."
    git -C "$ROOT" checkout -- "$target"
    return 1
  fi
  echo "  injected hash  : $(hash_of "$target")"

  ( cd "$WEB" && npx vitest run "$suite" ) > "$LOG_DIR/$arm.log" 2>&1
  rc=$?
  git -C "$ROOT" checkout -- "$target"

  passed="$(grep -m1 -E '^ +Tests +' "$LOG_DIR/$arm.log" | sed 's/^ *//' || true)"
  failed="$(grep -E '^ *× ' "$LOG_DIR/$arm.log" | sed 's/^ *× //' | head -8 || true)"
  echo "  vitest exit    : $rc"
  echo "  tests          : ${passed:-<none — the suite did not run>}"
  if [ -n "$failed" ]; then
    printf '  RED            : %s\n' "$failed"
  fi
  after="$(hash_of "$target")"
  echo "  target AFTER   : $after $([ "$before" = "$after" ] && echo '(restored from HEAD — correct)' || echo '(CHANGED — BUG IN THE PROBE)')"

  if grep -qE "Startup Error|failed to load config|No test files found|no tests" "$LOG_DIR/$arm.log"; then
    echo "  VERDICT        : VOID — vitest never ran the suite (config/selection failure)."
    return 1
  fi
  if [ "$rc" = "0" ]; then
    echo "  VERDICT        : VOID — the suite stayed GREEN, so this arm proves nothing."
    return 1
  fi
  if [ -z "$failed" ]; then
    echo "  VERDICT        : VOID — vitest failed without naming a failing test."
    return 1
  fi
  if [ "$after" != "$before" ]; then
    echo "  VERDICT        : VOID — the target was not restored; the tree is dirty."
    return 1
  fi
  echo "  VERDICT        : RED as intended."
  return 0
}

FAILED=0

# A · THE DEFECT ITSELF: the guard is gone, so the attacker's demand starts the
#     battle while the defender's window is still open — the owner's bug, which
#     is exactly what "an engagement does NOT start a battle on the attacker's
#     command alone" pins.
run_arm "A-unilateral-battle-start" "$ENGINE" "$ENGINE_SUITE" \
  "s/if (!canStartBattleFromEngagement(state)) {/if (false) {/" \
  "PIN 1: an engagement does NOT start a battle on the attacker command alone" \
  || FAILED=1

# B · THE WINDOW NEVER OPENS: the offer is created already declined, so the
#     defender has no window to be asked in. This is the same owner-visible bug
#     reached from the other side (no waiting state, immediate battle).
run_arm "B-window-never-opens" "$ENGINE" "$ENGINE_SUITE" \
  "s/fleeDeclined: !canFlee(state, defender),/fleeDeclined: true,/" \
  "PIN 3: in a two-human game the state says the window is WAITING" \
  || FAILED=1

# C · THE STALL: the defender's own answer never closes the window, so no battle
#     can ever start — the "hotseat must stay completable" pin.
run_arm "C-defender-answer-ignored" "$ENGINE" "$ENGINE_SUITE" \
  "s/^      eng.fleeDeclined = true$/      eng.fleeDeclined = eng.fleeDeclined/" \
  "PIN 4: a hotseat two-human game can still complete an engagement in one sitting" \
  || FAILED=1

# D · THE STOLEN BUTTON: the overlay offers the attacker the battle button while
#     the defender's window is open — the UI half of the owner's bug.
run_arm "D-attacker-button-while-waiting" "$OVERLAY" "$OVERLAY_SUITE" \
  "s/{!waitingForDefender \&\& atkIsMe \&\& (/{atkIsMe \&\& (/" \
  "the ATTACKER's client shows it is WAITING and offers no way past the defender" \
  || FAILED=1

echo
echo "=================================================================="
echo "CONTROL: after every arm, the committed tree must be GREEN on both suites"
( cd "$WEB" && npx vitest run "$ENGINE_SUITE" "$OVERLAY_SUITE" ) > "$LOG_DIR/control.log" 2>&1
CONTROL_RC=$?
grep -m1 -E '^ +Tests +' "$LOG_DIR/control.log" | sed 's/^ *//' | sed 's/^/  control tests  : /'
if [ "$CONTROL_RC" != "0" ]; then
  echo "  VERDICT        : INVALID — the committed tree is not green; the arms prove nothing."
  FAILED=1
else
  echo "  VERDICT        : GREEN on the committed tree — the arms' REDs are the injection."
fi

echo
echo "arms done — FAILED=$FAILED (0 means every arm went RED as intended)"
echo "raw logs: $LOG_DIR/*.log"
git -C "$ROOT" status --porcelain $TARGETS | sed 's/^/tree: /'
exit $FAILED
