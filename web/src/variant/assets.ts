/** Asset URLs and resolution for Default variant graphics. */

const BASE = `${import.meta.env.BASE_URL}variants/Default/images`

/** Known files copied by convert-variant.mjs (filled at runtime from manifest). */
let available: Set<string> | null = null
let manifestPromise: Promise<void> | null = null

export async function loadAssetManifest(): Promise<void> {
  if (available) return
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}/manifest.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: string[]) => {
        available = new Set(list)
      })
      .catch(() => {
        available = new Set()
      })
  }
  await manifestPromise
}

function hasFile(name: string): boolean {
  // Until manifest loads, assume present (dev); after load, check strictly
  if (!available || available.size === 0) return true
  return available.has(name)
}

function pickExisting(...candidates: string[]): string {
  for (const name of candidates) {
    if (hasFile(name)) return `${BASE}/${encodeURIComponent(name)}`
  }
  // Last resort: Unknown.gif or a data-URI-free path that exists in Default
  if (hasFile('Unknown.gif')) return `${BASE}/Unknown.gif`
  return `${BASE}/${encodeURIComponent(candidates[0])}`
}

export function creatureImageUrl(creatureName: string): string {
  return pickExisting(`${creatureName}.gif`, `${creatureName}.png`, 'Unknown.gif')
}

/**
 * Terrain overlays: Colossus uses *_i for upright (non-inverted) hexes.
 * Fall back to the other orientation, then Unknown.
 */
export function terrainImageUrl(terrain: string, inverted: boolean): string {
  const primary = inverted ? `${terrain}.gif` : `${terrain}_i.gif`
  const secondary = inverted ? `${terrain}_i.gif` : `${terrain}.gif`
  return pickExisting(primary, secondary, 'Unknown.gif')
}

export function markerImageUrl(markerId: string): string {
  // Prefer zero-padded Colossus ids (Rd01); also try unpadded just in case
  const padded = markerId.replace(/^([A-Za-z]+)(\d)$/, (_, p, n) => `${p}0${n}`)
  const base = markerId.length >= 4 ? markerId.slice(0, 4) : markerId
  return pickExisting(
    `${base}.png`,
    `${base}.gif`,
    `${markerId}.png`,
    `${markerId}.gif`,
    `${padded}.png`,
    `${padded}.gif`,
    'Unknown.gif',
  )
}

/** Colossus Plain-{Color}Colossus fill from marker id prefix (Rd, Bu, …). */
export function markerPlainColor(markerId: string): string {
  const short = markerId.slice(0, 2)
  const known: Record<string, string> = {
    Rd: '#bd0018',
    Bu: '#10187b',
    Gr: '#18ad42',
    Gd: '#a59431',
    Bk: '#000000',
    Br: '#782828',
    Or: '#ff8415',
    Pu: '#cf06cf',
    Si: '#999999',
    Sk: '#87ceeb',
    Pi: '#228b22',
    In: '#4b0082',
  }
  return known[short] ?? '#666666'
}

export function hazardImageUrl(hazardName: string): string {
  return pickExisting(`${hazardName}_Hazard.gif`, 'Unknown.gif')
}

export const CREATURE_COLORS: Record<string, string> = {
  giantBlue: '#0303d5',
  hydraOrange: '#ff8415',
  behemothGreen: '#028102',
  centaurGold: '#818101',
  colossusPink: '#cf06cf',
  red: '#c00000',
  black: '#000000',
  ogreRed: '#800000',
}
