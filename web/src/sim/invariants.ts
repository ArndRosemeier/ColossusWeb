import type { GameState } from '../engine/types'

export type InvariantViolation = {
  code: string
  detail: string
}

/** Cheap fingerprint for stuck-state detection */
export function stateFingerprint(state: GameState): string {
  const legs = state.legions
    .map((l) => `${l.id}@${l.hexLabel}:${l.creatures.map((c) => c.type).join(',')}:${l.moved ? 1 : 0}`)
    .sort()
    .join('|')
  const battle = state.battle
    ? `${state.battle.phase}:${state.battle.turn}:${state.battle.activeHalf}:${state.battle.activePlayerId}:${state.battle.units
        .map((u) => `${u.id}@${u.hex}:${u.hits}`)
        .join(';')}`
    : '-'
  return [
    state.phase,
    state.turnNumber,
    state.activePlayerIndex,
    state.movementRoll ?? '-',
    state.pendingEngagements.length,
    battle,
    legs,
  ].join('::')
}

export function checkInvariants(state: GameState): InvariantViolation[] {
  const violations: InvariantViolation[] = []

  for (const [name, count] of Object.entries(state.caretaker)) {
    if (count < 0) {
      violations.push({ code: 'negative_caretaker', detail: `${name}=${count}` })
    }
  }

  const activeId = state.players[state.activePlayerIndex]?.id
  for (const leg of state.legions) {
    if (leg.creatures.length === 0) {
      violations.push({ code: 'empty_legion', detail: leg.markerId })
    }
    if (leg.creatures.length > 8) {
      violations.push({ code: 'legion_too_tall', detail: `${leg.markerId} height ${leg.creatures.length}` })
    }
    // Other players may still hold the opening 8-high stack until their Split phase.
    if (
      state.phase !== 'Split' &&
      leg.playerId === activeId &&
      leg.creatures.length > 7
    ) {
      violations.push({
        code: 'legion_over_7_outside_split',
        detail: `${leg.markerId} height ${leg.creatures.length} in ${state.phase}`,
      })
    }
  }

  for (const player of state.players) {
    if (player.dead) continue
    const titans = state.legions
      .filter((l) => l.playerId === player.id)
      .flatMap((l) => l.creatures)
      .filter((c) => c.type === 'Titan')
    if (titans.length !== 1) {
      violations.push({
        code: 'titan_count',
        detail: `${player.name} has ${titans.length} Titan(s)`,
      })
    }
  }

  if (state.phase === 'Muster') {
    const byHex = new Map<string, typeof state.legions>()
    for (const leg of state.legions) {
      const list = byHex.get(leg.hexLabel) ?? []
      list.push(leg)
      byHex.set(leg.hexLabel, list)
    }
    for (const [hex, list] of byHex) {
      const players = new Set(list.map((l) => l.playerId))
      if (players.size > 1) {
        violations.push({
          code: 'unresolved_engagement',
          detail: `hex ${hex} still has enemy stacks in Muster`,
        })
      }
    }
  }

  for (const p of state.players) {
    if (!Number.isFinite(p.score) || p.score < 0) {
      violations.push({ code: 'bad_score', detail: `${p.name} score=${p.score}` })
    }
  }

  return violations
}
