/** Asset URLs and resolution for the active variant's graphics. */

let activeVariant = 'Default'
let base = `${import.meta.env.BASE_URL}variants/Default/images`

/** Known files copied by convert-variant.mjs (filled at runtime from manifest). */
let available: Set<string> | null = null
let manifestPromise: Promise<void> | null = null

export function setActiveVariant(name: string): void {
  if (activeVariant === name && available) return
  activeVariant = name
  base = `${import.meta.env.BASE_URL}variants/${encodeURIComponent(name)}/images`
  available = null
  manifestPromise = null
}

export function getActiveVariantName(): string {
  return activeVariant
}

export async function loadAssetManifest(variantName = activeVariant): Promise<void> {
  setActiveVariant(variantName)
  if (available) return
  if (!manifestPromise) {
    const url = `${base}/manifest.json`
    manifestPromise = fetch(url)
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
    if (hasFile(name)) return `${base}/${encodeURIComponent(name)}`
  }
  // Last resort: Unknown.gif or a data-URI-free path that exists in Default
  if (hasFile('Unknown.gif')) return `${base}/Unknown.gif`
  return `${base}/${encodeURIComponent(candidates[0])}`
}

export function creatureImageUrl(creatureName: string): string {
  return pickExisting(`${creatureName}.gif`, `${creatureName}.png`, 'Unknown.gif')
}

/**
 * Terrain overlays: Colossus uses *_i for upright (non-inverted) hexes.
 * Fall back to the other orientation. Prefer no image over Unknown/? so the
 * terrain color fill remains visible when art is missing.
 */
export function terrainImageUrl(terrain: string, inverted: boolean): string {
  const primary = inverted ? `${terrain}.gif` : `${terrain}_i.gif`
  const secondary = inverted ? `${terrain}_i.gif` : `${terrain}.gif`
  for (const name of [primary, secondary]) {
    if (hasFile(name)) return `${base}/${encodeURIComponent(name)}`
  }
  // Empty href — MasterBoardView still paints TERRAIN_COLORS underneath
  return ''
}

export function markerImageUrl(markerId: string): string {
  // Prefer zero-padded Colossus ids (Rd01); also try unpadded just in case
  const padded = markerId.replace(/^([A-Za-z]+)(\d)$/, (_, p, n) => `${p}0${n}`)
  const baseId = markerId.length >= 4 ? markerId.slice(0, 4) : markerId
  return pickExisting(
    `${baseId}.png`,
    `${baseId}.gif`,
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

/** True when a marker fill needs a light border (e.g. Black / dark Blue). */
export function isDarkMarkerFill(css: string): boolean {
  const hex = css.replace('#', '')
  if (hex.length !== 6) return false
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return r + g + b < 200
}

export function hazardImageUrl(hazardName: string): string {
  const name = `${hazardName}_Hazard.gif`
  if (hasFile(name)) return `${base}/${encodeURIComponent(name)}`
  // No Tower_Hazard (etc.) — leave fill color visible; never Unknown/?
  return ''
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
