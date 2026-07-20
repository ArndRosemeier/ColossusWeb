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
  getUnitPower,
  legalStrikes as findLegalStrikes,
} from '../engine/battleStrike'
import { battleNeighbors } from '../engine/battleland'
import type { BattleState, BattleUnit, GameCommand, GameState } from '../engine/types'
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
}

/** How close the battle is to turn-7 time-loss (0 early → 1 on turn 7). */
export function battleClockHeat(battle: BattleState): number {
  const denom = Math.max(1, MAX_BATTLE_TURNS - 1)
  return Math.pow((battle.turn - 1) / denom, 1.4)
}

export function turnsLeftOnClock(battle: BattleState): number {
  return Math.max(1, MAX_BATTLE_TURNS - battle.turn + 1)
}

export function actingAsAttacker(state: GameState, battle: BattleState): boolean {
  const atk = state.legions.find((l) => l.id === battle.attackerLegionId)
  return atk != null && battle.activePlayerId === atk.playerId
}

/** E[hits] for one strike (melee or rangestrike dice). */
export function expectedHits(
  state: GameState,
  attacker: BattleUnit,
  defender: BattleUnit,
  melee: boolean,
): number {
  const power = getUnitPower(state, attacker)
  const dice = melee ? power : Math.floor(power / 2)
  const need = getStrikeNumber(state, attacker, defender)
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
 */
export function evaluateBattleStrike(
  state: GameState,
  battle: BattleState,
  attacker: BattleUnit,
  defender: BattleUnit,
  profile: AiProfile,
): number {
  if (!attacker.hex || !defender.hex) return -Infinity
  const melee = isAdjacentHex(state, battle, attacker.hex, defender.hex)
  const eh = expectedHits(state, attacker, defender, melee)
  const rem = remainingHp(state, defender)
  if (rem <= 0) return -Infinity

  const heat = battleClockHeat(battle)
  const asAtk = actingAsAttacker(state, battle)
  // Attacker must finish before time-loss; amplify offense/kills as the clock runs down.
  // Defender still likes kills but less so when stalling wins the clock.
  const offenseMul = asAtk ? 1 + 1.4 * heat : 1 - 0.2 * heat

  const tv = targetValue(state, defender, profile)
  const dealt = Math.min(eh, rem)
  let score = dealt * tv * profile.attackAppetite * offenseMul

  if (eh >= rem) {
    const killMul = asAtk ? 1 + 2.5 * heat : 1 + 0.3 * heat
    score += 12 * tv * profile.attackAppetite * killMul
  }

  // Carry overflow onto other adjacent enemies
  if (melee && eh > rem) {
    const overflow = eh - rem
    const land = battleLand(state, battle)
    const others = battle.units.filter(
      (u) =>
        u.id !== defender.id &&
        u.playerId === defender.playerId &&
        isUnitAlive(state, u) &&
        u.hex &&
        battleNeighbors(land, attacker.hex!).includes(u.hex),
    )
    if (others.length > 0) {
      const bestOther = Math.max(...others.map((o) => targetValue(state, o, profile)))
      score += Math.min(overflow, 3) * bestOther * 0.35 * profile.attackAppetite * offenseMul
    }
  }

  return score
}

/** Score placing `unit` on `toHex` (offense − threat + approach ± clock). */
export function evaluateBattleHex(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
  toHex: string,
  profile: AiProfile,
): number {
  const land = battleLand(state, battle)
  const prevHex = unit.hex
  unit.hex = toHex
  try {
    const heat = battleClockHeat(battle)
    const asAtk = actingAsAttacker(state, battle)

    // Offense: best single strike available from this hex (Strike phase rules)
    const targetIds = findLegalStrikes(state, battle, land, unit, true)
    let offense = 0
    for (const tid of targetIds) {
      const def = battle.units.find((u) => u.id === tid)
      if (!def) continue
      offense = Math.max(offense, evaluateBattleStrike(state, battle, unit, def, profile))
    }

    // Threat: what enemies could do to us next strike phase
    let threat = 0
    const ownVal =
      unitPointValue(state, unit) + (unit.creatureType === 'Titan' ? profile.battleTitanValue : 0)
    const enemies = battle.units.filter(
      (e) => e.playerId !== unit.playerId && isUnitAlive(state, e) && e.hex,
    )
    for (const enemy of enemies) {
      const canHit = findLegalStrikes(state, battle, land, enemy, true).includes(unit.id)
      if (!canHit || !enemy.hex) continue
      const melee = battleNeighbors(land, enemy.hex).includes(toHex)
      const eh = expectedHits(state, enemy, unit, melee)
      threat += eh * ownVal * 0.15 * profile.fightLossPenalty
    }

    // Approach: still close when no contact yet
    let approach = 0
    let minDist = 99
    if (enemies.length > 0) {
      minDist = Math.min(...enemies.map((e) => (e.hex ? hexDistanceOnLand(land, toHex, e.hex) : 99)))
      approach = -minDist * profile.battleApproachEnemy
    }

    // Clock: attacker presses (more offense/approach, less fear); defender stalls (more fear, less approach)
    let offenseW = offense
    let threatW = threat
    let approachW = approach
    if (asAtk) {
      offenseW *= 1 + 1.2 * heat
      approachW *= 1 + 1.6 * heat
      threatW *= Math.max(0.25, 1 - 0.6 * heat)
      // Late: any contact is better than dancing out of range
      if (heat >= 0.55 && offense > 0) offenseW += 25 * heat
      if (heat >= 0.75 && minDist <= 1) approachW += 18 * heat
    } else {
      threatW *= 1 + 0.9 * heat
      approachW *= Math.max(0.15, 1 - 0.75 * heat)
      offenseW *= 1 - 0.15 * heat
      // Reward safer hexes when the clock already favors the defender
      if (heat >= 0.4 && threat === 0) offenseW += 8 * heat
    }

    return offenseW - threatW + approachW
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
    (u) => u.playerId === battle.activePlayerId && isUnitAlive(state, u) && !u.struck && u.hex,
  )
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
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}

export function pickBestBattleMove(
  state: GameState,
  battle: BattleState,
  profile: AiProfile,
  rng: () => number,
): GameCommand {
  const ranked = rankBattleMoves(state, battle, profile)
  if (ranked.length === 0) return { type: 'battleDonePhase' }

  const anyMoved = battle.units.some(
    (u) => u.playerId === battle.activePlayerId && isUnitAlive(state, u) && u.moved,
  )
  const best = ranked[0]!
  const heat = battleClockHeat(battle)
  const asAtk = actingAsAttacker(state, battle)

  // Attacker late: keep moving even on modest scores. Defender late: stop sooner if not improving.
  let threshold = profile.battleMoveThreshold
  if (asAtk) threshold -= 12 * heat
  else threshold += 6 * heat

  if (anyMoved && best.score <= threshold) {
    return { type: 'battleDonePhase' }
  }

  // Among top few near-best, slight rng for variety
  const top = ranked.filter((m) => m.score >= best.score - 0.5).slice(0, 3)
  const pick = top[Math.floor(rng() * top.length)]!
  return { type: 'battleMove', unitId: pick.unitId, toHex: pick.toHex }
}

export function pickBestBattleStrike(
  state: GameState,
  battle: BattleState,
  profile: AiProfile,
  rng: () => number,
): GameCommand {
  const ranked = rankBattleStrikes(state, battle, profile)
  if (ranked.length === 0) return { type: 'battleDonePhase' }
  const best = ranked[0]!
  const top = ranked.filter((s) => s.score >= best.score - 0.5).slice(0, 3)
  const pick = top[Math.floor(rng() * top.length)]!
  return {
    type: 'battleStrike',
    attackerId: pick.attackerId,
    defenderId: pick.defenderId,
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
