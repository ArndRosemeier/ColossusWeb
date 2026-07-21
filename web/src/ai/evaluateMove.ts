import { bestRecruitAt } from '../engine/recruit'
import { listAllMoves } from '../engine/movement'
import type { GateType, MasterHex } from '../types/variant'
import type { GameCommand, GameState, Legion } from '../engine/types'
import type { AiProfile } from './profiles'
import {
  LOSE_LEGION_SCORE,
  estimateBattleOutcome,
  legionHasTitan,
  legionPointValue,
  type BattleOutcome,
} from './battleEstimate'
import { creatureCombatValue } from './legionStrength'

/** Per legal first-step exit when starting a move from the destination (tiebreaker). */
const MOBILITY_PER_EXIT = 0.25
/** Per other friendly legion within 1 hex (tiebreaker). */
const FRIEND_ADJACENT = 0.4
/** Per other friendly legion at distance 2 (tiebreaker). */
const FRIEND_NEAR = 0.15

export type ScoredMove = {
  legionId: string
  hex: string
  teleport: boolean
  score: number
  /** Bonus applied because this legion shares a hex and must separate. */
  forcedSplit: boolean
}

function isOpenExit(t: GateType): boolean {
  return t === 'ARCH' || t === 'ARROW' || t === 'ARROWS'
}

/**
 * How many first-step directions a legion can take when starting a move from this hex.
 * Matches Movement.findNormalMoves with cameFrom = nowhere: a BLOCK forces one exit;
 * otherwise every ARCH+ side with a neighbor counts (towers typically 3).
 */
export function startExitCount(hex: MasterHex): number {
  const blockSide = hex.exitType.findIndex((t) => t === 'BLOCK')
  if (blockSide >= 0) return hex.neighbors[blockSide] ? 1 : 0
  let n = 0
  for (let i = 0; i < 6; i++) {
    if (isOpenExit(hex.exitType[i]) && hex.neighbors[i]) n++
  }
  return n
}

/**
 * Small positional extras: exit freedom + nearby friendly stacks.
 * Kept tiny so fights / recruits still dominate.
 */
export function locationTiebreakScore(
  state: GameState,
  legion: Legion,
  hexLabel: string,
): number {
  const board = state.variant.board
  const hex = board.hexByLabel[hexLabel]
  if (!hex) return 0

  let score = startExitCount(hex) * MOBILITY_PER_EXIT

  const visited = new Set<string>([hexLabel])
  let frontier = [hexLabel]
  for (let dist = 1; dist <= 2; dist++) {
    const next: string[] = []
    for (const cur of frontier) {
      const h = board.hexByLabel[cur]
      if (!h) continue
      for (const n of h.neighbors) {
        if (n == null || visited.has(n)) continue
        visited.add(n)
        next.push(n)
        const friendsHere = state.legions.filter(
          (l) => l.hexLabel === n && l.playerId === legion.playerId && l.id !== legion.id,
        ).length
        if (friendsHere > 0) {
          score += friendsHere * (dist === 1 ? FRIEND_ADJACENT : FRIEND_NEAR)
        }
      }
    }
    frontier = next
  }

  return score
}

/**
 * Score moving `legion` onto `hex` (fight + recruit + light terrain preference).
 * Sitting still is the zero baseline — only moves with positive score are attractive.
 * Walk and teleport destinations use the same scorer.
 */
export function evaluateDestination(
  state: GameState,
  legion: Legion,
  hex: string,
  profile: AiProfile,
): number {
  let score = 0
  const playerId = legion.playerId
  const enemy = state.legions.find((l) => l.hexLabel === hex && l.playerId !== playerId)
  const toTerrain = state.variant.board.hexByLabel[hex]?.terrain

  if (enemy) {
    score += scoreFight(state, legion, enemy, hex, profile)
  } else if (toTerrain && toTerrain !== 'Tower') {
    // Empty non-tower: slight expansion preference
    score += 2
  }

  // Muster value if this legion ends here (moved)
  const recruit = bestRecruitAt(state, legion, hex)
  if (recruit) {
    // Location-aware combat value (home turf); bestRecruitAt picks which creature
    const recruitVal = Math.max(0, creatureCombatValue(state, recruit, hex))
    score += recruitVal * profile.recruitPreference
  }

  score += locationTiebreakScore(state, legion, hex)

  return score
}

function scoreFight(
  state: GameState,
  attacker: Legion,
  defender: Legion,
  hex: string,
  profile: AiProfile,
): number {
  const { outcome } = estimateBattleOutcome(state, attacker, defender, hex)
  const enemyPv = legionPointValue(state, defender)
  const ownPv = legionPointValue(state, attacker)
  const hasTitan = legionHasTitan(attacker)
  const enemyHasTitan = legionHasTitan(defender)
  const livingPlayers = state.players.filter((p) => !p.dead).length
  const appetite = profile.attackAppetite
  const lossMul = profile.fightLossPenalty

  /** Titan kill / fat stack — worth fighting even for growth-focused AIs. */
  const juicy = enemyHasTitan || enemyPv >= ownPv * 0.85 || enemyPv >= 40

  switch (outcome) {
    case 'winMinimal': {
      let s = 0.4 * enemyPv * appetite
      s += profile.preferAttackWeight * 0.1 * appetite
      if (enemyHasTitan) s += 500
      else if (!juicy) s *= 0.55 // routine mop-ups are less attractive than recruiting
      return s
    }
    case 'winHeavy': {
      if (hasTitan) {
        if (enemyHasTitan && livingPlayers === 2) return enemyPv * appetite
        return (LOSE_LEGION_SCORE + 10) * lossMul
      }
      // Lossy win: usually worse than growing unless the target is juicy
      let s = (0.25 * enemyPv - 0.35 * ownPv) * appetite
      s += profile.preferAttackWeight * 0.05 * appetite
      if (enemyHasTitan) s += 200
      else if (!juicy) s *= 0.4
      return s
    }
    case 'draw':
      return (LOSE_LEGION_SCORE + 5 + profile.attackEvenIfWeakerBonus) * lossMul
    case 'loseHeavy':
      return (LOSE_LEGION_SCORE + 2 + profile.attackEvenIfWeakerBonus) * lossMul
    case 'lose':
      return (LOSE_LEGION_SCORE + profile.attackEvenIfWeakerBonus) * lossMul
    default: {
      const _exhaustive: never = outcome
      return _exhaustive
    }
  }
}

/** Rank all legal moves for the active player's unmoved legions. */
export function rankMoves(state: GameState, profile: AiProfile): ScoredMove[] {
  if (state.movementRoll == null) return []
  const playerId = state.players[state.activePlayerIndex].id
  const legs = state.legions.filter((l) => l.playerId === playerId && !l.moved)
  const scored: ScoredMove[] = []
  for (const leg of legs) {
    const stacked =
      state.legions.filter((l) => l.playerId === playerId && l.hexLabel === leg.hexLabel)
        .length > 1
    const moves = listAllMoves(state, leg, state.movementRoll)
    for (const [hex, info] of moves) {
      let score = evaluateDestination(state, leg, hex, profile)
      // Any legal leave from a shared hex separates co-located stacks (walk or teleport).
      const forcedSplit = stacked && hex !== leg.hexLabel
      if (forcedSplit) score += 80
      scored.push({
        legionId: leg.id,
        hex,
        teleport: info.teleport,
        score,
        forcedSplit,
      })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}

/**
 * Pick the best move this turn, or doneMove when nothing beats sitting still enough.
 */
export function pickBestMove(
  state: GameState,
  profile: AiProfile,
  rng: () => number,
  anyMoved: boolean,
): GameCommand {
  const ranked = rankMoves(state, profile)
  if (ranked.length === 0) return { type: 'doneMove' }

  const forced = ranked.filter((m) => m.forcedSplit)
  if (forced.length > 0) {
    const bestForced = forced[0]!
    return {
      type: 'move',
      legionId: bestForced.legionId,
      toHex: bestForced.hex,
      teleport: bestForced.teleport,
    }
  }

  const best = ranked[0]!
  if (best.score >= profile.strongMoveThreshold) {
    return {
      type: 'move',
      legionId: best.legionId,
      toHex: best.hex,
      teleport: best.teleport,
    }
  }

  // Modest gains: still move at least one legion, then maybe continue
  if (!anyMoved || (best.score > 0 && rng() < profile.continueMovingChance)) {
    const pool = ranked.filter((m) => m.score > 0)
    const pickFrom = pool.length > 0 ? pool : ranked
    const c = pickFrom[Math.min(pickFrom.length - 1, Math.floor(rng() * Math.min(3, pickFrom.length)))]!
    return {
      type: 'move',
      legionId: c.legionId,
      toHex: c.hex,
      teleport: c.teleport,
    }
  }

  return { type: 'doneMove' }
}

export function outcomeLabel(outcome: BattleOutcome): string {
  return outcome
}
