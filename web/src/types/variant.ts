export type GateType = 'NONE' | 'BLOCK' | 'ARCH' | 'ARROW' | 'ARROWS'

export interface CreatureType {
  name: string
  power: number
  skill: number
  rangestrikes: boolean
  flies: boolean
  magicMissile: boolean
  summonable: boolean
  lord: boolean
  demilord: boolean
  count: number
  pluralName: string
  baseColor: string
  native: Record<string, boolean>
}

export interface RecruitStep {
  name: string
  number: number
}

export interface TerrainDef {
  name: string
  color: string
  regularRecruit: boolean
  recruits: RecruitStep[]
  starting: RecruitStep[]
}

export interface AcquirableDef {
  name: string
  points: number
}

export interface MapExitDef {
  type: GateType
  label: string
}

export interface MapHexDef {
  label: string
  terrain: string
  x: number
  y: number
  exits: MapExitDef[]
}

export interface BattleHexBorderDef {
  /** Hexside 0–5 */
  number: number
  /** Colossus code: ' ' | d | c | s | w | r */
  type: string
}

export interface BattleHexDef {
  x: number
  y: number
  label?: string
  terrain?: string
  elevation?: number
  borders?: BattleHexBorderDef[]
}

export interface BattlelandDef {
  terrain: string
  tower: boolean
  subtitle: string | null
  hexes: BattleHexDef[]
  startlist: string[]
}

export interface VariantData {
  name: string
  creatures: CreatureType[]
  terrains: TerrainDef[]
  acquirables: AcquirableDef[]
  map: {
    width: number
    height: number
    hexes: MapHexDef[]
  }
  battlelands: Record<string, BattlelandDef>
}

export interface MasterHex {
  label: string
  terrain: string
  x: number
  y: number
  /** Exit type per side 0..5 */
  exitType: GateType[]
  /** Entrance type per side 0..5 */
  entranceType: GateType[]
  /** Neighbor hex label per side 0..5 */
  neighbors: (string | null)[]
  labelSide: number
  inverted: boolean
}

export interface BuiltBoard {
  width: number
  height: number
  boardParity: number
  hexByLabel: Record<string, MasterHex>
  towers: string[]
  /** Grid [x][y] label or null */
  grid: (string | null)[][]
}
