export type TerrainMotionKind = 'grass' | 'sway' | 'shimmer' | 'heat'
export interface TerrainMotionProfile {
  terrain: string
  orientation: 'normal' | 'inverted'
  kind: TerrainMotionKind
  /** Source-square Y separating the illustration from its embedded label. */
  split: number
}

const KINDS: Readonly<Record<string, TerrainMotionKind>> = {
  Plains: 'grass', Brush: 'sway', Jungle: 'sway', Woods: 'sway',
  Marsh: 'shimmer', Swamp: 'shimmer', Desert: 'heat',
}

/** Crops are measured against the actual Default GIF bytes, not terrain names or
 * hex orientation. Unfamiliar artwork must remain static so its text cannot move.
 */
export function terrainMotionProfile(href: string): TerrainMotionProfile | null {
  const match = /(?:^|\/)variants\/Default\/images\/([A-Za-z]+)(_i)?\.gif$/.exec(href)
  if (!match || !Object.hasOwn(KINDS, match[1])) return null
  const orientation = match[2] ? 'inverted' : 'normal'
  return { terrain: match[1], orientation, kind: KINDS[match[1]], split: match[2] ? 0.66 : 0.37 }
}

/** xMidYMid slice maps a square source through max(width,height), not height.
 * Master hex boxes are wider than tall; the top/bottom of the square are cropped.
 */
export function terrainMotionSplit(width: number, height: number, sourceY: number): number {
  const side = Math.max(width, height)
  return Math.max(0, Math.min(height, (height - side) / 2 + side * sourceY))
}

/** Stable per-hex pacing: no random state, per-frame JS, or synchronized blanket pulse. */
export function terrainMotionTiming(hexLabel: string, terrain: string): { duration: string; delay: string } {
  let hash = 0
  for (const character of `${hexLabel}:${terrain}`) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
  return { duration: `${((68 + hash % 39) / 10).toFixed(1)}s`, delay: `${-(hash % 106) / 10}s` }
}
