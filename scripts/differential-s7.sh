#!/usr/bin/env bash
#
# differential-s7.sh — the S7 writer's OWN differential probe (one arm per pin).
#
# S7's defect was a UI seam, not a module boundary: the board PAINTED one set of
# fields while the click gate ACCEPTED (and on a miss, silently DESELECTED) a
# different one. The fix moved that decision into ONE pure module,
# `web/src/ui/boardInteraction.ts`, so the arm that restores the defect injects
# into that module — the exact seam the fix created — and the named pins in
# `web/src/ui/__tests__/boardInteraction.test.ts` must go RED.
#
# Every arm edits the REAL source line, prints the target's sha256 BEFORE and
# AFTER (they must be identical after the restore), and restores from HEAD both
# immediately and in the ONE cleanup `trap`, so an interrupted run cannot leave
# an injected tree behind. HEAD must be the committed landing — `git checkout --`
# restores HEAD and would WIPE an uncommitted fix; commit first.
#
# The shared suite lock is held for the whole run so no second expensive check
# can run beside it. Exit 0 = every arm went RED as intended.
#
# Usage: bash scripts/differential-s7.sh   (from anywhere; paths are absolute)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
GIT_COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)"
LOCK_DIR="$(cd "$GIT_COMMON/.." && pwd)/.gate-lock"
LOG_DIR="$ROOT/.gate-logs/differential-s7"
TARGET="web/src/ui/boardInteraction.ts"
SUITE="src/ui/__tests__/boardInteraction.test.ts"
mkdir -p "$LOG_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "REFUSED — the gate/suite lock is held ($LOCK_DIR). This run is VOID. Exit 9."
  exit 9
fi
printf 'pid=%s\nstarted=%s\ntier=differential-s7\ntree=%s\n' "$$" "$(date -u +%FT%TZ)" "$ROOT" \
  > "$LOCK_DIR/owner"

cleanup() {
  git -C "$ROOT" checkout -- "$TARGET" 2>/dev/null || true
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

hash_of() { sha256sum "$ROOT/$1" | cut -d' ' -f1; }

# run_arm <arm> <sed-expression> <pin>
run_arm() {
  local arm="$1" sed_expr="$2" pin="$3"
  local file="$ROOT/$TARGET"
  local before after rc passed failed

  echo
  echo "=================================================================="
  echo "ARM $arm"
  echo "  pin under test : $pin"
  echo "  target module  : $TARGET"
  before="$(hash_of "$TARGET")"
  echo "  target BEFORE  : $before"

  if ! sed -i "$sed_expr" "$file"; then
    echo "  VERDICT        : VOID — sed did not apply."
    git -C "$ROOT" checkout -- "$TARGET"
    return 1
  fi
  echo "  injected hash  : $(hash_of "$TARGET")"

  ( cd "$WEB" && npx vitest run "$SUITE" ) > "$LOG_DIR/$arm.log" 2>&1
  rc=$?
  git -C "$ROOT" checkout -- "$TARGET"

  passed="$(grep -m1 -E '^ +Tests +' "$LOG_DIR/$arm.log" | sed 's/^ *//' || true)"
  failed="$(grep -E '^ *× ' "$LOG_DIR/$arm.log" | sed 's/^ *× //' | head -8 || true)"
  echo "  vitest exit    : $rc"
  echo "  tests          : ${passed:-<none — the suite did not run>}"
  if [ -n "$failed" ]; then
    printf '  RED            : %s\n' "$failed"
  fi
  after="$(hash_of "$TARGET")"
  echo "  target AFTER   : $after $([ "$before" = "$after" ] && echo '(restored from HEAD — correct)' || echo '(CHANGED — BUG IN THE PROBE)')"

  if grep -qE "Startup Error|failed to load config|No test files found" "$LOG_DIR/$arm.log"; then
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

# A · THE DEFECT ITSELF: a click on a painted PREVIEW field falls through to the
#     deselect gesture — the owner's silent deselection, restored.
run_arm "A-silent-deselect" "s/if (preview.has(label)) {/if (false) {/" \
  "opponent legion selected: the preview is painted, NO legal field is, and a preview click is refused" \
  || FAILED=1

# B · THE UNGATED PAINT: the board ignores `canAct`, so a client that may not act
#     still paints actionable fields (the secondary spectator bug of the brief).
run_arm "B-ungated-paint" "s/if (!canAct || selected === null) {/if (selected === null) {/" \
  "a client that may not act paints NO actionable field, and a click surfaces a reason" \
  || FAILED=1

echo
echo "=================================================================="
echo "arms done — FAILED=$FAILED (0 means every arm went RED as intended)"
echo "raw logs: $LOG_DIR/*.log"
git -C "$ROOT" status --porcelain "$TARGET" | sed 's/^/tree: /'
exit $FAILED
