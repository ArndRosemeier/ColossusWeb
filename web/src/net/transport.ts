/**
 * The transport seam — the ONLY way anything above this directory talks to a
 * ServerStore. Nothing above it imports `fetch`.
 *
 * The store is a flat namespace of opaque byte objects, addressed by
 * `(store, name)`. The store name is deliberately a PARAMETER and never a
 * constant here: it keeps this seam honest and leaves room to partition into
 * more stores later without re-plumbing callers. (Per-player stores were
 * considered and DECLINED by the owner as unnecessary security — see
 * `docs/design/multiplayer.md` §4.4 and §6; this is not an open fork.)
 *
 * Plain data in, plain data out. A failure is always a thrown
 * {@link ServerStoreError} carrying the service's own `code` and `message`.
 */

/** A key's identity as `GET /whoami` reports it. Never contains key material. */
export interface StoreIdentity {
  id: string
  label: string
  stores: string[]
  perms: string[]
}

/** One object as the list route reports it (`sha256` is the content address). */
export interface StoreObject {
  store: string
  name: string
  sha256: string
  size: number
  createdAt: string
}

/** `PUT` / a single `GET` response: the object's content address and size. */
export interface PutResult {
  store: string
  name: string
  sha256: string
  size: number
  createdAt: string
}

/** The result of a `GET`: the bytes plus the service's own integrity address. */
export interface GetResult {
  value: string
  /** `x-serverstore-sha256` when the service sent it; `null` when it did not. */
  sha256: string | null
}

export interface ServerStoreTransport {
  /**
   * The objects in a store, in the store's own (name) order.
   *
   * `prefix` is the service's own `?prefix=` filter (S5): only names that START
   * WITH it are returned. Omitted, the whole store is returned — which is what
   * every caller did before the filter existed, so this stays backward
   * compatible. The prefix obeys the SAME rule as a name
   * ({@link OBJECT_PREFIX_PATTERN}) and is validated HERE, once, so both
   * implementations refuse an illegal prefix locally, identically, and BEFORE
   * any request is made — the service answers `400 invalid_name` for an empty or
   * uppercase one, and a prefix matching nothing is a `200` with an empty list.
   */
  list(store: string, prefix?: string): Promise<StoreObject[]>
  get(store: string, name: string): Promise<GetResult>
  put(store: string, name: string, value: string): Promise<PutResult>
  remove(store: string, name: string): Promise<void>
  /** The identity of whoever currently holds the key. */
  whoami(): Promise<StoreIdentity>
}

/**
 * The service's error `code` for a request refused by its own rate limiter
 * (`429`, with a `Retry-After` header). Named here because it is a code the
 * client BRANCHES on — the poll loop must wait the header out instead of using
 * its doubling backoff — and a bare string in two modules would be the seam this
 * file exists to prevent.
 */
export const RATE_LIMITED_CODE = 'rate_limited'

/**
 * A failure, never a silent fallback. `code` is the service's own error code
 * (`not_found`, `unauthorized`, `forbidden`, `invalid_body`, `conflict`,
 * `payload_too_large`, …) so a caller can BRANCH on it; `message` is the
 * service's human text, surfaced verbatim.
 *
 * `transport_error` / `bad_response` are the two codes this client mints
 * itself, for a network failure and for a body that is not the expected shape.
 * A local refusal (an illegal object name) is `invalid_name` / `invalid_store`.
 *
 * `retryAfterSeconds` is set ONLY from a `Retry-After` response header (whole
 * seconds, `>= 0`) — today that means a `429 rate_limited`. It is the
 * service's own instruction and the caller obeys it rather than guessing, which
 * is why it rides on the error instead of being folded into the message text.
 */
export class ServerStoreError extends Error {
  readonly code: string
  readonly status: number | null
  readonly retryAfterSeconds?: number

  constructor(
    code: string,
    message: string,
    status: number | null = null,
    retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'ServerStoreError'
    this.code = code
    this.status = status
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds
    // `target: es2023` downlevels a class `extends Error` to ES5 semantics only
    // for older targets; this explicit restore keeps `instanceof` honest anyway.
    Object.setPrototypeOf(this, ServerStoreError.prototype)
  }
}

/**
 * The service's rule for object names: `[a-z0-9][a-z0-9._-]{0,63}` — 1–64
 * characters, no directories, lowercase. Validated HERE, once, so both
 * implementations refuse an illegal name locally and identically instead of
 * letting the server answer `400`.
 */
export const OBJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** The service's rule for store names (`API.md`), as the client validates it. */
export const STORE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

/**
 * The service's rule for a LISTING PREFIX, validated locally so an illegal one
 * is refused before a request is made. It is the name rule verbatim
 * (`src/core/validate.ts`: `parseObjectPrefix` calls the same `parseName`), and
 * it is a separate constant only so a reader can see WHY a prefix is legal:
 * `game.` and `player.abc-1234.` pass, `GAME.` and the empty string do not.
 */
export const OBJECT_PREFIX_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function assertObjectName(name: string): string {
  if (!OBJECT_NAME_PATTERN.test(name)) {
    throw new ServerStoreError(
      'invalid_name',
      `illegal object name ${JSON.stringify(name)}: want /${OBJECT_NAME_PATTERN.source}/`,
    )
  }
  return name
}

/**
 * Refuse an illegal listing prefix LOCALLY, with the same code and the same
 * shape of message the local name guard uses, so a caller gets one behaviour
 * from both transports and the service never sees a request it would answer
 * `400 invalid_name` (which would silently return nothing if we mistook it for
 * "no matches").
 */
export function assertObjectPrefix(prefix: string): string {
  if (!OBJECT_PREFIX_PATTERN.test(prefix)) {
    throw new ServerStoreError(
      'invalid_name',
      `illegal object prefix ${JSON.stringify(prefix)}: want /${OBJECT_PREFIX_PATTERN.source}/`,
    )
  }
  return prefix
}

export function assertStoreName(store: string): string {
  if (!STORE_NAME_PATTERN.test(store)) {
    throw new ServerStoreError(
      'invalid_store',
      `illegal store name ${JSON.stringify(store)}: want /${STORE_NAME_PATTERN.source}/`,
    )
  }
  return store
}
