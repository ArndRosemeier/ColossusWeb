/** Tactical terrain names come from BuiltBattleHex, never the masterboard theme. */
export const BATTLE_SURFACES: Readonly<Record<string, { top: string; bottom: string; accent: string }>> = {
  Plains: { top: '#81805a', bottom: '#505a40', accent: '#d0cf94' },
  Brambles: { top: '#547158', bottom: '#2f4c39', accent: '#a7c58b' },
  Bog: { top: '#76684a', bottom: '#484b36', accent: '#c9b782' },
  Sand: { top: '#ad925d', bottom: '#78623d', accent: '#f0d69a' },
  Drift: { top: '#a4bcc6', bottom: '#648493', accent: '#e2f1f0' },
  Volcano: { top: '#815754', bottom: '#4e3437', accent: '#f2ab78' },
  Lake: { top: '#547e92', bottom: '#2f526a', accent: '#abd9e6' },
  Tree: { top: '#4d6b4b', bottom: '#293f31', accent: '#b1c98b' },
  Tower: { top: '#83909a', bottom: '#4e606f', accent: '#d6dfdf' },
  Stone: { top: '#858483', bottom: '#535e62', accent: '#d1d2c7' },
}

export const BATTLE_HAZARD_ART = ['Brambles', 'Bog', 'Sand', 'Drift', 'Volcano', 'Lake', 'Tree', 'Stone'] as const

export function battleHazardUrl(terrain: string): string | null {
  if (!(BATTLE_HAZARD_ART as readonly string[]).includes(terrain)) return null
  return `${import.meta.env.BASE_URL}board-art/hazards-v1/${terrain}.png`
}

function lift(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const channels = [16, 8, 0].map(shift => Math.min(255, ((n >> shift) & 255) + amount))
  return `#${channels.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

/** Height adds light to the same material; it never changes tactical terrain. */
export function battleSurface(terrain: string, elevation: number) {
  const material = BATTLE_SURFACES[terrain] ?? { top: '#73765c', bottom: '#465143', accent: '#ced0ae' }
  const height = Math.max(0, Math.min(3, elevation))
  return { ...material, top: lift(material.top, height * 10), bottom: lift(material.bottom, height * 7) }
}

export type BattleVertex = [number, number]

/** Own-hex inward normal is essential: the opposite side may carry another hazard. */
export function battleEdgeGeometry(vertices: BattleVertex[], side: number) {
  if (vertices.length !== 6 || !Number.isInteger(side) || side < 0 || side > 5) throw Error('Invalid battle hexside geometry')
  const a = vertices[side], b = vertices[(side + 1) % 6]
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
  if (length === 0) throw Error('Degenerate battle hexside')
  const midX = (a[0] + b[0]) / 2, midY = (a[1] + b[1]) / 2
  const centerX = vertices.reduce((sum, p) => sum + p[0], 0) / 6
  const centerY = vertices.reduce((sum, p) => sum + p[1], 0) / 6
  const normalLength = Math.hypot(centerX - midX, centerY - midY)
  return { a, b, dx, dy, length, ux: dx / length, uy: dy / length,
    nx: (centerX - midX) / normalLength, ny: (centerY - midY) / normalLength }
}
