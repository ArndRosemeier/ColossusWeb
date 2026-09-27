/**
 * WHICH store the lobby talks to — the ONE place the store name is decided.
 *
 * `docs/design/multiplayer.md` §5.2 settled on a single shared `colossus` store
 * filtered client-side by name prefix, and the transport keeps the store name a
 * PARAMETER (never a constant) so that decision stays reversible without
 * re-plumbing a caller (`transport.ts`). This module is what supplies that
 * parameter: one default, one env override, read at CALL time so a test can set
 * it before the value is used — exactly the shape `serverStoreBaseUrl()` already
 * has in `serverStore.ts`.
 *
 * Nothing else in the lobby may write the literal `'colossus'`: grep this file
 * and you have found every place the store's name comes from.
 */

/** The store the game objects live in. The owner's store, verified to exist. */
export const DEFAULT_STORE_NAME = 'colossus'

/** The ONE env override, mirroring `VITE_SERVERSTORE_URL`. */
export const STORE_NAME_ENV_VAR = 'VITE_SERVERSTORE_STORE'

/**
 * The configured store name. `undefined` in a non-Vite context (a plain Node
 * test) means "no override", never "empty store" — the transport validates the
 * result, so an illegal override fails loudly instead of silently.
 */
export function serverStoreName(): string {
  const override =
    typeof import.meta === 'undefined' ? undefined : import.meta.env?.VITE_SERVERSTORE_STORE
  return override ?? DEFAULT_STORE_NAME
}
