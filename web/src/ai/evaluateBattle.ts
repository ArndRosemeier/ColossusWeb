/**
 * One-ply battle tactics: score moves and strikes by expected hits,
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
import { battleNeighbors } from '../engine/battleland'
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
  const eh = expectedHits(state, battle, attacker, defender, melee, raisedStrikeNumber)
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
  const dealt = Math.min(eh, rem)
  let score = dealt * tv * profile.attackAppetite * offenseMul

  if (eh >= rem) {
    const killMul = asAtk ? 1 + 2.5 * heat + 1.2 * urgency : 1 + 0.3 * heat
    score += 12 * tv * profile.attackAppetite * killMul
  }

  // Carry overflow onto legal adjacent enemies (respects raised SN)
  if (melee && eh > rem) {
    const overflow = eh - rem
    const natural = getStrikeNumber(state, attacker, defender, land, true)
    const raised =
      raisedStrikeNumber != null && raisedStrikeNumber > natural
        ? raisedStrikeNumber
        : undefined
    const carryIds = legalCarryTargetIds(state, battle, land, attacker, defender, raised)
    if (carryIds.length > 0) {
      const bestOther = Math.max(
        ...carryIds.map((id) => {
          const o = battle.units.find((u) => u.id === id)!
          return targetValue(state, o, profile)
        }),
      )
      score += Math.min(overflow, 3) * bestOther * 0.45 * profile.attackAppetite * offenseMul
    }
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

/** Score placing `unit` on `toHex` (offense − threat + approach ± clock ± deploy). */
export function evaluateBattleHex(
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

    return offenseW - threatW + approachW + posture + deployBonus
  } finally {
    unit.hex = prevHex
  }
}

export function rankBattleMoves(state: GameState, battle: BattleState, profile: AiProfile): ScoredBattleMove[] {
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
        score: evaluateBattleHex(state, battle, u, toHex, profile),
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

export function pickBestBattleMove(
  state: GameState,
  battle: BattleState,
  profile: AiProfile,
  rng: () => number,
): GameCommand {
  const ranked = rankBattleMoves(state, battle, profile)
  if (ranked.length === 0) return { type: 'battleDonePhase' }

  // Keep deploying while any off-board unit still has a legal entry.
  // Place fodder before the Titan so the Titan can pick a covered hex.
  const deployMoves = ranked.filter((m) => {
    const u = battle.units.find((x) => x.id === m.unitId)
    return u != null && u.hex == null
  })
  const nonTitanDeploy = deployMoves.filter((m) => {
    const u = battle.units.find((x) => x.id === m.unitId)
    return u != null && u.creatureType !== 'Titan'
  })
  const pool =
    nonTitanDeploy.length > 0 ? nonTitanDeploy : deployMoves.length > 0 ? deployMoves : ranked

  const anyMoved = battle.units.some(
    (u) => u.playerId === battle.activePlayerId && isUnitAlive(state, u) && u.moved,
  )
  const best = pool[0]!
  const heat = battleClockHeat(battle)
  const asAtk = actingAsAttacker(state, battle)
  const urgency = asAtk ? attackerPreReinforceUrgency(battle) : 0

  // Never end Move while creatures can still enter (unentered die after first maneuver)
  if (deployMoves.length === 0) {
    let threshold = profile.battleMoveThreshold
    if (asAtk) {
      threshold -= 12 * heat
      // Keep maneuvering while racing the reinforce window
      threshold -= 16 * urgency
    } else threshold += 6 * heat
    if (anyMoved && best.score <= threshold) {
      return { type: 'battleDonePhase' }
    }
  }

  // Among top few near-best, slight rng for variety
  const top = pool.filter((m) => m.score >= best.score - 0.5).slice(0, 3)
  const pick = top[Math.floor(rng() * top.length)]!
  return { type: 'battleMove', unitId: pick.unitId, toHex: pick.toHex }
}

export function pickBestBattleStrike(
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
    const bestKills =
      bestAtk &&
      bestDef &&
      expectedHits(
        state,
        battle,
        bestAtk,
        bestDef,
        bestAtk.hex != null &&
          bestDef.hex != null &&
          isAdjacentHex(state, battle, bestAtk.hex, bestDef.hex),
        best.raisedStrikeNumber,
      ) >= remainingHp(state, bestDef)

    const candidates = band.filter((s) => {
      if (!bestKills) return true
      const atk = battle.units.find((u) => u.id === s.attackerId)
      const def = battle.units.find((u) => u.id === s.defenderId)
      if (!atk || !def || !atk.hex || !def.hex) return false
      const melee = isAdjacentHex(state, battle, atk.hex, def.hex)
      return (
        expectedHits(state, battle, atk, def, melee, s.raisedStrikeNumber) >=
        remainingHp(state, def)
      )
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
