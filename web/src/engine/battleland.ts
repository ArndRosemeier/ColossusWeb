/**
 * Battleland hex graph + hazard helpers (Colossus BattleHex / HazardHexside / HexMap).
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

/** Colossus HexMap.VISIBLE_HEXES — true battle map is a hexagon (27 hexes). */
export const VISIBLE_HEXES: boolean[][] = [
  [false, false, true, true, true, false],
  [false, true, true, true, true, false],
  [false, true, true, true, true, true],
  [true, true, true, true, true, true],
  [false, true, true, true, true, true],
  [false, true, true, true, true, false],
]

/**
 * Landing hexes adjacent to each entrance (Colossus MasterBoardTerrain.setupEntrances).
 * Odd indices = attacker sides (4 hexes); even = defender sides (3 hexes).
 * Order matches EntrySide: TopDefense, Right, RightDefense, Bottom, LeftDefense, Left.
 */
const ENTRANCE_LANDINGS: string[][] = [
  ['D6', 'E5', 'F4'], // 0 Top defense
  ['F4', 'F3', 'F2', 'F1'], // 1 Right
  ['F1', 'E1', 'D1'], // 2 Right defense
  ['D1', 'C1', 'B1', 'A1'], // 3 Bottom
  ['A1', 'A2', 'A3'], // 4 Left defense
  ['A3', 'B4', 'C5', 'D6'], // 5 Left
]

/** Terrains that block ground / LOS / slow (simplified Colossus HazardTerrain flags). */
const BLOCKS_GROUND = new Set(['Lake', 'Stone', 'Tree'])
const BLOCKS_LOS = new Set(['Tree', 'Stone'])
const SLOWS_NON_NATIVE = new Set(['Brambles', 'Drift', 'Bog', 'Sand', 'Volcano'])
const GROUND_NATIVE_ONLY = new Set(['Bog', 'Volcano'])

export type BattleEntryKey =
  | 'Bottom'
  | 'Left'
  | 'Right'
  | 'Top'
  | 'LeftDefense'
  | 'RightDefense'

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
  /** Landing hexes by entry side (attacker uses Bottom/Left/Right; defender uses opposites). */
  entrances: Record<BattleEntryKey, string[]>
}

/** Java-style integer division toward zero for label math. */
function idiv(a: number, b: number): number {
  return Math.trunc(a / b)
}

function createLabel(x: number, y: number): string {
  if (x < 0) return `X${y}`
  const yLabel = 6 - y - Math.abs(idiv(x - 3, 2))
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

export { isNativeIn }

/** Hexside index from `from` toward adjacent `to`, or -1. */
export function directionBetween(land: BuiltBattleland, from: string, to: string): number {
  const hex = land.hexByLabel[from]
  if (!hex) return -1
  return hex.neighbors.findIndex((n) => n === to)
}

export function buildBattleland(def: BattlelandDef): BuiltBattleland {
  const byXY = new Map<string, BattleHexDef>()
  for (const h of def.hexes) byXY.set(`${h.x},${h.y}`, h)

  const hexByLabel: Record<string, BuiltBattleHex> = {}
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 6; y++) {
      if (!VISIBLE_HEXES[x]![y]) continue
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
      const [dx, dy] = deltas[i]!
      const n = byCoord.get(`${h.x + dx},${h.y + dy}`)
      h.neighbors[i] = n ?? null
    }
  }

  const filterExisting = (labels: string[]) => labels.filter((l) => hexByLabel[l])

  const entrances: Record<BattleEntryKey, string[]> = {
    Top: filterExisting(ENTRANCE_LANDINGS[0]!),
    Right: filterExisting(ENTRANCE_LANDINGS[1]!),
    RightDefense: filterExisting(ENTRANCE_LANDINGS[2]!),
    Bottom: filterExisting(ENTRANCE_LANDINGS[3]!),
    LeftDefense: filterExisting(ENTRANCE_LANDINGS[4]!),
    Left: filterExisting(ENTRANCE_LANDINGS[5]!),
  }

  return {
    terrain: def.terrain,
    tower: def.tower,
    hexByLabel,
    labels: Object.keys(hexByLabel),
    startlist: def.startlist.length
      ? def.startlist
      : Object.values(hexByLabel)
          .filter((h) => h.terrain === 'Tower' || h.elevation > 0)
          .map((h) => h.label)
          .slice(0, 7),
    entrances,
  }
}

/** Defender sits opposite the attacker's entry (Colossus EntrySide.getOpposingSide). */
export function defenderEntryKey(attackerSide: 'Left' | 'Right' | 'Bottom'): BattleEntryKey {
  if (attackerSide === 'Bottom') return 'Top'
  if (attackerSide === 'Left') return 'RightDefense'
  return 'LeftDefense'
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
  void SLOW_COST
  void land
  return cost
}

export function canFlyOver(hex: BuiltBattleHex, creature: CreatureType): boolean {
  if (hex.terrain === 'Volcano' && !isNativeIn(creature, 'Volcano')) return false
  return true
}

export function battleNeighbors(land: BuiltBattleland, label: string): string[] {
  const hex = land.hexByLabel[label]
  if (!hex) return []
  return hex.neighbors.filter((n): n is string => n != null)
}

export function blocksLOS(hex: BuiltBattleHex): boolean {
  return BLOCKS_LOS.has(hex.terrain)
}
