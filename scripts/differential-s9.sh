#!/usr/bin/env bash
#
# differential-s9.sh — the S9 writer's OWN differential probe (one arm per pin).
#
# S9 is two features, and each arm below breaks ONE REAL rule at its source line.
# The named pin in the named suite must go RED on an otherwise-green tree.
#
# Each arm prints the target's sha256 BEFORE and AFTER (they must be identical
# after the restore) and restores from HEAD both immediately and in the ONE
# cleanup `trap`, so an interrupted run cannot leave an injected tree behind.
# HEAD must be the committed landing — `git checkout --` restores HEAD and would
# WIPE an uncommitted fix; commit first.
#
# The shared suite lock is held for the whole run so no second expensive check can
# run beside it. Exit 0 = every arm went RED as intended.
#
# Usage: bash scripts/differential-s9.sh   (from anywhere; paths are absolute)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
GIT_COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)"
LOCK_DIR="$(cd "$GIT_COMMON/.." && pwd)/.gate-lock"
LOG_DIR="$ROOT/.gate-logs/differential-s9"
mkdir -p "$LOG_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "REFUSED — the gate/suite lock is held ($LOCK_DIR). This run is VOID. Exit 9."
  exit 9
fi
printf 'pid=%s\nstarted=%s\ntier=differential-s9\ntree=%s\n' "$$" "$(date -u +%FT%TZ)" "$ROOT" \
  > "$LOCK_DIR/owner"

ENGINE="web/src/engine/GameEngine.ts"
BATTLE="web/src/engine/battle.ts"
LOBBY="web/src/net/lobby.ts"
TARGETS="$ENGINE $BATTLE $LOBBY"

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

# A · THE DEFECT ITSELF: a resigning player is NOT removed — the ending runs
#     WITHOUT them, so the board still holds every legion of a player who gave up
#     and the game does not end. This is the "reuse the ONE elimination ending"
#     property broken, and it is what "a player resigns and the game ends for two
#     players" pins.
run_arm "A-resigner-not-eliminated" "$BATTLE" "src/engine/__tests__/rules-resign.test.ts" \
  "s/if (!hasTitan || resigned?.has(player.id)) {/if (!hasTitan) {/" \
  "PIN 1: a player resigns OUTSIDE a battle and the game ends for two players" \
  || FAILED=1

# B · THE SCOPE BROKEN: the in-battle refusal is gone, so a player CAN give up
#     during a battle — the owner's "outside battles is enough" becomes "anywhere",
#     and the board is wrecked mid-battle.
run_arm "B-resign-allowed-in-battle" "$ENGINE" "src/engine/__tests__/rules-resign.test.ts" \
  "s/  if (state.battle \&\& !state.battle.done) {/  if (false) {/" \
  "PIN 3: giving up is REFUSED inside a battle, loudly, and changes NOTHING" \
  || FAILED=1

# C · THE ORDER BROKEN: the game RECORD is deleted FIRST, so a delete that dies
#     half way removes the game from the lobby and leaves invisible orphaned
#     snapshots — the exact failure the record-last rule exists to prevent.
run_arm "C-record-deleted-first" "$LOBBY" "src/net/__tests__/deleteGame.test.ts" \
  "s/  return \[...plan.snapshots.map((o) => o.name), ...plan.players.map((o) => o.name), plan.record\]/  return [plan.record, ...plan.snapshots.map((o) => o.name), ...plan.players.map((o) => o.name)]/" \
  "PIN 2: THE RECORD GOES LAST" || FAILED=1

# D · THE PARTICIPANT GUARD REMOVED: any game can be planned and deleted, whether
#     the caller was in it or not — the brief's "only games the caller was IN".
run_arm "D-any-game-deletable" "$LOBBY" "src/net/__tests__/deleteGame.test.ts" \
  "s/  assertCallerParticipated(players, ctx, gameId)/  void players; void ctx; void gameId/" \
  "PIN 5: a caller cannot delete a game they were NOT a participant in" \
  || FAILED=1

# E · THE PERMISSION REFUSAL MASKED: a `403` is reported as something other than a
#     refusal, so the app loses the ONE sentence that tells the owner what to do
#     (ask the operator to grant `delete`) — the measured blocker's whole point.
run_arm "E-403-not-recognised" "$LOBBY" "src/net/__tests__/deleteGame.test.ts" \
  "s/    this.forbidden = forbidden/    this.forbidden = false/" \
  "PIN 4: a \`403\` (the owner’s TODAY case) is LOUD" || FAILED=1

# F · THE RETRY RULE BROKEN: a `429`'s `Retry-After` is ignored by the retrier, so
#     a delete retries inside the window it was told to leave — the S5 property
#     this slice must not lose.
run_arm "F-retry-after-ignored" "web/src/net/requestRetry.ts" "src/net/__tests__/requestRetry.test.ts" \
  "s/    return retryDelayMs(error.retryAfterSeconds)/    return intervalMs/" \
  "obeys the store’s Retry-After instead of guessing" || FAILED=1

echo
echo "=================================================================="
echo "CONTROL: after every arm, the committed tree must be GREEN on all suites"
( cd "$WEB" && npx vitest run \
    src/engine/__tests__/rules-resign.test.ts \
    src/components/__tests__/giveUp.test.ts \
    src/net/__tests__/deleteGame.test.ts \
    src/net/__tests__/deleteLobbyUi.test.ts \
    src/net/__tests__/requestRetry.test.ts ) > "$LOG_DIR/control.log" 2>&1
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
