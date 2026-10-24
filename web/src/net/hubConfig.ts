/**
 * Where the game server is and which app this is — the ONE place it is decided.
 *
 * GameHub (`https://games.futuremagic.de`) is a relay: an app is registered once
 * on the box (as `colossusweb`), and its app key is shipped in the
 * bundle. The key is NOT a secret (the gameserver README says so: a browser game
 * has to ship it); it only names the game. So it comes from build-time env:
 *
 * | Variable | Default |
 * | --- | --- |
 * | `VITE_GAMEHUB_URL` | `https://games.futuremagic.de` |
 * | `VITE_GAMEHUB_APP` | `colossusweb` |
 * | `VITE_GAMEHUB_KEY` | set in `web/.env` (committed) |
 * | `VITE_GAMEHUB_ACCESS` | unset; `1` routes through Cloudflare Access instead of a key |
 *
 * A build with neither a key nor Access is a LOUD `hub_not_configured` the
 * moment online play is used — never a silent connection attempt that fails
 * with an unexplained `1006`.
 */

import { NetError } from './failure'

export interface HubConfig {
  readonly url: string
  readonly app: string
  readonly appKey?: string
  readonly access: boolean
}

export const DEFAULT_HUB_URL = 'https://games.futuremagic.de'
export const DEFAULT_HUB_APP = 'colossusweb'

type Env = Record<string, string | boolean | undefined>

export function hubConfigFrom(env: Env): HubConfig {
  const str = (name: string): string | undefined => {
    const value = env[name]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
  }
  const url = str('VITE_GAMEHUB_URL') ?? DEFAULT_HUB_URL
  const app = str('VITE_GAMEHUB_APP') ?? DEFAULT_HUB_APP
  const appKey = str('VITE_GAMEHUB_KEY')
  const access = str('VITE_GAMEHUB_ACCESS') === '1'
  if (!access && appKey === undefined) {
    throw new NetError(
      'hub_not_configured',
      `no GameHub app key for "${app}" — set VITE_GAMEHUB_KEY at build time (see web/.env)`,
    )
  }
  return access ? { url, app, access } : { url, app, appKey, access }
}

/** The build's configuration. Throws `hub_not_configured` when the build has no key. */
export function hubConfig(): HubConfig {
  return hubConfigFrom(import.meta.env as unknown as Env)
}
