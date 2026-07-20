import type { LoadedVariant } from '../variant/loadVariant'
import type { AiProfileId, ResolvedAiProfileId } from '../ai/profiles'

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
  /**
   * Creature types publicly known in this legion (multiset).
   * Unknown slots = creatures.length − knownPublic.length (after sync).
   * Cleared on split; filled on recruit/teleport/battle reveals.
   */
  knownPublic: string[]
  moved: boolean
  teleported: boolean
  /** Already recruited this enlistment phase */
  recruited: boolean
  /** Creature type mustered this turn (board badge until muster phase ends). */
  musteredThisTurn: string | null
  /** Parent already split during this Split phase (cannot split again). */
  splitThisTurn: boolean
  /** Child created this Split phase — points at parent for undoSplit. */
  splitParentId: string | null
  /** Hex at the start of this Move phase (Colossus startingHex); used by undoMove. */
  moveOriginHex: string | null
  enteredFrom: EntrySide | null
}

export interface PlayerState {
  id: string
  name: string
  color: PlayerColor
  kind: PlayerKind
  /** Resolved AI personality; null for humans */
  aiProfileId: ResolvedAiProfileId | null
  startingTower: string
  score: number
  dead: boolean
  titanPower: number
  hasTeleported: boolean
  /**
   * Unused legion markers for this player (and any eliminated colors they hold).
   * Colossus: each color has 12 markers (e.g. Rd01–Rd12); splitting requires one free.
   */
  markersAvailable: string[]
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
  /** Hex at the start of this maneuver phase (null = off-board); used by undo. */
  moveOriginHex: string | null
}

export interface BattleState {
  attackerLegionId: string
  defenderLegionId: string
  terrain: string
  activePlayerId: string
  activeHalf: BattleHalf
  phase: BattlePhase
  units: BattleUnit[]
  /**
   * Creatures removed after Strikeback (Colossus removeDeadCreatures).
   * Kept for end-of-battle scoring; not shown on the board.
   */
  fallen: BattleUnit[]
  turn: number
  highlighted: string[]
  selectedUnitId: string | null
  pendingCarry: { fromUnitId: string; hitsLeft: number; targetIds: string[] } | null
  done: boolean
  winnerPlayerId: string | null
  timeLoss: boolean
  /** Battle ended because a Titan was removed after Strikeback (player eliminated). */
  endedByTitanKill?: boolean
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
  /** Unit ids moved this maneuver phase, newest last (Colossus undo-last stack). */
  moveStack: string[]
}

export interface EngagementOffer {
  attackerId: string
  defenderId: string
  revealed: boolean
  /** Pending agreement proposal from a player */
  proposal: 'attackerDies' | 'defenderDies' | 'mutual' | 'fight' | null
  proposedBy: string | null
}

/** Shown as 3D dice on the board until the roll stops mattering. */
export type DiceRollContext = 'movement' | 'mulligan' | 'strike'

/** `physical` = UI throws dice and commits faces; `rng` = headless/sim. */
export type DiceRollMode = 'rng' | 'physical'

export interface DiceRollDisplay {
  /** Changes on every roll so the UI can replay the tumble animation. */
  id: string
  context: DiceRollContext
  values: number[]
  /** Strike number that counts as a hit (strike rolls only). */
  need?: number
  hits?: number
  label: string
  /** Player whose seat the throw came from. */
  playerId: string
}

/**
 * Awaiting a physical (or deferred) die throw before rules resolve.
 * Present only when `diceMode === 'physical'`.
 */
export interface PendingDiceRoll {
  id: string
  context: DiceRollContext
  dieCount: number
  playerId: string
  label: string
  /** Strike: resolve after faces are known. */
  strike?: {
    attackerId: string
    defenderId: string
    need: number
    raisedStrikeNumber?: number
  }
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
  /**
   * Last settled die roll for the board overlay (movement or strike).
   * Cleared when the roll is no longer relevant.
   */
  diceRoll: DiceRollDisplay | null
  /** When set, the UI must throw and `commitDice` before play continues. */
  pendingDice: PendingDiceRoll | null
  /** Visual UI uses `physical`; sims/tests leave default `rng`. */
  diceMode: DiceRollMode
  /** Turn-1 mulligan still available for active player */
  mulliganAvailable: boolean
  /**
   * Muster Done was pressed while recruits remained — second press skips them.
   */
  musterSkipWarned: boolean
  /**
   * Split Done was pressed while a size-7 legion could still split — second press skips.
   */
  splitSkipWarned: boolean
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
  | { type: 'deselectLegion' }
  | { type: 'split'; parentId: string; childCreatures: string[]; childHex?: string }
  | { type: 'undoSplit'; childId: string }
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
  | { type: 'battleUndoLastMove' }
  | { type: 'battleUndoAllMoves' }
  | { type: 'battleStrike'; attackerId: string; defenderId: string; raisedStrikeNumber?: number }
  | { type: 'battleCarry'; targetId: string }
  | { type: 'battleDonePhase' }
  | { type: 'battleReinforce'; creatureType: string }
  | { type: 'battleSkipReinforce' }
  | { type: 'battleSummon'; fromLegionId: string }
  | { type: 'battleSkipSummon' }
  | { type: 'recruit'; legionId: string; creatureType: string }
  | { type: 'undoRecruit'; legionId: string }
  | { type: 'doneMuster' }
  | { type: 'pass' }
  /**
   * Finish `pendingDice`. With `values`, use those faces (physical throw).
   * Without `values`, roll via rng (instant AI / reduced motion / sims).
   */
  | { type: 'commitDice'; values?: number[] }

export interface NewGameOptions {
  players: {
    name: string
    kind: PlayerKind
    colorId?: string
    /** AI personality; `random` is resolved at createGame */
    aiProfileId?: AiProfileId
  }[]
  seed?: number
  /** Default `rng`. App UI should pass `physical`. */
  diceMode?: DiceRollMode
}
