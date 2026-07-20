/**
 * Battleland hex graph + hazard helpers (Colossus BattleHex / HazardHexside).
 */
import type { BattleHexDef, BattlelandDef, CreatureType } from '../types/variant'

export type HexsideHazard = 'nothing' | 'dune' | 'cliff' | 'slope' | 'tower' | 'river'

export const IMPASSABLE_COST = 99
const NORMAL_COST = 1
const SLOW_COST = 2
const SLOW_INCREMENT = 1

const HAZARD_BY_CODE: Record<string, HexsideHazard> = {
  ' ': 'nothing',
  d: 'dune',
  c: 'cliff',
  s: 'slope',
  w: 'tower',
  r: 'river',
}

/** Terrains that block ground / LOS / slow (simplified Colossus HazardTerrain flags). */
const BLOCKS_GROUND = new Set(['Lake', 'Stone', 'Tree'])
const BLOCKS_LOS = new Set(['Tree', 'Stone'])
const SLOWS_NON_NATIVE = new Set(['Brambles', 'Drift', 'Bog', 'Sand', 'Volcano'])
const GROUND_NATIVE_ONLY = new Set(['Bog', 'Volcano'])

export interface BuiltBattleHex {
  label: string
  x: number
  y: number
  terrain: string
  elevation: number
  /** Hazard on this hex's side i (higher hex marks slopes/walls). */
  hexsides: HexsideHazard[]
  neighbors: (string | null)[]
}

export interface BuiltBattleland {
  terrain: string
  tower: boolean
  hexByLabel: Record<string, BuiltBattleHex>
  labels: string[]
  startlist: string[]
  /** Entrance labels by side name */
  entrances: Record<'Bottom' | 'Left' | 'Right' | 'Top', string[]>
}

function createLabel(x: number, y: number): string {
  if (x < 0) return `X${y}`
  const yLabel = 6 - y - Math.abs(Math.trunc((x - 3) / 2))
  return `${String.fromCharCode(65 + x)}${yLabel}`
}

/** Odd-column neighbor deltas matching Colossus battle hex orientation. */
function neighborDeltas(x: number): [number, number][] {
  const odd = x & 1
  return odd
    ? [
        [0, -1],
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
        [-1, 0],
      ]
    : [
        [0, -1],
        [1, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
        [-1, -1],
      ]
}

function isNativeIn(creature: CreatureType, terrain: string): boolean {
  return Boolean(creature.native[terrain] || creature.native[terrain.toLowerCase()])
}

export function buildBattleland(def: BattlelandDef): BuiltBattleland {
  const byXY = new Map<string, BattleHexDef>()
  for (const h of def.hexes) byXY.set(`${h.x},${h.y}`, h)

  // Ensure full A–F grid of plains where XML only overrides hazards
  const hexByLabel: Record<string, BuiltBattleHex> = {}
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 6; y++) {
      if ((x === 0 || x === 5) && (y === 0 || y === 5)) continue
      const key = `${x},${y}`
      const raw = byXY.get(key)
      const label = raw?.label ?? createLabel(x, y)
      const hexsides: HexsideHazard[] = Array.from({ length: 6 }, () => 'nothing')
      for (const b of raw?.borders ?? []) {
        if (b.number >= 0 && b.number <= 5) {
          hexsides[b.number] = HAZARD_BY_CODE[b.type] ?? 'nothing'
        }
      }
      hexByLabel[label] = {
        label,
        x,
        y,
        terrain: raw?.terrain ?? 'Plains',
        elevation: raw?.elevation ?? 0,
        hexsides,
        neighbors: [null, null, null, null, null, null],
      }
    }
  }

  const byCoord = new Map<string, string>()
  for (const h of Object.values(hexByLabel)) byCoord.set(`${h.x},${h.y}`, h.label)

  for (const h of Object.values(hexByLabel)) {
    const deltas = neighborDeltas(h.x)
    for (let i = 0; i < 6; i++) {
      const [dx, dy] = deltas[i]
      const n = byCoord.get(`${h.x + dx},${h.y + dy}`)
      h.neighbors[i] = n ?? null
    }
  }

  const entrances = {
    Bottom: ['C1', 'D1', 'B1', 'E1'].filter((l) => hexByLabel[l]),
    Top: ['C5', 'D5', 'B4', 'E4'].filter((l) => hexByLabel[l]),
    Left: ['A1', 'A2', 'A3'].filter((l) => hexByLabel[l]),
    Right: ['F1', 'F2', 'F3', 'F4'].filter((l) => hexByLabel[l]),
  }

  // Fallback if label scheme misses
  if (entrances.Bottom.length === 0) {
    const bottom = Object.values(hexByLabel)
      .filter((h) => h.y >= 4)
      .sort((a, b) => a.x - b.x)
      .map((h) => h.label)
    entrances.Bottom = bottom.slice(0, 4)
  }

  return {
    terrain: def.terrain,
    tower: def.tower,
    hexByLabel,
    labels: Object.keys(hexByLabel),
    startlist: def.startlist.length ? def.startlist : Object.values(hexByLabel).filter((h) => h.terrain === 'Tower' || h.elevation > 0).map((h) => h.label).slice(0, 7),
    entrances,
  }
}

export function oppositeHazard(land: BuiltBattleland, hex: BuiltBattleHex, side: number): HexsideHazard {
  const nLabel = hex.neighbors[side]
  if (!nLabel) return 'nothing'
  const n = land.hexByLabel[nLabel]
  return n?.hexsides[(side + 3) % 6] ?? 'nothing'
}

export function getEntryCost(
  land: BuiltBattleland,
  hex: BuiltBattleHex,
  creature: CreatureType,
  cameFrom: number,
): number {
  let cost = NORMAL_COST
  const native = isNativeIn(creature, hex.terrain)

  if (BLOCKS_GROUND.has(hex.terrain) || (GROUND_NATIVE_ONLY.has(hex.terrain) && !native)) {
    return IMPASSABLE_COST
  }

  const hazard = cameFrom >= 0 ? hex.hexsides[cameFrom] : 'nothing'
  const opp = cameFrom >= 0 ? oppositeHazard(land, hex, cameFrom) : 'nothing'

  if ((hazard === 'cliff' || opp === 'cliff') && !creature.flies) {
    return IMPASSABLE_COST
  }

  if ((hazard === 'river' || opp === 'river') && !creature.flies && !native) {
    cost += SLOW_INCREMENT
  }

  const neighbor = cameFrom >= 0 ? land.hexByLabel[hex.neighbors[cameFrom] ?? ''] : undefined
  if (
    (hazard === 'tower' || (hazard === 'slope' && !creature.native.slope)) &&
    !creature.flies &&
    neighbor &&
    hex.elevation > neighbor.elevation
  ) {
    cost += SLOW_INCREMENT
  }

  if (SLOWS_NON_NATIVE.has(hex.terrain) && !native) {
    cost += SLOW_INCREMENT
  }

  if (cost > IMPASSABLE_COST) cost = IMPASSABLE_COST
  if (cost < IMPASSABLE_COST && cost > SLOW_COST) cost = SLOW_COST
  return cost
}

export function canFlyOver(hex: BuiltBattleHex, creature: CreatureType): boolean {
  if (!creature.flies) return false
  if (hex.terrain === 'Volcano' && !isNativeIn(creature, 'Volcano')) return false
  return true
}

export function blocksLOS(hex: BuiltBattleHex): boolean {
  return BLOCKS_LOS.has(hex.terrain)
}

export function battleNeighbors(land: BuiltBattleland, label: string): string[] {
  const hex = land.hexByLabel[label]
  if (!hex) return []
  return hex.neighbors.filter((n): n is string => n != null)
}
