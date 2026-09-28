#!/usr/bin/env bash
#
# differential.sh — the project's OWN differential probe (the writers', not the gate's).
#
# ONE ARM PER PIN. S1's arms inject a REAL behaviour change by mocking ONE module
# boundary from a scratch vitest setup file — no source file is edited, so the
# tree cannot be left dirty and the arm is repeatable. Each arm PRINTS the sha256
# of the module it replaces before and after, so two arms can never be confused.
#
# S2's arms (appended below, one per lobby rule) inject into the REAL source line,
# because the rule under test lives INSIDE a module rather than at a boundary:
# `run_source_arm` edits the file, prints its sha256 before and after, and
# restores it from HEAD immediately — and again in `cleanup`, so an interrupted
# run cannot leave an injected tree behind. Run after the landing is committed:
# HEAD is then the exact tree under test.
#
# The shared suite lock (the same atomic mkdir the gate uses) is held for the
# whole run, because each arm runs real vitest. Scratch files are removed in a
# `trap`, and the tree status is printed at the end.
#
# Two mistakes this script encodes so they cannot recur:
#   1. the scratch vitest config must live INSIDE web/ (otherwise `vitest/config`
#      cannot resolve and every arm "fails" at config load — a VOID probe);
#   2. a `vi.mock` path in a setup file is resolved from THE SETUP FILE's
#      directory, so it must be written `../src/net/<module>` — not `../../…`.
#   3. in a sed REPLACEMENT, `&` means THE WHOLE MATCH: an arm injecting a
#      literal `&&` must write `\&\&`, or the replacement duplicates the match
#      and the injected file is a PARSE error. vitest then reports "no tests",
#      which the harness correctly calls VOID, not RED — a probe bug, not a
#      finding. (S3's arm R was run once with this bug; the log is kept.)
#
# Usage: bash differential.sh            (from anywhere; paths are absolute)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
GIT_COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)"
LOCK_DIR="$(cd "$GIT_COMMON/.." && pwd)/.gate-lock"
LOG_DIR="$ROOT/.gate-logs/differential"
SETUPS="$WEB/.differential-setups"
mkdir -p "$LOG_DIR" "$SETUPS"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "REFUSED — the gate/suite lock is held ($LOCK_DIR). This run is VOID. Exit 9."
  exit 9
fi
printf 'pid=%s\nstarted=%s\ntier=differential\ntree=%s\n' "$$" "$(date -u +%FT%TZ)" "$ROOT" \
  > "$LOCK_DIR/owner"

# S2's arms inject a REAL rule break into a source file, so the target list is
# held here and restored from HEAD by the ONE cleanup trap: an interrupted run
# cannot leave an injected tree behind. (HEAD is the committed landing, so the
# restore target IS the tree under test, byte-for-byte.) S3's arms edit two more
# files, so their targets are in the SAME list.
S2_TARGETS="web/src/net/lobby.ts web/src/net/gameRecord.ts"
S3_TARGETS="web/src/net/snapshot.ts web/src/net/sync.ts web/src/net/lobby.ts"
S4_TARGETS="web/src/net/lobbyWatcher.ts web/src/net/contentCache.ts"
SOURCE_TARGETS="$S2_TARGETS $S3_TARGETS $S4_TARGETS"

cleanup() {
  rm -rf "$SETUPS" "$WEB/.differential.vitest.config.ts" "$LOCK_DIR"
  # The redirecting test files live beside the real ones so the suite's
  # `include` matches them; they must never outlive the run.
  rm -f "$WEB"/src/net/__tests__/*.redirect.test.ts
  for target in $SOURCE_TARGETS; do
    git -C "$ROOT" checkout -- "$target" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

hash_of() { sha256sum "$1" | cut -d' ' -f1; }

# The base config is web/vite.config.ts; this restates its `test` block exactly
# and adds only `setupFiles`, so a differential arm runs the SAME suite.
cat > "$WEB/.differential.vitest.config.ts" <<'CFG'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/sim/**'],
    disableConsoleIntercept: true,
    setupFiles: ['./.differential-setups/active.setup.ts'],
  },
})
CFG

# run_arm <arm> <suite> <target-file> <pin> <setup-body-file>
run_arm() {
  local arm="$1" suite="$2" target="$3" pin="$4" body_file="$5"
  local file="$WEB/$target" setup="$SETUPS/active.setup.ts"
  local before after rc passed failed

  echo
  echo "=================================================================="
  echo "ARM $arm"
  echo "  pin under test : $pin"
  echo "  target module  : $target"
  before="$(hash_of "$file")"
  cp "$body_file" "$setup"
  echo "  target BEFORE  : $before"
  echo "  injected setup : $(hash_of "$setup")"
  echo "  suite          : $suite"

  ( cd "$WEB" && npx vitest run --config "$WEB/.differential.vitest.config.ts" $suite ) \
    > "$LOG_DIR/$arm.log" 2>&1
  rc=$?
  passed="$(grep -m1 -E '^ +Tests +' "$LOG_DIR/$arm.log" | sed 's/^ *//' || true)"
  failed="$(grep -E '^ *× ' "$LOG_DIR/$arm.log" | sed 's/^ *× //' | head -8 || true)"
  echo "  vitest exit    : $rc"
  echo "  tests          : ${passed:-<none — the suite did not run>}"
  if [ -n "$failed" ]; then
    printf '  RED            : %s\n' "$failed"
  fi

  after="$(hash_of "$file")"
  echo "  target AFTER   : $after $([ "$before" = "$after" ] && echo '(unchanged — correct)' || echo '(CHANGED — BUG IN THE PROBE)')"
  rm -f "$setup"

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
  echo "  VERDICT        : RED as intended."
  return 0
}

# run_source_arm <arm> <suite> <target-file> <sed-expression> <pin>
#
# The S2 rules live INSIDE a module (a guard in `lobby.ts`, a cap in
# `gameRecord.ts`), so breaking them at a module boundary would prove the wrong
# thing. This arm edits the REAL line, prints the target's sha256 before and
# after, and restores it from HEAD immediately — and again in `cleanup`.
run_source_arm() {
  local arm="$1" suite="$2" target="$3" sed_expr="$4" pin="$5"
  # `target` is REPO-relative (that is what `git checkout --` needs); the file is
  # edited at its absolute path under the worktree.
  local file="$ROOT/$target"
  local before after rc passed failed

  echo
  echo "=================================================================="
  echo "ARM $arm"
  echo "  pin under test : $pin"
  echo "  target module  : $target"
  before="$(hash_of "$file")"
  echo "  target BEFORE  : $before"

  # The shared differential config points at this file, so it must exist; this
  # arm needs no module mock because it edits the source itself.
  printf '// no mock: this arm edits %s itself\n' "$target" > "$SETUPS/active.setup.ts"
  if ! sed -i "$sed_expr" "$file"; then
    echo "  VERDICT        : VOID — sed did not apply."
    git -C "$ROOT" checkout -- "$target"
    return 1
  fi
  echo "  injected hash  : $(hash_of "$file")"

  ( cd "$WEB" && npx vitest run --config "$WEB/.differential.vitest.config.ts" $suite ) \
    > "$LOG_DIR/$arm.log" 2>&1
  rc=$?
  git -C "$ROOT" checkout -- "$target"

  passed="$(grep -m1 -E '^ +Tests +' "$LOG_DIR/$arm.log" | sed 's/^ *//' || true)"
  failed="$(grep -E '^ *× ' "$LOG_DIR/$arm.log" | sed 's/^ *× //' | head -8 || true)"
  echo "  vitest exit    : $rc"
  echo "  tests          : ${passed:-<none — the suite did not run>}"
  if [ -n "$failed" ]; then
    printf '  RED            : %s\n' "$failed"
  fi
  after="$(hash_of "$file")"
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

# ---------------------------------------------------------------------------
# A · the key does NOT travel in the Authorization header
cat > "$SETUPS/A.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION: the transport builds the Authorization header and then LOSES it —
// the credential never reaches the wire. `getKey()` hands back a key (so this is
// not the separate "no key loaded" path, which refuses before any request), and a
// marked key makes the transport's own `fetch` drop the header on the way out.
// The fake store refuses what it RECEIVES, exactly as the real key guard does.
vi.mock('../src/net/keyStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/keyStore')>()
  return {
    ...real,
    getKey: () => 'ssk_MARKER_STRIP_HEADER',
    installKey: () => undefined,
  }
})
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  if (headers.get('authorization')?.includes('MARKER_STRIP_HEADER')) {
    headers.delete('authorization')
  }
  return realFetch(input, { ...init, headers })
}) as typeof fetch
EOF
run_arm "A-header" "src/net/__tests__/serverStore.test.ts" \
  "src/net/keyStore.ts" \
  "the key-travels-only-in-the-Authorization-header pin (a credential that never arrives is refused)" \
  "$SETUPS/A.setup.ts" || FAILED=1

# ---------------------------------------------------------------------------
# B · the key IS allowed to reach the URL
cat > "$SETUPS/B.setup.ts" <<'EOF'
import { vi } from 'vitest'
import { getKey } from '../src/net/keyStore'

// INJECTION: every request URL carries the key in its query string.
vi.mock('../src/net/serverStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/serverStore')>()
  const proto = real.ServerStoreTransportHttp.prototype as unknown as {
    request: (path: string, init: { method: string }) => Promise<Response>
  }
  const original = proto.request
  proto.request = function (path: string, init: { method: string }) {
    const key = getKey()
    return original.call(this, key === null ? path : `${path}?key=${key}`, init)
  }
  return real
})
EOF
run_arm "B-key-in-url" "src/net/__tests__/serverStore.test.ts" \
  "src/net/serverStore.ts" \
  "the same pin from the other side: a key in the query string is refused" \
  "$SETUPS/B.setup.ts" || FAILED=1

# ---------------------------------------------------------------------------
# C · the failure loses its code and its message
cat > "$SETUPS/C.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION: ServerStoreError is replaced by a plain Error — the service's code
// and message are both gone, so the caller cannot branch and the screen cannot
// say what happened.
vi.mock('../src/net/transport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/transport')>()
  class SilentError extends Error {
    readonly code = undefined
    readonly status = null
  }
  return { ...real, ServerStoreError: SilentError }
})
EOF
run_arm "C-errors-silent" "src/net/__tests__/transportContract.test.ts src/net/__tests__/serverStore.test.ts src/net/__tests__/failure.test.ts" \
  "src/net/transport.ts" \
  "a failure is never silent: BOTH code and message must reach the caller" \
  "$SETUPS/C.setup.ts" || FAILED=1

# ---------------------------------------------------------------------------
# D · an illegal object name is no longer refused locally
cat > "$SETUPS/D.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION: the local name guard always passes, so an illegal name reaches the
// wire instead of being refused before any request is made.
vi.mock('../src/net/transport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/transport')>()
  return { ...real, assertObjectName: (name: string) => name }
})
EOF
run_arm "D-no-local-guard" "src/net/__tests__/transportContract.test.ts" \
  "src/net/transport.ts" \
  "an illegal object name is refused locally, before any request is made" \
  "$SETUPS/D.setup.ts" || FAILED=1

# ---------------------------------------------------------------------------
# E · the owner's persistence rules (2026-09-28), three ways to break them.
#
# A setup-file `vi.mock` replaces the module the code UNDER TEST imports
# internally (measured: mocking `keyStorage` makes the real `connect()` call the
# mock). It cannot replace the test file's own import, which is why each arm
# breaks a module BELOW the seam the test drives.
cat > "$SETUPS/E1.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION: installing the key ALSO writes it to sessionStorage — a second
// copy, which the rule forbids.
vi.mock('../src/net/keyStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/keyStore')>()
  return {
    ...real,
    installKey(next: string) {
      real.installKey(next)
      globalThis.sessionStorage?.setItem('colossusweb.key.v1', next)
    },
  }
})
EOF
run_arm "E1-second-copy" "src/net/__tests__/keyPersistence.test.ts" \
  "src/net/keyStore.ts" \
  "the key is stored ONLY in localStorage — never sessionStorage, a cookie, the URL or history" \
  "$SETUPS/E1.setup.ts" || FAILED=1

cat > "$SETUPS/E2.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION, the real timing break: `installKey` persists the key AT ONCE —
// before `whoami` has had anything to say about it. This is the failure the
// owner's "immediately reject it if it does not work. Otherwise store it" rule
// forbids, and it is what a `writeStoredKey` moved above the `await
// transport.whoami()` line would ship.
vi.mock('../src/net/keyStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/keyStore')>()
  const storage = await vi.importActual<typeof import('../src/net/keyStorage')>(
    '../src/net/keyStorage',
  )
  return {
    ...real,
    installKey(next: string) {
      real.installKey(next)
      storage.writeStoredKey(next.trim())
    },
  }
})
EOF
cat > "$SETUPS/E3.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION: nothing is ever removed from storage, so a stored key that fails
// re-validation is KEPT — the "never continue with an unvalidated key" break.
vi.mock('../src/net/keyStorage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/keyStorage')>()
  return { ...real, clearStoredKey: () => undefined }
})
EOF
run_arm "E2-persist-timing" "src/net/__tests__/keyPersistence.test.ts" \
  "src/net/keyStore.ts" \
  "an INVALID key is never persisted — validation strictly precedes persistence" \
  "$SETUPS/E2.setup.ts" || FAILED=1

run_arm "E3-stale-key-kept" "src/net/__tests__/keyPersistence.test.ts" \
  "src/net/keyStorage.ts" \
  "a stored key that no longer validates is REMOVED from storage" \
  "$SETUPS/E3.setup.ts" || FAILED=1

# ---------------------------------------------------------------------------
# F · whoami() returns key material
cat > "$SETUPS/F.setup.ts" <<'EOF'
import { vi } from 'vitest'
import { getKey } from '../src/net/keyStore'

// INJECTION: whoami's identity carries the raw key — the pin forbids it.
vi.mock('../src/net/serverStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/serverStore')>()
  const proto = real.ServerStoreTransportHttp.prototype as unknown as {
    whoami: () => Promise<Record<string, unknown>>
  }
  const original = proto.whoami
  proto.whoami = async function () {
    const identity = (await original.call(this)) as Record<string, unknown>
    return { ...identity, key: getKey() }
  }
  return real
})
EOF
run_arm "F-whoami-leaks" "src/net/__tests__/transportContract.test.ts" \
  "src/net/serverStore.ts" \
  "whoami() never returns key material" \
  "$SETUPS/F.setup.ts" || FAILED=1
# ---------------------------------------------------------------------------
# G · the x-serverstore-sha256 response header is dropped
cat > "$SETUPS/G.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION: the integrity header the service sets is not surfaced.
vi.mock('../src/net/serverStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/serverStore')>()
  const proto = real.ServerStoreTransportHttp.prototype as unknown as {
    request: (path: string, init: { method: string }) => Promise<Response>
  }
  const original = proto.request
  proto.request = async function (path: string, init: { method: string }) {
    const response = await original.call(this, path, init)
    if (init.method === 'GET' && path.includes('/objects/')) {
      return new Response(await response.text(), {
        status: response.status,
        headers: { 'content-type': 'application/octet-stream' },
      })
    }
    return response
  }
  return real
})
EOF
run_arm "G-sha-header-dropped" "src/net/__tests__/transportContract.test.ts src/net/__tests__/serverStore.test.ts" \
  "src/net/serverStore.ts" \
  "the x-serverstore-sha256 response header is surfaced when present" \
  "$SETUPS/G.setup.ts" || FAILED=1

# ---------------------------------------------------------------------------
# H · the in-memory fake is not a faithful double (list always empty)
cat > "$SETUPS/H.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION: the fake's list() always returns nothing — the thin-stub failure
// the "one contract, two implementations" pin exists to catch.
vi.mock('../src/net/memoryTransport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/memoryTransport')>()
  return {
    ...real,
    createMemoryTransport(options: Parameters<typeof real.createMemoryTransport>[0]) {
      const transport = real.createMemoryTransport(options)
      transport.list = async () => []
      return transport
    },
  }
})
EOF
run_arm "H-twin-diverges" "src/net/__tests__/transportContract.test.ts" \
  "src/net/memoryTransport.ts" \
  "one contract, two implementations (the fake must obey it too)" \
  "$SETUPS/H.setup.ts" || FAILED=1

# ---------------------------------------------------------------------------
# I · the base URL is hard-coded, ignoring configuration
cat > "$SETUPS/I.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION: the base URL is no longer read from configuration.
vi.mock('../src/net/serverStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/serverStore')>()
  return { ...real, serverStoreBaseUrl: () => 'https://wrong.example.test' }
})
EOF
run_arm "I-base-hardcoded" "src/net/__tests__/serverStore.test.ts" \
  "src/net/serverStore.ts" \
  "the base URL is configured (env-overridable), not hard-coded" \
  "$SETUPS/I.setup.ts" || FAILED=1

# ---------------------------------------------------------------------------
# J · an empty body is accepted instead of refused
cat > "$SETUPS/J.setup.ts" <<'EOF'
import { vi } from 'vitest'

// INJECTION: the empty-body refusal is removed — a PUT of nothing now succeeds,
// which is the silent-write the service (and the fake) must not allow.
vi.mock('../src/net/transport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/transport')>()
  return real
})
vi.mock('../src/net/memoryTransport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/net/memoryTransport')>()
  const original = real.MemoryTransport.prototype.put
  real.MemoryTransport.prototype.put = async function (store, name, value) {
    if (value.length === 0) value = '{}'
    return original.call(this, store, name, value)
  }
  return real
})
EOF
run_arm "J-empty-body-accepted" "src/net/__tests__/memoryTransport.test.ts" \
  "src/net/memoryTransport.ts" \
  "an empty body is refused, as the service refuses it" \
  "$SETUPS/J.setup.ts" || FAILED=1

# ---------------------------------------------------------------------------
# S2 · the lobby lifecycle — five rules, each broken at the line that enforces it.

# L · Start is NOT the creator's alone.
run_source_arm "L-start-not-creator" "src/net/__tests__/lobby.test.ts" \
  "web/src/net/lobby.ts" \
  "s/if (record.creator.id !== identity.id) {/if (identity.id === '__nobody__') {/" \
  "Start is refused for a non-creator, and writes NOTHING" || FAILED=1

# M · Joining twice is no longer idempotent: the second join writes again.
run_source_arm "M-join-not-idempotent" "src/net/__tests__/lobby.test.ts" \
  "web/src/net/lobby.ts" \
  "s/if (mine) {/if (mine \&\& false) {/" \
  "joining twice is idempotent: one object, unchanged body, no second write" || FAILED=1

# N · Discovery SILENTLY DROPS a game it cannot read.
run_source_arm "N-unreadable-dropped" "src/net/__tests__/lobby.test.ts" \
  "web/src/net/lobby.ts" \
  "s/unreadable.push({ objectName: object.name, gameId, failure: describeFailure(error) })/void error/" \
  "Discovery ignores non-game objects and surfaces an unreadable game record" || FAILED=1

# O · The slug is not capped, so a long display name overflows the name budget.
run_source_arm "O-slug-not-capped" "src/net/__tests__/gameRecord.test.ts" \
  "web/src/net/gameRecord.ts" \
  "s/\.slice(0, MAX_GAME_SLUG_LENGTH)/.slice(0, 5000)/" \
  "the LONGEST legal display name still names both objects legally" || FAILED=1

# P · The caller's KEY is smuggled into the game body.
run_source_arm "P-key-in-body" "src/net/__tests__/lobby.test.ts" \
  "web/src/net/lobby.ts" \
  "s|creator: { id: ctx.identity.id, label: ctx.identity.label },|creator: { id: ctx.identity.id, label: ctx.identity.label, secret: (await import('./keyStore')).getKey() },|" \
  "no object body and no request body ever contains key material" || FAILED=1

# ---------------------------------------------------------------------------
# S3 · turn sync — one arm per pin, each breaking a REAL rule at its line.

# Q · The publish counter is NOT seeded from the parent: two snapshots in one
#     turn collide on the same (turn, seq) and the first is silently overwritten.
run_source_arm "Q-seq-not-seeded" "src/net/__tests__/sync.test.ts" \
  "web/src/net/sync.ts" \
  "s|tracker.turn === turn ? tracker.seq + 1 : 0|tracker.turn === turn ? 0 : 0|" \
  "a local command publishes exactly ONE snapshot named for its turn/seq; UI-only commands publish none" || FAILED=1

# R · A state with a physical throw pending IS published, so another client
#     adopts a half-thrown game and can commit it with the rng.
#     (`\&\&` — in a sed replacement a bare `&` is the whole match.)
run_source_arm "R-publish-pending-throw" "src/net/__tests__/sync.test.ts" \
  "web/src/net/sync.ts" \
  "s|&& !next.pendingDice|\&\& true|" \
  "a state with a pending throw is NOT published until the throw is committed" || FAILED=1

# S · Adoption RESETS the local selection instead of preserving it.
run_source_arm "S-adopt-resets-ui" "src/net/__tests__/sync.test.ts" \
  "web/src/net/sync.ts" \
  "s|next.selectedLegionId = selected|next.selectedLegionId = null|" \
  "a remote snapshot is adopted and the local UI-only fields survive" || FAILED=1

# T · A fork is never detected, so a race is silently resolved.
run_source_arm "T-fork-silent" "src/net/__tests__/sync.test.ts" \
  "web/src/net/snapshot.ts" \
  "s|if (group.length < 2) return null|if (group.length < 999) return null|" \
  "two writers at the same (turn, seq) produce two names; the fork is surfaced" || FAILED=1

# U · The fields are NOT zero-padded, so the name stops being the ordering.
run_source_arm "U-name-not-padded" "src/net/__tests__/snapshot.test.ts" \
  "web/src/net/snapshot.ts" \
  "s|String(value).padStart(digits, '0')|String(value)|" \
  "sorts names into state order, padded, across a turn boundary and at the seq ceiling" || FAILED=1

# V · Turn authority ignores an engagement, so the defender can never flee.
run_source_arm "V-no-engagement-authority" "src/net/__tests__/sync.test.ts" \
  "web/src/net/sync.ts" \
  "s|if (state.activeEngagement && state.phase === 'Fight') {|if (false) {|" \
  "enables only the active seat, and follows a battle, a throw and a reinforcement" || FAILED=1

# W · The poll loop ignores visibility and hammers a hidden tab.
run_source_arm "W-poll-hidden" "src/net/__tests__/sync.test.ts" \
  "web/src/net/sync.ts" \
  "s|if (!visibility.visible()) {|if (false) {|" \
  "polls while visible, makes NO request while hidden, and stops when torn down" || FAILED=1

# X · The caller's KEY is smuggled into the snapshot body.
run_source_arm "X-key-in-snapshot" "src/net/__tests__/sync.test.ts" \
  "web/src/net/sync.ts" \
  "s|state: serializeGame(state),|state: { ...serializeGame(state), key: (await import('./keyStore')).getKey() },|" \
  "a published body contains no key material and no key-shaped field" || FAILED=1

# Y · Start writes the seat order in JOIN order, so two clients disagree on seats.
run_source_arm "Y-seats-in-join-order" "src/net/__tests__/lobby.test.ts" \
  "web/src/net/lobby.ts" \
  "s|seatOrder: seatOrderFor(record.creator.id, players),|seatOrder: players.map((player) => player.playerId),|" \
  "Start writes the explicit seat order: creator first, then the joined by tag" || FAILED=1

# ---------------------------------------------------------------------------
# S4 · the lobby is LIVE — one arm per pin, each breaking a REAL rule at its line.

# Z · The poll tick SWALLOWS its failure: the loop counts a failed read as a
#     healthy one, so the backoff never engages and the panel's error state is
#     never the loop's.
run_source_arm "Z-poll-swallows-error" "src/net/__tests__/lobbyWatcher.test.ts" \
  "web/src/net/lobbyWatcher.ts" \
  "s|^        throw error$|        // INJECTION: the failure is swallowed|" \
  "backs off on a failed poll, says so, and recovers on the next success" || FAILED=1

# Z2 · The lobby takes the list TWICE per tick (its own, plus the one the games
#      read takes), so a tick is two requests instead of one.
run_source_arm "Z2-two-lists-a-tick" "src/net/__tests__/lobbyWatcher.test.ts" \
  "web/src/net/lobbyWatcher.ts" \
  "s|const listing = await listGamesFrom(this.context, objects, this.cache)|const listing = await listGames(this.context, this.cache)|" \
  "makes exactly ONE list request per tick, while the tab is visible" || FAILED=1

# Z3 · The body cache never reports a change, so a tick that changed nothing
#      reads the body anyway — the steady state costs a read again.
run_source_arm "Z3-cache-always-changed" "src/net/__tests__/bodyReadCache.test.ts" \
  "web/src/net/contentCache.ts" \
  "s|if (!this.holds(name, sha256)) changed.push(name)|if (true) changed.push(name)|" \
  "a tick that finds nothing changed makes ONE request and reads NO body" || FAILED=1

# Z4 · A name whose content CHANGED is kept in the cache (the hash is ignored),
#      so an overwritten body could be served from an older address.
run_source_arm "Z4-stale-cache-entry" "src/net/__tests__/bodyReadCache.test.ts" \
  "web/src/net/contentCache.ts" \
  "s|if (sha256 === undefined \\|\\| sha256 !== held.sha256) this.entries.delete(name)|if (sha256 === undefined) this.entries.delete(name)|" \
  "a name whose content changed is re-read, never served from the old hash" || FAILED=1

# Z5 · The snapshot job stops using the cache, so it re-reads the newest body on
#      every tick even when it holds exactly those bytes.
run_source_arm "Z5-snapshot-cache-bypassed" "src/net/__tests__/bodyReadCache.test.ts" \
  "web/src/net/sync.ts" \
  "s|        cache: session.cache,|        cache: undefined,|" \
  "a poll tick whose newest snapshot is unchanged reads NO body" || FAILED=1

# Z6 · The lobby ignores the visibility rule and polls a hidden tab.
run_source_arm "Z6-lobby-polls-hidden" "src/net/__tests__/lobbyWatcher.test.ts" \
  "web/src/net/sync.ts" \
  "s|    if (!visibility.visible()) {|    if (false) {|" \
  "makes NO request while the tab is hidden, and one immediately on return" || FAILED=1

# Z7 · A listed body is read by a GUESSED name instead of the name the listing
#      gave, which is exactly how the list route becomes a content read.
run_source_arm "Z7-body-read-by-guess" "src/net/__tests__/bodyReadCache.test.ts" \
  "web/src/net/lobby.ts" \
  "s|        ? await cache.adopt(object.name, object.sha256)|        ? await cache.adopt(object.name + '.guess', object.sha256)|" \
  "reads ONLY the body that changed, and every read is by a name the listing gave" || FAILED=1

# Z8 · The external store's subscription is a NO-OP until a watcher exists, so
#      React never hears about a tick's data — the defect a real browser caught.
run_source_arm "Z8-store-subscribe-noop" "src/net/__tests__/lobbyWatcher.test.ts" \
  "web/src/net/lobbyWatcher.ts" \
  "s|    this.listeners.add(listener)|    if (this.watcher === null) { return () => {} }\n    this.listeners.add(listener)|" \
  "tells a listener that subscribed BEFORE the watcher existed about every tick" || FAILED=1

# Z9 · A replaced watcher is detached but NOT closed, so its loop keeps polling a
#      list nobody renders (the orphaned-loop failure mode).
run_source_arm "Z9-replaced-loop-orphaned" "src/net/__tests__/lobbyWatcher.test.ts" \
  "web/src/net/lobbyWatcher.ts" \
  "s|    this.clear()$|    this.detach?.()|" \
  "CLOSES a watcher it replaces, so no orphaned loop keeps polling" || FAILED=1

echo
echo "=================================================================="
echo "arms done — FAILED=$FAILED (0 means every arm went RED as intended)"
echo "raw logs: $LOG_DIR/*.log"
git -C "$ROOT" status --porcelain web/src | sed 's/^/tree: /'
exit $FAILED
