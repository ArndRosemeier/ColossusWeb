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
  list(store: string): Promise<StoreObject[]>
  get(store: string, name: string): Promise<GetResult>
  put(store: string, name: string, value: string): Promise<PutResult>
  remove(store: string, name: string): Promise<void>
  /** The identity of whoever currently holds the key. */
  whoami(): Promise<StoreIdentity>
}

/**
 * A failure, never a silent fallback. `code` is the service's own error code
 * (`not_found`, `unauthorized`, `forbidden`, `invalid_body`, `conflict`,
 * `payload_too_large`, …) so a caller can BRANCH on it; `message` is the
 * service's human text, surfaced verbatim.
 *
 * `transport_error` / `bad_response` are the two codes this client mints
 * itself, for a network failure and for a body that is not the expected shape.
 * A local refusal (an illegal object name) is `invalid_name` / `invalid_store`.
 */
export class ServerStoreError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'ServerStoreError'
    this.code = code
    this.status = status
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

export function assertObjectName(name: string): string {
  if (!OBJECT_NAME_PATTERN.test(name)) {
    throw new ServerStoreError(
      'invalid_name',
      `illegal object name ${JSON.stringify(name)}: want /${OBJECT_NAME_PATTERN.source}/`,
    )
  }
  return name
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
