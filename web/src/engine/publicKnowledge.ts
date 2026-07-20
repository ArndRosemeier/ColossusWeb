/**
 * Public (partial) knowledge of legion contents — Colossus PredictSplits lite.
 * AI still uses true `creatures`; humans see `knownPublic` + unknown slots.
 */
import type { GameState, Legion } from './types'
import {
  buildRecruitEdges,
  NO_RECRUIT,
  numberOfRecruiterNeeded,
} from './recruit'

/** One visible slot when inspecting a legion (known type or unknown). */
export type PublicSlot = { kind: 'known'; type: string } | { kind: 'unknown' }

export function revealCreatures(legion: Legion, types: string[]): void {
  for (const t of types) {
    const knownCount = legion.knownPublic.filter((x) => x === t).length
    const actualCount = legion.creatures.filter((c) => c.type === t).length
    if (knownCount < actualCount) {
      legion.knownPublic.push(t)
    }
  }
}

/** Entire contents become public (battle start, survivors, engagement reveal). */
export function revealAll(legion: Legion): void {
  legion.knownPublic = legion.creatures.map((c) => c.type)
}

/** Split clears public knowledge for both stacks. */
export function clearPublicKnowledge(legion: Legion): void {
  legion.knownPublic = []
}

/**
 * Recruiter types that become public when `recruit` is mustered
 * (Colossus didRecruit → reveal N recruiters, then the recruit).
 * Anonymous Anything/0 edges reveal nothing.
 */
export function recruitersRevealedFor(
  state: GameState,
  legion: Legion,
  recruit: string,
): string[] {
  const hex = state.variant.board.hexByLabel[legion.hexLabel]
  if (!hex) return []
  const terrain = state.variant.terrains[hex.terrain]
  if (!terrain) return []
  const creatures = state.variant.creatures
  const edges = buildRecruitEdges(terrain)

  // Anonymous tower basics: Anything → recruit with 0
  if (edges.some((e) => e.to === recruit && e.from === 'Anything' && e.number === 0)) {
    return []
  }

  for (const c of legion.creatures) {
    const needed = numberOfRecruiterNeeded(terrain, c.type, recruit, creatures)
    if (needed >= NO_RECRUIT) continue
    if (legion.creatures.filter((x) => x.type === c.type).length < needed) continue
    if (needed === 0) return []
    return Array.from({ length: needed }, () => c.type)
  }
  return []
}

/** Apply muster public reveal: recruiters (if any) + the new creature. */
export function revealRecruit(state: GameState, legion: Legion, recruit: string): void {
  revealCreatures(legion, [...recruitersRevealedFor(state, legion, recruit), recruit])
}

/**
 * What a spectator / opponent should see.
 * Human-owned legions are always shown in full (owner knowledge).
 */
export function publicViewSlots(
  state: GameState,
  legion: Legion,
): PublicSlot[] {
  const owner = state.players.find((p) => p.id === legion.playerId)
  if (owner?.kind === 'human') {
    return legion.creatures.map((c) => ({ kind: 'known' as const, type: c.type }))
  }
  const known = [...legion.knownPublic]
  // Drop known entries that no longer exist (should be rare; keep multiset consistent)
  const remaining = legion.creatures.map((c) => c.type)
  const shown: PublicSlot[] = []
  for (const t of known) {
    const idx = remaining.indexOf(t)
    if (idx >= 0) {
      remaining.splice(idx, 1)
      shown.push({ kind: 'known', type: t })
    }
  }
  for (let i = 0; i < remaining.length; i++) {
    shown.push({ kind: 'unknown' })
  }
  return shown
}

export function formatPublicContents(state: GameState, legion: Legion): string {
  return publicViewSlots(state, legion)
    .map((s) => (s.kind === 'known' ? s.type : '?'))
    .join(', ')
}
