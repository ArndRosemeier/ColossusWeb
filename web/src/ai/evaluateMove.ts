import { bestRecruitAt } from '../engine/recruit'
import { listAllMoves, listNormalMoveHexes } from '../engine/movement'
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

export type ScoredMove = {
  legionId: string
  hex: string
  teleport: boolean
  score: number
  /** Bonus applied because this legion shares a hex and must separate. */
  forcedSplit: boolean
}

/**
 * Score moving `legion` onto `hex` (fight + recruit + light terrain preference).
 * Sitting still is the zero baseline — only moves with positive score are attractive.
 * By default (balanced/expander) muster value outweighs routine attacks.
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

  if (enemy) {
    score += scoreFight(state, legion, enemy, hex, profile)
  } else {
    // Empty hex: small preference to leave towers / expand
    const terrain = state.variant.board.hexByLabel[hex]?.terrain
    if (terrain && terrain !== 'Tower') score += 2
    if (terrain === 'Tower' && state.variant.board.hexByLabel[legion.hexLabel]?.terrain === 'Tower') {
      score -= 1
    }
  }

  // Muster value if this legion ends here (moved)
  const recruit = bestRecruitAt(state, legion, hex)
  if (recruit) {
    const recruitVal = creatureCombatValue(state, recruit, hex)
    score += Math.max(0, recruitVal) * profile.recruitPreference
  }

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
    const conventional = listNormalMoveHexes(state, leg, state.movementRoll)
    for (const [hex, info] of moves) {
      let score = evaluateDestination(state, leg, hex, profile)
      if (info.teleport) score += 3
      const forcedSplit = stacked && conventional.has(hex)
      // Prefer separating co-located split stacks (Colossus forced split moves)
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
