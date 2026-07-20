import type { LoadedVariant } from '../variant/loadVariant'

export type Phase = 'Split' | 'Move' | 'Fight' | 'Muster' | 'Battle'
export type PlayerKind = 'human' | 'ai'
export type EntrySide = 'Left' | 'Right' | 'Bottom'

export interface PlayerColor {
  id: string
  name: string
  /** Marker filename prefix, e.g. Rd, Bu */
  shortName: string
  css: string
}

export const PLAYER_COLORS: PlayerColor[] = [
  // Colossus HTMLColor.*Colossus
  { id: 'Red', name: 'Red', shortName: 'Rd', css: '#bd0018' },
  { id: 'Blue', name: 'Blue', shortName: 'Bu', css: '#10187b' },
  { id: 'Green', name: 'Green', shortName: 'Gr', css: '#18ad42' },
  { id: 'Gold', name: 'Gold', shortName: 'Gd', css: '#a59431' },
  { id: 'Black', name: 'Black', shortName: 'Bk', css: '#000000' },
  { id: 'Brown', name: 'Brown', shortName: 'Br', css: '#782828' },
]

export interface CreatureInstance {
  type: string
  hits: number
}

export interface Legion {
  id: string
  markerId: string
  playerId: string
  hexLabel: string
  creatures: CreatureInstance[]
  moved: boolean
  teleported: boolean
  /** Already recruited this enlistment phase */
  recruited: boolean
  enteredFrom: EntrySide | null
}

export interface PlayerState {
  id: string
  name: string
  color: PlayerColor
  kind: PlayerKind
  startingTower: string
  score: number
  dead: boolean
  titanPower: number
  hasTeleported: boolean
  /** Marker letters available: e.g. Rd, Bk */
  nextMarker: number
}

export type BattlePhase = 'Summon' | 'Recruit' | 'Move' | 'Strike' | 'Strikeback'

/** Whose maneuver/strike half within the current battle turn (1–7). */
export type BattleHalf = 'defender' | 'attacker'

export interface BattleUnit {
  id: string
  legionId: string
  playerId: string
  creatureType: string
  hits: number
  hex: string | null
  struck: boolean
  moved: boolean
}

export interface BattleState {
  attackerLegionId: string
  defenderLegionId: string
  terrain: string
  activePlayerId: string
  activeHalf: BattleHalf
  phase: BattlePhase
  units: BattleUnit[]
  turn: number
  highlighted: string[]
  selectedUnitId: string | null
  pendingCarry: { fromUnitId: string; hitsLeft: number; targetIds: string[] } | null
  done: boolean
  winnerPlayerId: string | null
  timeLoss: boolean
  /** Full points on concede (vs half on combat) */
  concededFullPoints?: boolean
  attackerEntrances: string[]
  defenderEntrances: string[]
  firstManeuverDone: { attacker: boolean; defender: boolean }
  defenderReinforced: boolean
  attackerSummoned: boolean
  pendingSummon: boolean
  /** Flee denies summon */
  denySummon: boolean
}

export interface EngagementOffer {
  attackerId: string
  defenderId: string
  revealed: boolean
  /** Pending agreement proposal from a player */
  proposal: 'attackerDies' | 'defenderDies' | 'mutual' | 'fight' | null
  proposedBy: string | null
}

export interface GameState {
  variant: LoadedVariant
  players: PlayerState[]
  legions: Legion[]
  caretaker: Record<string, number>
  phase: Phase
  activePlayerIndex: number
  turnNumber: number
  movementRoll: number | null
  /** Turn-1 mulligan still available for active player */
  mulliganAvailable: boolean
  selectedLegionId: string | null
  legalHexes: string[]
  battle: BattleState | null
  pendingEngagements: { attackerId: string; defenderId: string }[]
  /** Current engagement being resolved before battle */
  activeEngagement: EngagementOffer | null
  message: string
  winnerId: string | null
  /** True when all living Titans die in the same resolution (Colossus draw). */
  draw: boolean
  log: string[]
}

export type GameCommand =
  | { type: 'selectLegion'; legionId: string }
  | { type: 'split'; parentId: string; childCreatures: string[]; childHex?: string }
  | { type: 'doneSplit' }
  | { type: 'move'; legionId: string; toHex: string; teleport?: boolean }
  | { type: 'undoMove'; legionId: string }
  | { type: 'doneMove' }
  | { type: 'mulligan' }
  | { type: 'startEngagement'; attackerId: string; defenderId: string }
  | { type: 'revealEngagement' }
  | { type: 'flee' }
  | { type: 'concedeEngagement'; loserId: string }
  | { type: 'proposeAgreement'; kind: 'attackerDies' | 'defenderDies' | 'mutual' | 'fight' }
  | { type: 'acceptAgreement' }
  | { type: 'refuseAgreement' }
  | { type: 'concedeBattle' }
  | { type: 'battleSelectUnit'; unitId: string }
  | { type: 'battleMove'; unitId: string; toHex: string }
  | { type: 'battleStrike'; attackerId: string; defenderId: string }
  | { type: 'battleCarry'; targetId: string }
  | { type: 'battleDonePhase' }
  | { type: 'battleReinforce'; creatureType: string }
  | { type: 'battleSkipReinforce' }
  | { type: 'battleSummon'; fromLegionId: string }
  | { type: 'battleSkipSummon' }
  | { type: 'recruit'; legionId: string; creatureType: string }
  | { type: 'doneMuster' }
  | { type: 'pass' }

export interface NewGameOptions {
  players: { name: string; kind: PlayerKind; colorId?: string }[]
  seed?: number
}
