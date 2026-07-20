/**
 * Pre-battle engagement resolution (Colossus GameServerSide flee / concede / negotiate).
 */
import type { GameState, Legion } from './types'
import { isLord } from './recruit'
import { revealAll } from './publicKnowledge'

export function legionPointValue(state: GameState, legion: Legion, full: boolean): number {
  let pts = 0
  for (const c of legion.creatures) {
    const t = state.variant.creatures[c.type]
    if (!t) continue
    const power =
      c.type === 'Titan'
        ? (state.players.find((p) => p.id === legion.playerId)?.titanPower ?? 6)
        : t.power
    const value = power * t.skill
    pts += full ? value : Math.floor(value / 2)
  }
  return pts
}

export function canFlee(state: GameState, defender: Legion): boolean {
  return !defender.creatures.some((c) => isLord(state.variant.creatures, c.type))
}

export function eliminateLegionToCaretaker(state: GameState, legion: Legion): void {
  for (const c of legion.creatures) {
    state.caretaker[c.type] = (state.caretaker[c.type] ?? 0) + 1
  }
  const owner = state.players.find((p) => p.id === legion.playerId)
  if (owner && !owner.markersAvailable.includes(legion.markerId)) {
    owner.markersAvailable.push(legion.markerId)
  }
  state.legions = state.legions.filter((l) => l.id !== legion.id)
}

/**
 * Resolve engagement without battle.
 * flee=true → half points to winner; concede/agree with full wipe → full points.
 */
export function resolveEngagementConcession(
  state: GameState,
  loser: Legion,
  winner: Legion,
  halfPoints: boolean,
): void {
  const winnerPlayer = state.players.find((p) => p.id === winner.playerId)
  if (!winnerPlayer) return
  const scoreBefore = winnerPlayer.score
  winnerPlayer.score += legionPointValue(state, loser, !halfPoints)
  // Angels only on full combat/concede wins that cross thresholds — flee denies summon;
  // score angels still allowed on flee per Titan? Colossus: flee half, no summon angel mid-battle;
  // score angels from points still apply. Keep acquire on score.
  revealAll(loser)
  eliminateLegionToCaretaker(state, loser)
  void scoreBefore
}

export type AgreementKind = 'attackerDies' | 'defenderDies' | 'mutual'

export function resolveAgreement(
  state: GameState,
  attacker: Legion,
  defender: Legion,
  kind: AgreementKind,
): void {
  if (kind === 'mutual') {
    eliminateLegionToCaretaker(state, attacker)
    eliminateLegionToCaretaker(state, defender)
    state.log.push('Agreement: mutual elimination (0 points)')
    return
  }
  if (kind === 'attackerDies') {
    const pts = legionPointValue(state, attacker, true)
    const defPlayer = state.players.find((p) => p.id === defender.playerId)!
    defPlayer.score += pts
    eliminateLegionToCaretaker(state, attacker)
    state.log.push(`Agreement: ${attacker.markerId} eliminated (${pts} points to defender)`)
    return
  }
  const pts = legionPointValue(state, defender, true)
  const atkPlayer = state.players.find((p) => p.id === attacker.playerId)!
  atkPlayer.score += pts
  eliminateLegionToCaretaker(state, defender)
  state.log.push(`Agreement: ${defender.markerId} eliminated (${pts} points to attacker)`)
}
