#!/usr/bin/env bash
#
# differential.sh — S1's OWN differential probe (the writer's, not the gate's).
#
# ONE ARM PER PIN. Each arm injects a REAL behaviour change by mocking ONE module
# boundary from a scratch vitest setup file — no source file is edited, so the
# tree cannot be left dirty and the arm is repeatable. Each arm PRINTS the sha256
# of the module it replaces before and after, so two arms can never be confused.
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

cleanup() {
  rm -rf "$SETUPS" "$WEB/.differential.vitest.config.ts" "$LOCK_DIR"
  # The redirecting test files live beside the real ones so the suite's
  # `include` matches them; they must never outlive the run.
  rm -f "$WEB"/src/net/__tests__/*.redirect.test.ts
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

echo
echo "=================================================================="
echo "arms done — FAILED=$FAILED (0 means every arm went RED as intended)"
echo "raw logs: $LOG_DIR/*.log"
git -C "$ROOT" status --porcelain web/src | sed 's/^/tree: /'
exit $FAILED
