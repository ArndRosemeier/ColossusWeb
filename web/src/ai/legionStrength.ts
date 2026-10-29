import type { LoadedVariant } from '../variant/loadVariant'
import { planReinforcement, planSummon } from './supportPlanning'
import { listBattleSummonSources } from '../engine/battle'
import { listRecruitOptionsAt } from '../engine/recruit'
import type { GameState, Legion } from '../engine/types'

/** Flat bonus when a creature is on a non-Plains/Tower terrain whose muster tree includes it. */
export const HOME_TURF_BONUS = 4

/** Defenders in a Tower are treated as stronger (Colossus-style). */
export const TOWER_DEFENSE_FACTOR = 1.2

export const FLYER_BUMP = 1
export const RANGESTRIKE_BUMP = 1

export type CombatRole = 'attack' | 'defend'

export interface CombatValueOptions {
  /**
   * When estimating an engagement on this hex:
   * - attack: add best summonable Angel/Archangel from another unengaged friendly legion (if room)
   * - defend: add best turn-4 reinforcement from the terrain muster tree (if room + caretaker)
   */
  engagementExtras?: boolean
}

const NON_CREATURE_RECRUIT_NAMES = new Set([
  'Anything',
  'AnyNonLord',
  'Lord',
  'DemiLord',
  'Titan',
])

function isConcreteRecruitName(name: string): boolean {
  return !NON_CREATURE_RECRUIT_NAMES.has(name) && !name.startsWith('Special:')
}

/**
 * True if creature appears in the terrain's recruit tree (muster-home proxy).
 * Plains and Tower never grant home-turf via this helper.
 */
export function isHomeTerrainCreature(
  variant: LoadedVariant,
  creatureName: string,
  terrainName: string,
): boolean {
  if (terrainName === 'Plains' || terrainName === 'Tower') return false
  const terrain = variant.terrains[terrainName]
  if (!terrain) return false
  return terrain.recruits.some(
    (s) => s.name === creatureName && isConcreteRecruitName(s.name),
  )
}

function terrainAt(state: GameState, hexLabel: string): string | null {
  return state.variant.board.hexByLabel[hexLabel]?.terrain ?? null
}

/**
 * Best summonable creature the attacker could call from another friendly legion
 * (mirrors battleSummon eligibility, ignoring the mid-fight “kill first” gate for estimates).
 */
export function findBestSummonable(
  state: GameState,
  attacker: Legion,
): { fromLegionId: string; creatureType: string } | null {
  const sources = state.battle && !state.battle.done && state.battle.attackerLegionId === attacker.id
    ? listBattleSummonSources(state, state.battle) : state.legions
  return planSummon(state, attacker, (type, hex) => creatureCombatValue(state, type, hex), sources)
}

/**
 * Strongest creature the defender could reinforce with on turn 4
 * (same recruit rules as battleReinforce / listRecruits).
 */
export function findBestBattleReinforce(
  state: GameState,
  defender: Legion,
  hexLabel: string,
): string | null {
  if (defender.creatures.length >= 7) return null
  if (state.battle && !state.battle.done && state.battle.defenderLegionId === defender.id &&
    state.battle.defenderReinforced) return null
  return planReinforcement(listRecruitOptionsAt(state, defender, hexLabel), hexLabel,
    (type, hex) => creatureCombatValue(state, type, hex))
}

/**
 * Location-aware combat value for one creature type on a master hex.
 * Titan uses `titanPower` (required when creatureType is Titan).
 */
export function creatureCombatValue(
  state: GameState,
  creatureType: string,
  hexLabel: string,
  titanPower?: number,
): number {
  const def = state.variant.creatures[creatureType]
  if (!def) return 0

  let base: number
  if (creatureType === 'Titan') {
    const power = titanPower ?? 6
    base = power * def.skill
  } else {
    base = def.power * def.skill
  }

  if (def.flies) base += FLYER_BUMP
  if (def.rangestrikes) base += RANGESTRIKE_BUMP

  const terrain = terrainAt(state, hexLabel)
  if (terrain && isHomeTerrainCreature(state.variant, creatureType, terrain)) {
    base += HOME_TURF_BONUS
  }

  return base
}

/**
 * Sum of creature combat values on `hexLabel`, with Tower defense inflation when role is defend.
 * With `engagementExtras`, also folds in summon (attack) or reinforce (defend).
 */
export function legionCombatValue(
  state: GameState,
  legion: Legion,
  hexLabel: string,
  role: CombatRole,
  options: CombatValueOptions = {},
): number {
  const owner = state.players.find((p) => p.id === legion.playerId)
  const titanPower = owner?.titanPower ?? 6

  let total = 0
  for (const c of legion.creatures) {
    total += creatureCombatValue(state, c.type, hexLabel, titanPower)
  }

  if (options.engagementExtras) {
    if (role === 'attack') {
      const summon = findBestSummonable(state, { ...legion, hexLabel })
      if (summon) {
        total += creatureCombatValue(state, summon.creatureType, hexLabel, titanPower)
      }
    } else {
      const reinforce = findBestBattleReinforce(state, legion, hexLabel)
      if (reinforce) {
        total += creatureCombatValue(state, reinforce, hexLabel, titanPower)
      }
    }
  }

  const terrain = terrainAt(state, hexLabel)
  if (role === 'defend' && terrain === 'Tower') {
    total *= TOWER_DEFENSE_FACTOR
  }

  return total
}
