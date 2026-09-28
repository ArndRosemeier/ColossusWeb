/**
 * The HTTP implementation of {@link ServerStoreTransport}, against a live
 * ServerStore (`docs/design/multiplayer.md` §2.1; the route table is
 * `ServerStore/docs/API.md`).
 *
 * Two rules are structural here, not conventions:
 *  1. the key travels in the `Authorization: Bearer …` header and NOWHERE else
 *     — never a query string, never a path segment, never a body;
 *  2. the service's `{error:{code,message}}` envelope becomes a thrown
 *     {@link ServerStoreError} carrying both fields. A failure is never a
 *     silent fallback to empty data.
 */

import { getKey } from './keyStore'
import {
  ServerStoreError,
  assertObjectName,
  assertObjectPrefix,
  assertStoreName,
  type GetResult,
  type PutResult,
  type ServerStoreTransport,
  type StoreIdentity,
  type StoreObject,
} from './transport'

export const DEFAULT_BASE_URL = 'https://store.futuremagic.de'

/**
 * The base URL, env-overridable so a local or stubbed service can be pointed at
 * without a rebuild. Read at CONSTRUCTION time, not at import time, so a test
 * can set the variable before creating a transport.
 */
export function serverStoreBaseUrl(): string {
  const override =
    typeof import.meta === 'undefined' ? undefined : import.meta.env?.VITE_SERVERSTORE_URL
  return (override ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function requireFetch(): typeof fetch {
  const f = globalThis.fetch
  if (typeof f !== 'function') {
    throw new ServerStoreError(
      'transport_error',
      'no global fetch in this environment — the HTTP transport cannot run here',
    )
  }
  return f
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ServerStoreError('bad_response', `${what} is not an object`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new ServerStoreError('bad_response', `${what} is not a string`)
  }
  return value
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ServerStoreError('bad_response', `${what} is not a number`)
  }
  return value
}

function asStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ServerStoreError('bad_response', `${what} is not a string[]`)
  }
  return value as string[]
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ServerStoreError('bad_response', `${what} is not JSON`)
  }
}

/**
 * The `Retry-After` a response carries, as whole seconds — or `undefined` when
 * it carries none, or carries something this client cannot read as whole
 * seconds (HTTP allows an HTTP-date there; the store sends integer seconds, and
 * a value we do not understand must not be invented into a wait).
 *
 * This is THE ONLY reader of that header (`x-serverstore-sha256` is the only
 * other header read anywhere in the app, in {@link ServerStoreTransportHttp.get}),
 * so a `429`'s instruction has exactly one path to the caller.
 */
function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')
  if (raw === null) return undefined
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const seconds = Number(trimmed)
  return Number.isSafeInteger(seconds) ? seconds : undefined
}

/** Surface `{error:{code,message}}` with BOTH fields; fall back to the status text. */
function toError(response: Response, body: string): ServerStoreError {
  const retryAfter = retryAfterSeconds(response)
  try {
    const parsed = parseJson(body, 'error body')
    const envelope = asRecord(parsed, 'error envelope')['error']
    if (typeof envelope === 'object' && envelope !== null) {
      const record = envelope as Record<string, unknown>
      const code = record['code']
      const message = record['message']
      if (typeof code === 'string' && typeof message === 'string') {
        return new ServerStoreError(code, message, response.status, retryAfter)
      }
    }
  } catch {
    // Below: a failure to READ the failure is reported, never swallowed.
  }
  return new ServerStoreError(
    'bad_response',
    `HTTP ${response.status} ${response.statusText} without an error envelope: ${body.slice(0, 200)}`,
    response.status,
    retryAfter,
  )
}

function parseObject(body: string): PutResult {
  const record = asRecord(parseJson(body, 'object metadata'), 'object metadata')
  return {
    store: asString(record['store'], 'store'),
    name: asString(record['name'], 'name'),
    sha256: asString(record['sha256'], 'sha256'),
    size: asNumber(record['size'], 'size'),
    createdAt: asString(record['createdAt'], 'createdAt'),
  }
}

function parseObjectList(body: string): StoreObject[] {
  const record = asRecord(parseJson(body, 'object list'), 'object list')
  const objects = record['objects']
  if (!Array.isArray(objects)) {
    throw new ServerStoreError('bad_response', 'object list has no "objects" array')
  }
  return objects.map((entry, index) => {
    const item = asRecord(entry, `objects[${index}]`)
    return {
      store: asString(item['store'], `objects[${index}].store`),
      name: asString(item['name'], `objects[${index}].name`),
      sha256: asString(item['sha256'], `objects[${index}].sha256`),
      size: asNumber(item['size'], `objects[${index}].size`),
      createdAt: asString(item['createdAt'], `objects[${index}].createdAt`),
    }
  })
}

export function parseWhoami(body: string): StoreIdentity {
  const record = asRecord(parseJson(body, 'whoami'), 'whoami')
  return {
    id: asString(record['id'], 'id'),
    label: asString(record['label'], 'label'),
    stores: asStringArray(record['stores'], 'stores'),
    perms: asStringArray(record['perms'], 'perms'),
  }
}

export class ServerStoreTransportHttp implements ServerStoreTransport {
  readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(baseUrl: string = serverStoreBaseUrl(), fetchImpl?: typeof fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    // BOUND TO THE GLOBAL, and that is not decoration. A browser's `fetch` may only be
    // invoked with the global as its receiver: hold a reference on an object and call it
    // as `this.fetchImpl(...)` and the receiver becomes that object, which the platform
    // refuses with
    //   Failed to execute 'fetch' on 'Window': Illegal invocation
    // That is not hypothetical — it is what a real browser did the first time a real key
    // was entered, because every test until then supplied a receiver-insensitive stub.
    // Binding ONCE here, where the implementation is adopted, makes the receiver
    // irrelevant so no call site can reintroduce it. See the pin in serverStore.test.ts.
    this.fetchImpl = (fetchImpl ?? requireFetch()).bind(globalThis)
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  private async request(
    path: string,
    init: { method: string; body?: string; authorized?: boolean },
  ): Promise<Response> {
    const authorized = init.authorized ?? true
    // A real `Headers` instance, not a plain object: what the transport hands to
    // `fetch` is what a service (or a proxy) actually receives, so a header lost
    // anywhere between here and the wire is observable.
    const headers = new Headers()
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    if (authorized) {
      const key = getKey()
      if (key === null) {
        throw new ServerStoreError(
          'no_key',
          'no ServerStore key is loaded — connect before calling the store',
        )
      }
      // THE ONLY PLACE the key is ever put on the wire.
      headers.set('authorization', `Bearer ${key}`)
    }
    let response: Response
    try {
      response = await this.fetchImpl(this.url(path), {
        method: init.method,
        headers,
        body: init.body,
      })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      throw new ServerStoreError('transport_error', `request failed: ${detail}`)
    }
    if (!response.ok) throw toError(response, await response.text())
    return response
  }

  async list(store: string, prefix?: string): Promise<StoreObject[]> {
    assertStoreName(store)
    // Validated LOCALLY and before the request: the service answers `400
    // invalid_name` for an empty or uppercase prefix, and a client that could
    // not tell that apart from "no matches" would silently see an empty lobby.
    const query = prefix === undefined ? '' : `?prefix=${encodeURIComponent(assertObjectPrefix(prefix))}`
    const response = await this.request(
      `/stores/${encodeURIComponent(store)}/objects${query}`,
      { method: 'GET' },
    )
    return parseObjectList(await response.text())
  }

  async get(store: string, name: string): Promise<GetResult> {
    assertStoreName(store)
    assertObjectName(name)
    const response = await this.request(
      `/stores/${encodeURIComponent(store)}/objects/${encodeURIComponent(name)}`,
      { method: 'GET' },
    )
    return {
      value: await response.text(),
      sha256: response.headers.get('x-serverstore-sha256'),
    }
  }

  async put(store: string, name: string, value: string): Promise<PutResult> {
    assertStoreName(store)
    assertObjectName(name)
    const response = await this.request(
      `/stores/${encodeURIComponent(store)}/objects/${encodeURIComponent(name)}`,
      { method: 'PUT', body: value },
    )
    return parseObject(await response.text())
  }

  async remove(store: string, name: string): Promise<void> {
    assertStoreName(store)
    assertObjectName(name)
    await this.request(
      `/stores/${encodeURIComponent(store)}/objects/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    )
  }

  async whoami(): Promise<StoreIdentity> {
    const response = await this.request('/whoami', { method: 'GET' })
    return parseWhoami(await response.text())
  }
}

export function createServerStoreTransport(
  baseUrl?: string,
  fetchImpl?: typeof fetch,
): ServerStoreTransport {
  return new ServerStoreTransportHttp(baseUrl, fetchImpl)
}
