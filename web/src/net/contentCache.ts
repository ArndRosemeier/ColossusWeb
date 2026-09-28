/**
 * The content-addressed BODY cache — the reason a poll tick that finds nothing
 * changed reads no bodies at all.
 *
 * ## The rule this exists for
 *
 * The store's list route returns `{name, sha256, size, createdAt}` for every
 * object, and `sha256` is a **content address**: the same name with the same
 * hash holds the same bytes. So a polling client does not need to fetch a body it
 * has already fetched. It remembers `{name -> sha256 -> value}` and reads a body
 * ONLY when the name is new or its hash CHANGED.
 *
 * That turns the steady state of a tick — nobody did anything — into **one list
 * request and zero body reads**, instead of re-reading every body it already
 * holds. (Measured before this: `sync.ts` re-read the newest snapshot body every
 * tick, and `lobby.ts` re-read every listed game's body every tick.)
 *
 * ## What it must never do
 *
 * This is a REQUEST-COUNT optimisation and nothing else. It must never change
 * WHAT is read in the sense of which object WINS:
 *
 *  - the cache is keyed by `(name, sha256)`, so a name whose content changed can
 *    never be served from an older entry;
 *  - {@link retain} DROPS every name that did not appear in the latest listing, so
 *    a deleted (or replaced-by-another-name) object cannot be resurrected;
 *  - {@link forget} drops one name outright (a caller that knows it is gone);
 *  - {@link clear} empties it, which is what a game's first snapshot does after a
 *    publish: a client that just WROTE state has nothing it can trust as "seen".
 *
 * Ordering, fork detection and the adoption rules are the callers' and are
 * untouched: this only decides whether a `get` is needed to have the bytes.
 *
 * ## Honest limit, recorded rather than hidden
 *
 * This shrinks the BODY reads, not the list itself. The list still returns every
 * object in the store, unpaginated, because that is all the service offers; a
 * `since=`/prefix filter is queued on the ServerStore side and is out of scope
 * here (`docs/design/multiplayer.md`).
 */

import type { ServerStoreTransport, StoreObject } from './transport'

interface CacheEntry {
  /** The content address the stored value belongs to. */
  readonly sha256: string
  readonly value: string
}

export class ContentCache {
  private readonly transport: ServerStoreTransport
  private readonly store: string
  private readonly entries = new Map<string, CacheEntry>()

  constructor(transport: ServerStoreTransport, store: string) {
    this.transport = transport
    this.store = store
  }

  /** The value this name held the LAST time it was read, or `null`. */
  peek(name: string): string | null {
    return this.entries.get(name)?.value ?? null
  }

  /** Whether this exact `(name, hash)` pair is already held — i.e. no read is needed. */
  holds(name: string, sha256: string): boolean {
    return this.entries.get(name)?.sha256 === sha256
  }

  /** Remember a value the caller obtained itself (a `put` response, say). */
  put(name: string, sha256: string, value: string): void {
    this.entries.set(name, { sha256, value })
  }

  /** Drop one name: the caller knows it is gone and must not be served from cache. */
  forget(name: string): void {
    this.entries.delete(name)
  }

  /** Forget everything. A client that just wrote state cannot trust "seen". */
  clear(): void {
    this.entries.clear()
  }

  /** How many bodies are held — a test's window on the steady state. */
  size(): number {
    return this.entries.size
  }

  /**
   * Bring the cache in line with a FRESH listing and return the names whose body
   * must now be read — new names, and names whose `sha256` CHANGED. Every name
   * that did not appear is DROPPED, and so is an entry whose hash moved, so a
   * deleted or overwritten object can never be served from the cache.
   */
  sync(objects: readonly StoreObject[]): string[] {
    const wanted = new Map(objects.map((object) => [object.name, object.sha256] as const))
    for (const [name, held] of [...this.entries]) {
      const sha256 = wanted.get(name)
      if (sha256 === undefined || sha256 !== held.sha256) this.entries.delete(name)
    }
    const changed: string[] = []
    for (const [name, sha256] of wanted) {
      if (!this.holds(name, sha256)) changed.push(name)
    }
    return changed
  }

  /** Drop every name NOT in `names` (a caller that listed only part of the store). */
  retain(names: Iterable<string>): void {
    const keep = new Set(names)
    for (const name of [...this.entries.keys()]) {
      if (!keep.has(name)) this.entries.delete(name)
    }
  }

  /** The body of `name` for the hash the LISTING reported, reading it by NAME only
   * when it is not already held. The value and its hash are verified against each
   * other after a read, so a store that returned the wrong bytes would be LOUD
   * rather than cached. */
  async adopt(name: string, sha256: string): Promise<string> {
    const held = this.entries.get(name)
    if (held !== undefined && held.sha256 === sha256) return held.value
    const result = await this.transport.get(this.store, name)
    if (result.sha256 !== sha256) {
      throw new Error(
        `${name}: the store returned body ${result.sha256} for listing hash ${sha256} — ` +
          `the listing and the body disagree, so the body is not cached`,
      )
    }
    this.entries.set(name, { sha256, value: result.value })
    return result.value
  }
}

/** Build a cache for one store and one identity. */
export function createContentCache(options: {
  transport: ServerStoreTransport
  store: string
}): ContentCache {
  return new ContentCache(options.transport, options.store)
}
