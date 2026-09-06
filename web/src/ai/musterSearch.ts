/**
 * Muster-only roll lookahead for one legion.
 * After this turn’s recruit, expect the best recruit over the next `moves`
 * rolls (each face 1–6 equally likely). Composition is updated so 2 Lions
 * → Lion → Griffon is visible.
 */
import { listMovePreview } from '../engine/movement'
import { bestRecruitAt } from '../engine/recruit'
import type { GameState, Legion } from '../engine/types'
import type { AiProfile } from './profiles'
import type { SpatialCache } from './boardSpatial'
import { creatureCombatValue } from './legionStrength'

/** Future turns are discounted; this turn’s recruit is scored separately. */
const MUSTER_DISCOUNT = 0.85
/** Move-and-muster cycles after the current landing. */
export const MUSTER_LOOKAHEAD_MOVES = 2

function compositionKey(legion: Legion): string {
  return legion.creatures
    .map((c) => c.type)
    .sort()
    .join(',')
}

function recruitValueAt(
  state: GameState,
  legion: Legion,
  hex: string,
  profile: AiProfile,
): { name: string | null; value: number } {
  const name = bestRecruitAt(state, legion, hex)
  if (!name) return { name: null, value: 0 }
  const value = Math.max(0, creatureCombatValue(state, name, hex)) * profile.recruitPreference
  return { name, value }
}

function withLegionOnHex(state: GameState, legion: Legion, hex: string): GameState {
  const ghost: Legion = { ...legion, hexLabel: hex, moved: false, teleported: false }
  return {
    ...state,
    legions: state.legions.map((l) => (l.id === legion.id ? ghost : l)),
  }
}

function applyRecruitGhost(
  state: GameState,
  legion: Legion,
  hex: string,
  recruit: string | null,
): { state: GameState; legion: Legion } {
  const onHex: Legion = { ...legion, hexLabel: hex, moved: false, teleported: false }
  if (!recruit || (state.caretaker[recruit] ?? 0) <= 0) {
    return { state: withLegionOnHex(state, onHex, hex), legion: onHex }
  }
  if (onHex.creatures.length >= 7) {
    return { state: withLegionOnHex(state, onHex, hex), legion: onHex }
  }
  const grown: Legion = {
    ...onHex,
    creatures: [...onHex.creatures, { type: recruit, hits: 0 }],
  }
  const next: GameState = {
    ...state,
    caretaker: { ...state.caretaker, [recruit]: (state.caretaker[recruit] ?? 0) - 1 },
    legions: state.legions.map((l) => (l.id === legion.id ? grown : l)),
  }
  return { state: next, legion: grown }
}

function enemyOn(state: GameState, hex: string, playerId: string): boolean {
  return state.legions.some((l) => l.hexLabel === hex && l.playerId !== playerId)
}

export type MusterSearchOpts = {
  cache?: SpatialCache
  /** If set, a winning fight on a dest is a terminal alternative to recruiting. */
  fightValue?: (state: GameState, legion: Legion, hex: string) => number
}

/**
 * Expected value of `moves` future move cycles, starting from a legion that
 * already landed on `hex` and already took this turn’s recruit.
 */
export function expectedFutureMuster(
  state: GameState,
  legion: Legion,
  hex: string,
  profile: AiProfile,
  moves: number = MUSTER_LOOKAHEAD_MOVES,
  opts: MusterSearchOpts = {},
): number {
  if (moves <= 0) return 0
  const fightTag = opts.fightValue ? 'F' : 'M'
  const memo = opts.cache?.musterMemo
  const key = `${legion.id}|${compositionKey(legion)}|${hex}|${moves}|${fightTag}`
  const hit = memo?.get(key)
  if (hit != null) return hit

  const here: Legion = { ...legion, hexLabel: hex, moved: false, teleported: false }
  const preview = withLegionOnHex(state, here, hex)
  let sum = 0
  for (let roll = 1; roll <= 6; roll++) {
    let best = 0
    for (const [dest] of listMovePreview(preview, here, roll)) {
      if (enemyOn(preview, dest, here.playerId)) {
        if (opts.fightValue) {
          const fight = opts.fightValue(preview, here, dest)
          if (fight > best) best = fight
        }
        continue
      }
      const { name, value } = recruitValueAt(preview, here, dest, profile)
      const grown = applyRecruitGhost(preview, here, dest, name)
      const later = expectedFutureMuster(
        grown.state,
        grown.legion,
        dest,
        profile,
        moves - 1,
        opts,
      )
      const total = value + MUSTER_DISCOUNT * later
      if (total > best) best = total
    }
    sum += best
  }
  const ev = sum / 6
  memo?.set(key, ev)
  return ev
}

/** This-turn recruit applied, then future EV from that grown stack. */
export function lookaheadMusterBonus(
  state: GameState,
  legion: Legion,
  hex: string,
  profile: AiProfile,
  opts: MusterSearchOpts = {},
): number {
  if (enemyOn(state, hex, legion.playerId)) return 0
  const { name } = recruitValueAt(state, legion, hex, profile)
  const grown = applyRecruitGhost(state, legion, hex, name)
  return expectedFutureMuster(
    grown.state,
    grown.legion,
    hex,
    profile,
    MUSTER_LOOKAHEAD_MOVES,
    opts,
  )
}
