/**
 * Shared engagement AI decisions (flee) used by simpleAi and GameEngine auto-resolve.
 */
import { canFlee } from '../engine/engagement'
import type { GameState } from '../engine/types'
import { estimateBattleOutcome } from './battleEstimate'
import { profileFor } from './profiles'

/** True when an active engagement waits on a human (attacker and/or defender). */
export function engagementNeedsHumanInput(state: GameState): boolean {
  const eng = state.activeEngagement
  if (!eng) return false
  if (state.battle && !state.battle.done) return false
  const attacker = state.legions.find((l) => l.id === eng.attackerId)
  const defender = state.legions.find((l) => l.id === eng.defenderId)
  if (!attacker || !defender) return false
  const atkP = state.players.find((p) => p.id === attacker.playerId)
  const defP = state.players.find((p) => p.id === defender.playerId)
  return Boolean(
    (atkP && atkP.kind === 'human' && !atkP.dead) ||
      (defP && defP.kind === 'human' && !defP.dead),
  )
}

/** Whether the AI defender should flee this engagement. */
export function aiDefenderShouldFlee(state: GameState): boolean {
  const eng = state.activeEngagement
  if (!eng) return false
  const attacker = state.legions.find((l) => l.id === eng.attackerId)
  const defender = state.legions.find((l) => l.id === eng.defenderId)
  if (!attacker || !defender) return false
  const defPlayer = state.players.find((p) => p.id === defender.playerId)
  if (!defPlayer || defPlayer.kind !== 'ai' || defPlayer.dead) return false
  if (!canFlee(state, defender)) return false
  const defProfile = profileFor(defPlayer.aiProfileId)
  if (defProfile.fleeOutnumberRatio <= 0) return false
  const { outcome, ratio } = estimateBattleOutcome(
    state,
    attacker,
    defender,
    defender.hexLabel,
  )
  const heightRatio = attacker.creatures.length / Math.max(1, defender.creatures.length)
  const attackerCrushing =
    outcome === 'winMinimal' ||
    outcome === 'winHeavy' ||
    (outcome === 'draw' && defProfile.id === 'cautious')
  return (
    attackerCrushing ||
    heightRatio >= defProfile.fleeOutnumberRatio ||
    ratio >= defProfile.fleeOutnumberRatio
  )
}
