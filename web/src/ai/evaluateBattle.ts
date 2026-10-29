/**
 * Bounded battle tactics: exact strike expectations and legal enemy responses,
 * mirrored after masterboard evaluateMove / battleEstimate.
 * Also weights the 7-turn clock (attacker loses on time-out).
 */
import {
  battleLand,
  isUnitAlive,
  legalBattleMovesFor,
  legalStrikesFor,
  MAX_BATTLE_TURNS,
} from '../engine/battle'
import {
  getStrikeNumber,
  getStrikeDice,
  getUnitPower,
  getUnitSkill,
  legalCarryTargetIds,
  legalStrikes as findLegalStrikes,
  listStrikeRaiseOptions,
} from '../engine/battleStrike'
import { legalBattleMoves } from '../engine/battleMovement'
import { battleNeighbors, hazardDamageToCreature } from '../engine/battleland'
import { strikeExpectations } from './battleProbability'
import { sampleBattleChoices, strikeRolloutOptions, type BattleRolloutOptions, type BattleRolloutWork } from './battleRollout'
import { difficultyForPlayer } from './difficulty'
import { battlePlannerOptions, legalEnemyResponse, NORMAL_BATTLE_PLANNER, type BattlePlannerOptions } from './battleResponse'
import type { BattleState, BattleUnit, GameCommand, GameState } from '../engine/types'
import {
  RATIO_DRAW,
  RATIO_LOSE_HEAVY,
  RATIO_WIN_HEAVY,
  RATIO_WIN_MINIMAL,
} from './battleEstimate'
import type { AiProfile } from './profiles'

export type ScoredBattleMove = {
  unitId: string
  toHex: string
  score: number
}

export type ScoredBattleStrike = {
  attackerId: string
  defenderId: string
  score: number
  /** Announced higher Strike-number for carry (optional). */
  raisedStrikeNumber?: number
}

/** How close the battle is to turn-7 time-loss (0 early → 1 on turn 7). */
export function battleClockHeat(battle: BattleState): number {
  const denom = Math.max(1, MAX_BATTLE_TURNS - 1)
  return Math.pow((battle.turn - 1) / denom, 1.4)
}

/**
 * Attacker urgency to finish before defender reinforce (turn 4).
 * 1 on turn 1 → ~0.33 on turn 3 → 0 once reinforce is available or done.
 */
export function attackerPreReinforceUrgency(battle: BattleState): number {
  if (battle.defenderReinforced || battle.turn >= 4) return 0
  return (4 - battle.turn) / 3
}

export function turnsLeftOnClock(battle: BattleState): number {
  return Math.max(1, MAX_BATTLE_TURNS - battle.turn + 1)
}

export function actingAsAttacker(state: GameState, battle: BattleState): boolean {
  const atk = state.legions.find((l) => l.id === battle.attackerLegionId)
  return atk != null && battle.activePlayerId === atk.playerId
}

/** E[hits] for one strike (melee or rangestrike), including hazard modifiers. */
export function expectedHits(
  state: GameState,
  battle: BattleState,
  attacker: BattleUnit,
  defender: BattleUnit,
  melee: boolean,
  raisedStrikeNumber?: number,
): number {
  const land = battleLand(state, battle)
  const dice = getStrikeDice(state, land, attacker, defender, melee)
  const natural = getStrikeNumber(state, attacker, defender, land, melee)
  const need =
    raisedStrikeNumber != null && raisedStrikeNumber > natural
      ? raisedStrikeNumber
      : natural
  const pHit = (7 - need) / 6
  return dice * pHit
}

export function unitPointValue(state: GameState, u: BattleUnit): number {
  const t = state.variant.creatures[u.creatureType]
  if (!t) return 0
  if (u.creatureType === 'Titan') {
    const owner = state.players.find((p) => p.id === u.playerId)
    return (owner?.titanPower ?? 6) * t.skill
  }
  return t.power * t.skill
}

function remainingHp(state: GameState, u: BattleUnit): number {
  return Math.max(0, getUnitPower(state, u) - u.hits)
}

const NON_TREE_RECRUIT = new Set([
  'Anything',
  'AnyNonLord',
  'Lord',
  'DemiLord',
  'Titan',
])

/**
 * Highest muster-tree step for this creature across terrains (0 = bottom).
 * Top-of-tree recruiters (Colossus, Hydra, …) score highest — they drive late musters.
 */
export function musterTier(state: GameState, creatureType: string): number {
  let best = -1
  for (const terrain of Object.values(state.variant.terrains)) {
    const steps = terrain.recruits.filter(
      (s) => !NON_TREE_RECRUIT.has(s.name) && !s.name.startsWith('Special:'),
    )
    const idx = steps.findIndex((s) => s.name === creatureType)
    if (idx > best) best = idx
  }
  return best
}

/**
 * How much we care about this unit surviving the fight (not just combat PV).
 * Favors developed muster creatures, uniques in the legion, and scarce caretaker stock.
 */
export function ownKeepValue(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
  profile: AiProfile,
): number {
  const t = state.variant.creatures[unit.creatureType]
  if (!t) return 0

  if (unit.creatureType === 'Titan') {
    return unitPointValue(state, unit) + profile.battleTitanValue * 2.5
  }

  let v = unitPointValue(state, unit)
  if (t.lord || t.demilord) v += 45
  if (t.summonable) v += 28

  const tier = musterTier(state, unit.creatureType)
  if (tier >= 0) {
    // Nonlinear: top-tree creatures matter far more for future musters
    v += (tier + 1) * (tier + 1) * 4
  }

  const sameAlive = battle.units.filter(
    (u) =>
      u.legionId === unit.legionId &&
      u.creatureType === unit.creatureType &&
      isUnitAlive(state, u),
  ).length
  if (sameAlive === 1 && tier >= 2) {
    v += 18 + tier * 10
  }

  const available = state.caretaker[unit.creatureType] ?? 0
  if (available <= 2 && tier >= 3) v += 18

  return v
}

/** Remaining combat weight of one side (HP × skill). */
export function battleSideForce(
  state: GameState,
  battle: BattleState,
  playerId: string,
): number {
  let force = 0
  for (const u of battle.units) {
    if (u.playerId !== playerId || !isUnitAlive(state, u)) continue
    force += remainingHp(state, u) * getUnitSkill(state, u)
  }
  return force
}

function enemyPlayerId(battle: BattleState, ourPlayerId: string): string | null {
  for (const u of battle.units) {
    if (u.playerId !== ourPlayerId) return u.playerId
  }
  return null
}

/**
 * 0 = likely loss, 1 = likely win. Uses live board forces (Colossus ratio buckets).
 */
export function battleWinConfidence(
  state: GameState,
  battle: BattleState,
  ourPlayerId: string,
): number {
  const ours = battleSideForce(state, battle, ourPlayerId)
  const enemyId = enemyPlayerId(battle, ourPlayerId)
  const theirs = enemyId ? battleSideForce(state, battle, enemyId) : 0
  const ratio = ours / Math.max(1, theirs)

  if (ratio >= RATIO_WIN_MINIMAL + 0.25) return 0.95
  if (ratio >= RATIO_WIN_MINIMAL) return 0.8
  if (ratio >= RATIO_WIN_HEAVY) return 0.65
  if (ratio >= 1) return 0.52
  if (ratio >= RATIO_DRAW) return 0.4
  if (ratio >= RATIO_LOSE_HEAVY) return 0.25
  return 0.1
}

/** How hard to weight own losses: high when ahead, low when desperate. */
export function protectionMultiplier(winConfidence: number): number {
  return 0.28 + winConfidence * winConfidence * 1.85
}

/** Extra offense push when behind. */
export function desperationOffenseMul(winConfidence: number): number {
  return 1.4 - winConfidence * 0.55
}

/** Prefer Titans, high PV, and already-wounded targets. */
export function targetValue(state: GameState, defender: BattleUnit, profile: AiProfile): number {
  let v = unitPointValue(state, defender)
  if (defender.creatureType === 'Titan') v += profile.battleTitanValue
  const power = getUnitPower(state, defender)
  const rem = remainingHp(state, defender)
  // Already damaged → easier / more valuable to finish
  v += (power - rem) * 0.75
  return Math.max(0.5, v)
}

function isAdjacentHex(state: GameState, battle: BattleState, a: string, b: string): boolean {
  const land = battleLand(state, battle)
  return battleNeighbors(land, a).includes(b)
}

function hexDistanceOnLand(
  land: ReturnType<typeof battleLand>,
  from: string,
  to: string,
): number {
  if (from === to) return 0
  const q: { h: string; d: number }[] = [{ h: from, d: 0 }]
  const seen = new Set([from])
  while (q.length) {
    const cur = q.shift()!
    for (const n of battleNeighbors(land, cur.h)) {
      if (seen.has(n)) continue
      if (n === to) return cur.d + 1
      seen.add(n)
      q.push({ h: n, d: cur.d + 1 })
    }
  }
  return 99
}

/**
 * Score striking `defender` with `attacker` (current hexes).
 * Optional raised Strike-number trades hit chance for harder carry targets.
 */
export function evaluateBattleStrike(
  state: GameState,
  battle: BattleState,
  attacker: BattleUnit,
  defender: BattleUnit,
  profile: AiProfile,
  raisedStrikeNumber?: number,
): number {
  if (!attacker.hex || !defender.hex) return -Infinity
  const land = battleLand(state, battle)
  const melee = isAdjacentHex(state, battle, attacker.hex, defender.hex)
  const rem = remainingHp(state, defender)
  if (rem <= 0) return -Infinity

  const heat = battleClockHeat(battle)
  const asAtk = actingAsAttacker(state, battle)
  const urgency = asAtk ? attackerPreReinforceUrgency(battle) : 0
  const win = battleWinConfidence(state, battle, attacker.playerId)
  // Attacker must finish before time-loss and before defender reinforce.
  const offenseMul =
    (asAtk ? 1 + 1.4 * heat + 0.9 * urgency : 1 - 0.2 * heat) * desperationOffenseMul(win)

  const tv = targetValue(state, defender, profile)
  const natural = getStrikeNumber(state, attacker, defender, land, melee)
  const need = raisedStrikeNumber != null ? Math.max(natural, raisedStrikeNumber) : natural
  const carryIds = melee ? legalCarryTargetIds(state, battle, land, attacker, defender,
    raisedStrikeNumber != null && raisedStrikeNumber > natural ? raisedStrikeNumber : undefined) : []
  const carryTargets = carryIds.map(id => battle.units.find(u => u.id === id)!).filter(Boolean)
  const capacity = carryTargets.reduce((sum, unit) => sum + remainingHp(state, unit), 0)
  const stats = strikeExpectations(getStrikeDice(state, land, attacker, defender, melee), need, rem, capacity)
  let score = stats.expectedDamage * tv * profile.attackAppetite * offenseMul
  const killMul = asAtk ? 1 + 2.5 * heat + 1.2 * urgency : 1 + 0.3 * heat
  score += stats.killProbability * 12 * tv * profile.attackAppetite * killMul
  if (carryTargets.length > 0) {
    const bestOther = Math.max(...carryTargets.map(unit => targetValue(state, unit, profile)))
    score += stats.expectedOverflow * bestOther * 0.45 * profile.attackAppetite * offenseMul
  }

  // When ahead: slight preference that fodder delivers (keep value); big swings still from damage
  const keep = ownKeepValue(state, battle, attacker, profile)
  score -= keep * 0.02 * win * win

  return score
}

function entryLandingsFor(battle: BattleState, unit: BattleUnit): string[] {
  return unit.legionId === battle.attackerLegionId
    ? battle.attackerEntrances
    : battle.defenderEntrances
}

function isFirstManeuverFor(battle: BattleState, unit: BattleUnit): boolean {
  const half = unit.legionId === battle.attackerLegionId ? 'attacker' : 'defender'
  return !battle.firstManeuverDone[half]
}

/** Allies still off-board (will die if not entered this maneuver). */
export function undeployedAllyCount(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
): number {
  return battle.units.filter(
    (u) =>
      u.legionId === unit.legionId &&
      u.id !== unit.id &&
      isUnitAlive(state, u) &&
      u.hex == null,
  ).length
}

/**
 * Must-enter bonus only. Hex choice among legal entries is left to tactical
 * scoring (offense / exposure) — do not reward racing inland.
 */
export function deploymentPlacementBonus(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
  toHex: string,
): number {
  if (unit.hex != null) return 0
  // Always huge vs leaving someone off-board (killUnentered)
  let bonus = 200
  if (!isFirstManeuverFor(battle, unit)) return bonus

  const waiting = undeployedAllyCount(state, battle, unit)
  const onEntrance = entryLandingsFor(battle, unit).includes(toHex)
  if (waiting > 0 && onEntrance) {
    // Clear the door: sitting on an entrance blocks later entrants
    bonus -= 80
  }
  return bonus
}

/**
 * Simulate next-enemy-maneuver exposure: hits we can take now, plus hits if an
 * enemy spends its move to reach adjacency (approximate reach via skill).
 */
export function prospectiveExposure(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
  toHex: string,
  profile: AiProfile,
): number {
  battle = { ...battle, units: battle.units.map(candidate => ({ ...candidate })) }
  const simulated = battle.units.find(candidate => candidate.id === unit.id)
  if (!simulated) throw new Error('Tactical exposure unit is absent from battle')
  unit = simulated
  const land = battleLand(state, battle)
  let win = battleWinConfidence(state, battle, unit.playerId)
  if (unit.creatureType === 'Titan') win = Math.max(win, 0.92)
  const ownVal = ownKeepValue(state, battle, unit, profile) * protectionMultiplier(win)
  const enemies = battle.units.filter(
    (e) => e.playerId !== unit.playerId && isUnitAlive(state, e) && e.hex,
  )
  let exposure = 0
  for (const enemy of enemies) {
    if (!enemy.hex) continue
    const dist = hexDistanceOnLand(land, toHex, enemy.hex)
    const skill = getUnitSkill(state, enemy)
    // Already in contact or rangestrike from current hex
    const canHitNow = (() => {
      const prev = unit.hex
      unit.hex = toHex
      try {
        return findLegalStrikes(state, battle, land, enemy, true).includes(unit.id)
      } finally {
        unit.hex = prev
      }
    })()
    if (canHitNow) {
      const melee = dist <= 1
      exposure += expectedHits(state, battle, enemy, unit, melee) * ownVal * 0.15 * profile.fightLossPenalty
      continue
    }
    // Enemy can walk adjacent next maneuver (skill reaches dist-1)
    if (dist > 1 && dist - 1 <= skill) {
      const eh = expectedHits(state, battle, enemy, unit, true)
      exposure += eh * ownVal * 0.12 * profile.fightLossPenalty
    }
  }
  // Titans: exposure is catastrophic — weight harder than fodder
  if (unit.creatureType === 'Titan') exposure *= 2.4
  return exposure
}

/**
 * Stand next to friends; bodyguard our Titan when enemies can reach it.
 * Distinct from approach (close on enemies) and threat (hits we take).
 */
export function formationScore(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
  toHex: string,
): number {
  const land = battleLand(state, battle)
  const neighbors = battleNeighbors(land, toHex)
  const friends = battle.units.filter(
    (u) =>
      u.id !== unit.id &&
      u.playerId === unit.playerId &&
      isUnitAlive(state, u) &&
      u.hex != null,
  )
  const enemies = battle.units.filter(
    (e) => e.playerId !== unit.playerId && isUnitAlive(state, e) && e.hex != null,
  )
  const adjFriends = friends.filter((f) => neighbors.includes(f.hex!)).length

  if (unit.creatureType === 'Titan') {
    return adjFriends * 7
  }

  let score = adjFriends * 1.8
  const titan = battle.units.find(
    (u) =>
      u.playerId === unit.playerId &&
      u.creatureType === 'Titan' &&
      isUnitAlive(state, u) &&
      u.hex != null,
  )
  if (!titan?.hex) return score

  const nextToTitan = battleNeighbors(land, titan.hex).includes(toHex)
  const titanThreatened = enemies.some((e) => {
    if (battleNeighbors(land, e.hex!).includes(titan.hex!)) return true
    return findLegalStrikes(state, battle, land, e, true).includes(titan.id)
  })
  if (nextToTitan && titanThreatened) {
    score += 14
    const blockers = enemies.filter((e) => neighbors.includes(e.hex!)).length
    score += blockers * 8
  }
  return score
}

/**
 * Rangestrike perch + high ground. Only used by the `perch` research fork.
 * Called while `unit.hex` is already the candidate hex.
 */
export function perchScore(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
  toHex: string,
): number {
  const land = battleLand(state, battle)
  const hex = land.hexByLabel[toHex]
  if (!hex) return 0
  const def = state.variant.creatures[unit.creatureType]
  let score = hex.elevation * 3.5

  if (def?.rangestrikes) {
    const enemies = battle.units.filter(
      (e) => e.playerId !== unit.playerId && isUnitAlive(state, e) && e.hex != null,
    )
    const adjacent = battleNeighbors(land, toHex)
    const targets = findLegalStrikes(state, battle, land, unit, true)
    for (const e of enemies) {
      if (!targets.includes(e.id) || !e.hex) continue
      if (adjacent.includes(e.hex)) continue
      score += 9
      if (e.creatureType === 'Titan') score += 10
    }
  }
  return score
}

/** Score placing `unit` on `toHex` (offense − threat + approach ± clock ± deploy). */
function evaluateBattleHexInPlace(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
  toHex: string,
  profile: AiProfile,
): number {
  const land = battleLand(state, battle)
  const prevHex = unit.hex
  const entering = prevHex == null
  const firstManeuver = isFirstManeuverFor(battle, unit)
  const deployBonus = deploymentPlacementBonus(state, battle, unit, toHex)
  const winRaw = battleWinConfidence(state, battle, unit.playerId)
  // Titans are never "acceptable losses". Defenders stalling the clock aren't desperate divers.
  const heatEarly = battleClockHeat(battle)
  const asAtkEarly = actingAsAttacker(state, battle)
  let win = winRaw
  if (unit.creatureType === 'Titan') win = Math.max(win, 0.92)
  else if (!asAtkEarly && heatEarly >= 0.4) win = Math.max(win, 0.55)

  const protect = protectionMultiplier(win)
  const keep = ownKeepValue(state, battle, unit, profile)
  unit.hex = toHex
  try {
    const heat = heatEarly
    const asAtk = asAtkEarly

    // Offense: best single strike available from this hex (Strike phase rules)
    const targetIds = findLegalStrikes(state, battle, land, unit, true)
    let offense = 0
    for (const tid of targetIds) {
      const def = battle.units.find((u) => u.id === tid)
      if (!def) continue
      offense = Math.max(offense, evaluateBattleStrike(state, battle, unit, def, profile))
    }

    // Immediate strike threat — scaled by keep value × win confidence
    const ownVal = keep * protect
    const enemies = battle.units.filter(
      (e) => e.playerId !== unit.playerId && isUnitAlive(state, e) && e.hex,
    )
    let threat = 0
    for (const enemy of enemies) {
      const canHit = findLegalStrikes(state, battle, land, enemy, true).includes(unit.id)
      if (!canHit || !enemy.hex) continue
      const melee = battleNeighbors(land, enemy.hex).includes(toHex)
      const eh = expectedHits(state, battle, enemy, unit, melee)
      threat += eh * ownVal * 0.15 * profile.fightLossPenalty
    }

    // Entry only: simulate enemy reach next maneuver (don't race into their ZOC)
    const exposure = entering ? prospectiveExposure(state, battle, unit, toHex, profile) : 0
    const exposureExtra = Math.max(0, exposure - threat)

    // Approach: still close when no contact yet
    let approach = 0
    let minDist = 99
    if (enemies.length > 0) {
      minDist = Math.min(...enemies.map((e) => (e.hex ? hexDistanceOnLand(land, toHex, e.hex) : 99)))
      approach = -minDist * profile.battleApproachEnemy
    }

    // Empty-board entry (typical defender first maneuver): form near the door, don't race center
    let posture = 0
    if (entering && firstManeuver && enemies.length === 0) {
      const doors = entryLandingsFor(battle, unit)
      const doorDist = Math.min(
        ...doors.map((d) => hexDistanceOnLand(land, toHex, d)),
        99,
      )
      posture = -doorDist * (unit.creatureType === 'Titan' ? 4 : 1.5)
    }

    // Clock: attacker presses (more offense/approach, less fear); defender stalls (more fear, less approach)
    let offenseW = offense * desperationOffenseMul(win)
    let threatW = threat + exposureExtra
    let approachW = approach
    const urgency = asAtk ? attackerPreReinforceUrgency(battle) : 0
    if (asAtk) {
      offenseW *= 1 + 1.2 * heat
      approachW *= 1 + 1.6 * heat
      threatW *= Math.max(0.25, 1 - 0.6 * heat)
      // Late: any contact is better than dancing out of range
      if (heat >= 0.55 && offense > 0) offenseW += 25 * heat
      if (heat >= 0.75 && minDist <= 1) approachW += 18 * heat
      // Pre-reinforce: time favors the defender — push contact on turns 1–3
      if (urgency > 0) {
        approachW *= 1 + 1.8 * urgency
        if (unit.creatureType !== 'Titan') {
          threatW *= Math.max(0.4, 1 - 0.5 * urgency)
          if (offense > 0) offenseW += 22 * urgency
          if (minDist <= 1) approachW += 14 * urgency
        }
      }
    } else {
      threatW *= 1 + 0.9 * heat
      approachW *= Math.max(0.15, 1 - 0.75 * heat)
      offenseW *= 1 - 0.15 * heat
      // Reward safer hexes when the clock already favors the defender
      if (heat >= 0.4 && threat === 0) offenseW += 8 * heat
    }

    // Ahead: high-keep units stay back; behind: fodder (not Titans) may dive for damage.
    // Use adjusted `win` for dive so clock-stalling defenders don't suicide.
    // Attacking before reinforce: even favored stacks must press, not hang back.
    if (unit.creatureType !== 'Titan') {
      if (winRaw >= 0.65 && keep >= 50) {
        if (asAtk && urgency > 0) {
          threatW *= 1.05
          approachW *= 0.85
        } else {
          threatW *= 1.15 + 0.35 * winRaw
          approachW *= 0.55
        }
      } else if (win <= 0.3) {
        threatW *= 0.55
        approachW *= 1.25
      }
    } else {
      // Titans almost never seek contact for its own sake — slightly less shy when racing reinforce
      approachW *= asAtk && urgency > 0 ? 0.45 : 0.2
      if (!(asAtk && (heat >= 0.8 || urgency >= 0.66))) {
        offenseW *= asAtk && urgency > 0 ? 0.55 : 0.4
      }
    }

    // Entering: pick hex by safety / useful contact — Titans must not dive for a strike
    if (entering) {
      if (unit.creatureType === 'Titan') {
        approachW *= 0.05
        offenseW *= 0.12
        threatW *= heat < 0.55 ? 1.6 : 1.25
      } else {
        approachW *= 0.35
        if (heat < 0.55) threatW *= 1.1
        // Only Colossus / top muster pieces: don't race into contact when winning
        if (winRaw >= 0.65 && musterTier(state, unit.creatureType) >= 3) {
          offenseW *= 0.35
          threatW *= 1.25
        }
      }
    }

    const heuristic = state.players.find((p) => p.id === unit.playerId)?.aiHeuristicId ?? 'spatial'
    const formation = heuristic === 'legacy' ? 0 : formationScore(state, battle, unit, toHex)
    const perch = heuristic === 'perch' ? perchScore(state, battle, unit, toHex) : 0
    const creature = state.variant.creatures[unit.creatureType]
    const damage = hazardDamageToCreature(land.hexByLabel[toHex].terrain, creature)
    const hp = remainingHp(state, unit)
    // This occurs before any Strike, even when no enemy has a target.
    if (unit.creatureType === 'Titan' && damage >= hp) return -Infinity
    const terrainCost = damage > 0 ? damage * keep * protect + (damage >= hp ? keep * 2 : 0)
      : -Math.min(unit.hits, -damage) * keep * 0.15
    return offenseW - threatW + approachW + posture + deployBonus + formation + perch - terrainCost
  } finally {
    unit.hex = prevHex
  }
}

/** Public evaluators never mutate a caller's units, including during hypothetical scoring. */
export function evaluateBattleHex(state: GameState, battle: BattleState, unit: BattleUnit, toHex: string, profile: AiProfile): number {
  const sim = { ...battle, units: battle.units.map(candidate => ({ ...candidate })) }
  const mover = sim.units.find(candidate => candidate.id === unit.id)
  if (!mover) throw new Error('Tactical mover is absent from battle')
  return evaluateBattleHexInPlace(state, sim, mover, toHex, profile)
}

export function rankBattleMoves(state: GameState, battle: BattleState, profile: AiProfile): ScoredBattleMove[] {
  battle = { ...battle, units: battle.units.map(unit => ({ ...unit })) }
  const movers = battle.units.filter(
    (u) => u.playerId === battle.activePlayerId && isUnitAlive(state, u) && !u.moved,
  )
  const scored: ScoredBattleMove[] = []
  for (const u of movers) {
    const moves = legalBattleMovesFor(state, battle, u)
    for (const toHex of moves) {
      scored.push({
        unitId: u.id,
        toHex,
        score: evaluateBattleHexInPlace(state, battle, u, toHex, profile),
      })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}

export function rankBattleStrikes(
  state: GameState,
  battle: BattleState,
  profile: AiProfile,
): ScoredBattleStrike[] {
  const strikers = battle.units.filter(
    (u) => u.playerId === battle.activePlayerId && !u.struck && u.hex,
  )
  const land = battleLand(state, battle)
  const targetCount = new Map<string, number>()
  for (const u of strikers) {
    targetCount.set(u.id, legalStrikesFor(state, battle, u).length)
  }
  const scored: ScoredBattleStrike[] = []
  for (const u of strikers) {
    const targets = legalStrikesFor(state, battle, u)
    for (const defenderId of targets) {
      const def = battle.units.find((x) => x.id === defenderId)
      if (!def) continue
      scored.push({
        attackerId: u.id,
        defenderId,
        score: evaluateBattleStrike(state, battle, u, def, profile),
      })
      const { options } = listStrikeRaiseOptions(state, battle, land, u, def)
      for (const opt of options) {
        scored.push({
          attackerId: u.id,
          defenderId,
          raisedStrikeNumber: opt.need,
          score: evaluateBattleStrike(state, battle, u, def, profile, opt.need),
        })
      }
    }
  }
  // Single-target strikers first (no choice of who), then by score — so forced
  // damage is known before multi-choice units pick their target.
  scored.sort((a, b) => {
    const aForced = (targetCount.get(a.attackerId) ?? 99) === 1 ? 0 : 1
    const bForced = (targetCount.get(b.attackerId) ?? 99) === 1 ? 0 : 1
    if (aForced !== bForced) return aForced - bForced
    return b.score - a.score
  })
  return scored
}

/**
 * If any remaining striker has only one legal target, restrict to those strikes.
 * Multi-choice strikers wait until forced damage (and kills) are resolved.
 */
export function preferSingleTargetStrikes(
  state: GameState,
  battle: BattleState,
  ranked: ScoredBattleStrike[],
): ScoredBattleStrike[] {
  if (ranked.length === 0) return ranked
  const countByAttacker = new Map<string, number>()
  for (const s of ranked) {
    if (countByAttacker.has(s.attackerId)) continue
    const u = battle.units.find((x) => x.id === s.attackerId)
    countByAttacker.set(
      s.attackerId,
      u ? legalStrikesFor(state, battle, u).length : 0,
    )
  }
  const forced = ranked.filter((s) => countByAttacker.get(s.attackerId) === 1)
  return forced.length > 0 ? forced : ranked
}

/** Search cap for `allCanStillEnter`: enough for 7 units, bounded for the UI thread. */
const ENTRY_SEARCH_BUDGET = 4000

/**
 * Whether every unit of the moving side that is still off the board can enter,
 * if `unitId` lands on `toHex` first. Units that never enter are eliminated
 * after the first maneuver (`killUnentered`), and units block each other's
 * paths, so the ORDER matters: fodder parked on the only reachable entry hexes
 * strands the Titan, which then dies and loses the game.
 *
 * A depth-first search on a scratch copy of the units, most constrained unit
 * first. If the search runs out of budget it answers `true` (it found no proof
 * of a dead end), so the AI is never left with no move at all.
 */
export function allCanStillEnter(
  state: GameState,
  battle: BattleState,
  unitId: string,
  toHex: string,
): boolean {
  const land = battleLand(state, battle)
  const units = battle.units.map((u) => ({ ...u }))
  const sim: BattleState = { ...battle, units }
  const mover = units.find((u) => u.id === unitId)
  if (!mover) return true
  mover.hex = toHex
  mover.moved = true
  const pending = units.filter(
    (u) =>
      u.playerId === battle.activePlayerId && u.hex == null && !u.moved && isUnitAlive(state, u),
  )
  let budget = ENTRY_SEARCH_BUDGET
  const search = (left: BattleUnit[]): boolean => {
    if (left.length === 0) return true
    if (--budget <= 0) return true
    let best: BattleUnit | null = null
    let bestMoves: string[] = []
    for (const u of left) {
      const moves = legalBattleMoves(state, sim, land, u)
      if (moves.length === 0) return false
      if (!best || moves.length < bestMoves.length) {
        best = u
        bestMoves = moves
      }
    }
    const rest = left.filter((u) => u !== best)
    for (const hex of bestMoves) {
      best!.hex = hex
      best!.moved = true
      const ok = search(rest)
      best!.hex = null
      best!.moved = false
      if (ok) return true
      if (budget <= 0) return true
    }
    return false
  }
  return search(pending)
}

export interface BattleTacticalOptions extends Partial<BattlePlannerOptions> {
  /** Hard-only local sampled search; false uses the Normal core unless explicitly overridden. */
  rollout?: false | Partial<BattleRolloutOptions>
}

export interface BattlePlanningWork { responseNodes: number; safetyNodes: number; safetyExhausted: boolean; candidatesEvaluated: number; exhausted: boolean }
export interface BattlePlanResult {
  rollout?: BattleRolloutWork
  normalControlWork?: BattlePlanningWork
  command: GameCommand
  work: BattlePlanningWork
}

function searchBattleManeuver(state: GameState, battle: BattleState, profile: AiProfile,
  ranked: ScoredBattleMove[], options: Partial<BattlePlannerOptions>, collect = false): BattlePlanResult & {
    protected?: boolean; alternatives?: { command: GameCommand; score: number; titanRisk: number }[]
  } {
  const settings = battlePlannerOptions({ ...difficultyForPlayer(state, battle.activePlayerId).battle, ...options })
  const budget = { nodes: 0, limit: settings.maxResponseNodes }
  const work = { responseNodes: 0, safetyNodes: 0, safetyExhausted: false, candidatesEvaluated: 0, exhausted: false }
  const hold: GameCommand = { type: 'battleDonePhase' }
  const keep = (unit: BattleUnit) => ownKeepValue(state, battle, unit, profile)
  const land = battleLand(state, battle)
  const ourTitans = battle.units.filter(unit => unit.playerId === battle.activePlayerId && unit.creatureType === 'Titan' && isUnitAlive(state, unit) && unit.hex)
  const safetyBudget = { nodes: 0, limit: 8192 }
  const safetyCache = new Map<string, ReturnType<typeof legalEnemyResponse>>()
  let protectedMove: ScoredBattleMove | undefined
  if (ourTitans.length > 0) {
    const held = legalEnemyResponse(state, battle, safetyBudget, keep)
    if (!held.complete) work.safetyExhausted = true
    if (held.complete) safetyCache.set('hold', held)
    // A certificate, not an assumed force ratio: no enemy can damage the Titan
    // before turn eight. Both intervening pre-strike drains must be survivable.
    if (held.complete && held.titanDamage === 0 && battle.turn === MAX_BATTLE_TURNS && !actingAsAttacker(state, battle) &&
        ourTitans.every(unit => unit.hits + 2 * Math.max(0, hazardDamageToCreature(land.hexByLabel[unit.hex!].terrain, state.variant.creatures[unit.creatureType])) < getUnitPower(state, unit))) {
      work.safetyNodes = safetyBudget.nodes
      return { command: hold, work, ...(collect ? { protected: true } : {}) }
    }
    // Inspect every legal Titan retreat within a separate fixed safety ceiling.
    // Optional difficulty budgets must not prune the only safe escape out of the beam.
    let safest = held
    if (held.titanDamage > 0 || ourTitans.some(unit => hazardDamageToCreature(land.hexByLabel[unit.hex!].terrain, state.variant.creatures[unit.creatureType]) >= remainingHp(state, unit))) {
      for (const move of ranked) {
        if (!Number.isFinite(move.score) || !ourTitans.some(unit => unit.id === move.unitId)) continue
        const sim = { ...battle, units: battle.units.map(unit => ({ ...unit })) }
        sim.units.find(unit => unit.id === move.unitId)!.hex = move.toHex
        const response = legalEnemyResponse(state, sim, safetyBudget, keep)
        if (!response.complete) { work.safetyExhausted = true; break }
        safetyCache.set(`${move.unitId}:${move.toHex}`, response)
        if (response.titanRisk < safest.titanRisk - 1e-9 ||
            (response.titanRisk <= safest.titanRisk + 1e-9 && response.titanDamage < safest.titanDamage - 1e-9)) {
          safest = response
          protectedMove = move
        }
      }
    }
    work.safetyNodes = safetyBudget.nodes
  }
  const selected: ScoredBattleMove[] = protectedMove ? [protectedMove] : []
  // Keep at least one useful option per mobile creature before filling the beam.
  for (const move of ranked) {
    if (selected.length >= settings.candidateLimit) break
    if (Number.isFinite(move.score) && !selected.some(candidate => candidate.unitId === move.unitId)) selected.push(move)
  }
  for (const move of ranked) {
    if (selected.length >= settings.candidateLimit) break
    if (Number.isFinite(move.score) && !selected.includes(move)) selected.push(move)
  }
  const candidates: (ScoredBattleMove | null)[] = [null, ...selected]
  // Budget exhaustion must never strand a Titan on deterministic lethal terrain.
  const escape = ranked.find(move => {
    const unit = battle.units.find(candidate => candidate.id === move.unitId)!
    const drains = battle.turn === MAX_BATTLE_TURNS && actingAsAttacker(state, battle) ? 1 : 2
    return unit.creatureType === 'Titan' && unit.hex &&
      drains * hazardDamageToCreature(land.hexByLabel[unit.hex].terrain, state.variant.creatures[unit.creatureType]) >= remainingHp(state, unit) &&
      drains * hazardDamageToCreature(land.hexByLabel[move.toHex].terrain, state.variant.creatures[unit.creatureType]) < remainingHp(state, unit) &&
      Number.isFinite(move.score)
  })
  const alternatives: { command: GameCommand; score: number; titanRisk: number }[] = []
  let bestRisk = Infinity
  let bestScore = -Infinity, bestCommand: GameCommand = escape
    ? { type: 'battleMove', unitId: escape.unitId, toHex: escape.toHex } : hold
  for (const move of candidates) {
    const sim = { ...battle, units: battle.units.map(unit => ({ ...unit })) }
    if (move) sim.units.find(unit => unit.id === move.unitId)!.hex = move.toHex
    let positionScore = 0
    for (const unit of sim.units) if (unit.playerId === sim.activePlayerId && isUnitAlive(state, unit) && unit.hex) {
      positionScore += evaluateBattleHexInPlace(state, sim, unit, unit.hex, profile)
    }
    if (!Number.isFinite(positionScore)) continue
    const reply = safetyCache.get(move ? `${move.unitId}:${move.toHex}` : 'hold') ?? legalEnemyResponse(state, sim, budget, keep)
    if (!reply.complete) { work.exhausted = true; break }
    work.candidatesEvaluated++
    // Whole-position response cost notices a move that releases an enemy from a
    // screen or blocks a friendly ranged line, rather than scoring only the mover.
    const heat = battleClockHeat(battle), asAttacker = actingAsAttacker(state, battle)
    const responseWeight = asAttacker
      ? Math.max(0.1, 0.5 - 0.35 * heat - 0.2 * attackerPreReinforceUrgency(battle))
      : 0.65 + 0.35 * heat
    const score = positionScore - reply.loss * profile.fightLossPenalty * responseWeight - reply.titanRisk * 10000
    if (collect && !reply.titanDoomed) alternatives.push({ command: move ? { type: 'battleMove', unitId: move.unitId, toHex: move.toHex } : hold,
      score, titanRisk: reply.titanRisk })
    if (score > bestScore + 0.01) {
      bestRisk = reply.titanRisk
      bestScore = score
      bestCommand = move ? { type: 'battleMove', unitId: move.unitId, toHex: move.toHex } : hold
    }
  }
  work.responseNodes = budget.nodes
  return { command: bestCommand, work, ...(collect ? { protected: !!protectedMove || !!escape,
    alternatives: alternatives.filter(choice => choice.titanRisk <= bestRisk + 1e-9).sort((a, b) => b.score - a.score) } : {}) }
}

function planManeuverWithRollouts(state: GameState, battle: BattleState, profile: AiProfile,
  ranked: ScoredBattleMove[], options: BattleTacticalOptions): BattlePlanResult {
  const { rollout, ...planning } = options
  const hard = difficultyForPlayer(state, battle.activePlayerId).id === 'hard'
  const enabled = hard && rollout !== false
  const base = searchBattleManeuver(state, battle, profile, ranked, hard && !enabled ? { ...NORMAL_BATTLE_PLANNER, ...planning } : planning, enabled)
  if (!enabled) return { command: base.command, work: base.work }
  const normal = searchBattleManeuver(state, battle, profile, ranked, NORMAL_BATTLE_PLANNER, true)
  if (normal.protected || base.protected) return { command: normal.command, work: base.work, normalControlWork: normal.work }
  const normalRisk = normal.alternatives?.find(choice => JSON.stringify(choice.command) === JSON.stringify(normal.command))?.titanRisk ?? 0
  const result = sampleBattleChoices(state, battle, (base.alternatives ?? []).filter(choice => choice.titanRisk <= normalRisk + 1e-9).map(choice => choice.command), normal.command, profile, rollout || {})
  // Never reward a censored support boundary or an unfinished candidate. The
  // fallback is the actual Normal planner, including shared mandatory safety.
  const command = result.work.usedRollout ? result.command : normal.command
  return { command, work: base.work, normalControlWork: normal.work, rollout: result.work }
}

/** Deterministic, inspectable budget seam for future per-seat difficulty controls. */
export function planBattleManeuver(state: GameState, battle: BattleState, profile: AiProfile,
  options: BattleTacticalOptions = {}): BattlePlanResult {
  return planManeuverWithRollouts(state, battle, profile, rankBattleMoves(state, battle, profile), options)
}

export function pickBestBattleMove(
  state: GameState,
  battle: BattleState,
  profile: AiProfile,
  rng: () => number,
  options: BattleTacticalOptions = {},
): GameCommand {
  battlePlannerOptions(options)
  const ranked = rankBattleMoves(state, battle, profile)
  if (ranked.length === 0) return { type: 'battleDonePhase' }

  // Keep deploying while any off-board unit still has a legal entry.
  // Place fodder before the Titan so the Titan can pick a covered hex.
  const deployMoves = ranked.filter((m) => {
    const u = battle.units.find((x) => x.id === m.unitId)
    return u != null && u.hex == null
  })
  const isTitan = (m: ScoredBattleMove) =>
    battle.units.find((x) => x.id === m.unitId)?.creatureType === 'Titan'
  // Only entries that leave room for every other unit still off the board (a
  // unit that cannot enter dies — losing the Titan loses the game). Checked in
  // score order and only as far as the pick below looks (best, then within 0.5,
  // at most 3), since each check is a search.
  const safeTop = (moves: ScoredBattleMove[]): ScoredBattleMove[] => {
    const out: ScoredBattleMove[] = []
    for (const m of moves) {
      if (out.length >= 3 || (out.length > 0 && m.score < out[0]!.score - 0.5)) break
      if (allCanStillEnter(state, battle, m.unitId, m.toHex)) out.push(m)
    }
    return out
  }
  let pool: ScoredBattleMove[] = ranked
  if (deployMoves.length > 0) {
    const titanDeploy = deployMoves.filter(isTitan)
    const safeOthers = safeTop(deployMoves.filter((m) => !isTitan(m)))
    const safeTitan = safeOthers.length > 0 ? [] : safeTop(titanDeploy)
    // When not everyone can get in, the Titan goes first.
    pool =
      safeOthers.length > 0
        ? safeOthers
        : safeTitan.length > 0
          ? safeTitan
          : titanDeploy.length > 0
            ? titanDeploy
            : deployMoves
  }

  if (deployMoves.length === 0) return planManeuverWithRollouts(state, battle, profile, ranked, options).command

  // Among top few near-best, slight rng for variety
  const top = pool.filter((m) => m.score >= pool[0]!.score - 0.5).slice(0, 3)
  const pick = top[Math.floor(rng() * top.length)]!
  return { type: 'battleMove', unitId: pick.unitId, toHex: pick.toHex }
}

function pickHeuristicBattleStrike(
  state: GameState,
  battle: BattleState,
  profile: AiProfile,
  rng: () => number,
): GameCommand {
  const ranked = preferSingleTargetStrikes(
    state,
    battle,
    rankBattleStrikes(state, battle, profile),
  )
  if (ranked.length === 0) return { type: 'battleDonePhase' }
  const best = ranked[0]!
  const win = battleWinConfidence(state, battle, battle.activePlayerId)

  // When the fight is in hand, among near-best strikes prefer the lowest-keep attacker
  // (sacrifice Ogres, not the only Colossus) — never drop a unique kill for that.
  let pool = ranked.filter((s) => s.score >= best.score - 0.5)
  if (win >= 0.6) {
    const band = ranked.filter((s) => s.score >= best.score - Math.max(12, best.score * 0.2))
    const bestAtk = battle.units.find((u) => u.id === best.attackerId)
    const bestDef = battle.units.find((u) => u.id === best.defenderId)
    const killChance = (atk: BattleUnit, def: BattleUnit, raised?: number) => {
      if (!atk.hex || !def.hex) return 0
      const land = battleLand(state, battle), melee = isAdjacentHex(state, battle, atk.hex, def.hex)
      const natural = getStrikeNumber(state, atk, def, land, melee)
      return strikeExpectations(getStrikeDice(state, land, atk, def, melee), raised == null ? natural : Math.max(natural, raised), remainingHp(state, def)).killProbability
    }
    const bestKillChance = bestAtk && bestDef ? killChance(bestAtk, bestDef, best.raisedStrikeNumber) : 0
    const candidates = band.filter(s => {
      const atk = battle.units.find(unit => unit.id === s.attackerId)
      const def = battle.units.find(unit => unit.id === s.defenderId)
      return atk && def && (bestKillChance < 0.5 || killChance(atk, def, s.raisedStrikeNumber) >= Math.min(0.9, bestKillChance - 0.05))
    })
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const ua = battle.units.find((u) => u.id === a.attackerId)!
        const ub = battle.units.find((u) => u.id === b.attackerId)!
        const ka = ownKeepValue(state, battle, ua, profile)
        const kb = ownKeepValue(state, battle, ub, profile)
        if (ka !== kb) return ka - kb
        return b.score - a.score
      })
      pool = candidates.slice(0, 3)
    }
  }

  const top = pool.slice(0, 3)
  const pick = top[Math.floor(rng() * top.length)]!
  return {
    type: 'battleStrike',
    attackerId: pick.attackerId,
    defenderId: pick.defenderId,
    raisedStrikeNumber: pick.raisedStrikeNumber,
  }
}

export function planBattleStrike(state: GameState, battle: BattleState, profile: AiProfile, rng: () => number,
  rollout: false | Partial<BattleRolloutOptions> = {}) {
  // Preserve the established chooser's real RNG consumption; simulated dice
  // exclusively use the rollout's local common-random-number generator.
  const fallback = pickHeuristicBattleStrike(state, battle, profile, rng)
  if (difficultyForPlayer(state, battle.activePlayerId).id !== 'hard' || rollout === false || fallback.type !== 'battleStrike') {
    return { command: fallback, rollout: undefined }
  }
  // Preserve the common final-defender clock protection rather than replacing
  // its established strike choice with a sampled terminal gamble.
  if (battle.turn === MAX_BATTLE_TURNS && !actingAsAttacker(state, battle) &&
      battle.units.some(unit => unit.playerId === battle.activePlayerId && unit.creatureType === 'Titan')) {
    return { command: fallback, rollout: undefined }
  }
  const ranked = preferSingleTargetStrikes(state, battle, rankBattleStrikes(state, battle, profile))
  // Different targets before interchangeable attackers: a narrow root shortlist
  // must retain the focus-fire alternative to a tempting immediate kill.
  const byTarget = ranked.filter((strike, index) => ranked.findIndex(other => other.defenderId === strike.defenderId) === index)
  const choices = [...byTarget, ...ranked].map(strike =>
    ({ type: 'battleStrike' as const, attackerId: strike.attackerId, defenderId: strike.defenderId, raisedStrikeNumber: strike.raisedStrikeNumber }))
  const result = sampleBattleChoices(state, battle, choices, fallback, profile, strikeRolloutOptions(battle, rollout))
  return { command: result.command, rollout: result.work }
}

export function pickBestBattleStrike(state: GameState, battle: BattleState, profile: AiProfile, rng: () => number,
  rollout: false | Partial<BattleRolloutOptions> = {}): GameCommand {
  return planBattleStrike(state, battle, profile, rng, rollout).command
}

/** Score carry targets; pick highest kill/finish value. */
export function pickBestCarry(
  state: GameState,
  battle: BattleState,
  profile: AiProfile,
): GameCommand {
  const pending = battle.pendingCarry
  if (!pending || pending.targetIds.length === 0) {
    return { type: 'battleDonePhase' }
  }
  const heat = battleClockHeat(battle)
  const asAtk = actingAsAttacker(state, battle)
  const killBoost = asAtk ? 1 + 2 * heat : 1

  let bestId = pending.targetIds[0]!
  let bestScore = -Infinity
  for (const id of pending.targetIds) {
    const u = battle.units.find((x) => x.id === id)
    if (!u || !isUnitAlive(state, u)) continue
    const rem = remainingHp(state, u)
    const tv = targetValue(state, u, profile)
    const score =
      (pending.hitsLeft >= rem ? 20 * killBoost : pending.hitsLeft) * tv * profile.attackAppetite
    if (score > bestScore) {
      bestScore = score
      bestId = id
    }
  }
  return { type: 'battleCarry', targetId: bestId }
}
