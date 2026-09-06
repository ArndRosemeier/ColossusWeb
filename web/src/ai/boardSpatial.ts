/**
 * Masterboard spatial heuristics — next-turn options, incoming threat,
 * and gate-aware friendly support. Used by evaluateDestination.
 *
 * These are derived quantities (reach, battle estimate, combat value),
 * not personality knobs.
 */
import { listMovePreview } from '../engine/movement'
import type { GateType, MasterHex } from '../types/variant'
import type { GameState, Legion } from '../engine/types'
import { estimateBattleOutcome, legionHasTitan, legionPointValue } from './battleEstimate'
import { legionCombatValue } from './legionStrength'

/** Next roll is uncertain — keep next-turn EV well below an immediate muster. */
const NEXT_TURN_SHARE = 0.28
/** Penalty scale when an enemy who can reach us would win the engagement. */
const THREAT_WIN_MUL = 1.4
/** Extra scale when the threatened stack has our Titan. */
const THREAT_TITAN_MUL = 6
const SUPPORT_ADJ = 0.12
const SUPPORT_NEAR = 0.05
const SUPPORT_TITAN_MUL = 1.6

export type SpatialCache = {
  /** legionId → destHex → how many rolls 1–6 can land there */
  reachCounts: Map<string, Map<string, number>>
  nextTurnMemo: Map<string, number>
  musterMemo: Map<string, number>
}

function isOpenExit(t: GateType): boolean {
  return t === 'ARCH' || t === 'ARROW' || t === 'ARROWS'
}

/** First-step legal exits from a hex (BLOCK forces that one side). */
export function legalFirstExits(hex: MasterHex): string[] {
  const blockSide = hex.exitType.findIndex((t) => t === 'BLOCK')
  if (blockSide >= 0) {
    const n = hex.neighbors[blockSide]
    return n ? [n] : []
  }
  const out: string[] = []
  for (let i = 0; i < 6; i++) {
    if (isOpenExit(hex.exitType[i]) && hex.neighbors[i]) out.push(hex.neighbors[i]!)
  }
  return out
}

export function buildSpatialCache(state: GameState): SpatialCache {
  const reachCounts = new Map<string, Map<string, number>>()
  for (const leg of state.legions) {
    const counts = new Map<string, number>()
    for (let roll = 1; roll <= 6; roll++) {
      for (const [hex] of listMovePreview(state, leg, roll)) {
        counts.set(hex, (counts.get(hex) ?? 0) + 1)
      }
    }
    reachCounts.set(leg.id, counts)
  }
  return { reachCounts, nextTurnMemo: new Map(), musterMemo: new Map() }
}

function cacheOf(state: GameState, cache: SpatialCache | undefined): SpatialCache {
  return cache ?? buildSpatialCache(state)
}

/**
 * Expected value of the best hex this legion could reach next turn from `fromHex`,
 * discounted because the roll is unknown. `immediateValue` must not recurse
 * into spatial terms.
 */
export function nextTurnOptionValue(
  state: GameState,
  legion: Legion,
  fromHex: string,
  immediateValue: (hex: string) => number,
  cache?: SpatialCache,
): number {
  const ctx = cacheOf(state, cache)
  const key = `${legion.id}@${fromHex}`
  const hit = ctx.nextTurnMemo.get(key)
  if (hit != null) return hit

  const ghost: Legion = { ...legion, hexLabel: fromHex, moved: false, teleported: false }
  const previewState: GameState = {
    ...state,
    legions: state.legions.map((l) => (l.id === legion.id ? ghost : l)),
  }
  let sum = 0
  for (let roll = 1; roll <= 6; roll++) {
    let best = 0
    for (const [hex] of listMovePreview(previewState, ghost, roll)) {
      const v = immediateValue(hex)
      if (v > best) best = v
    }
    sum += best
  }
  const value = (sum / 6) * NEXT_TURN_SHARE
  ctx.nextTurnMemo.set(key, value)
  return value
}

/**
 * Penalty for ending where an enemy can land next and would win the fight.
 * Enemies already on `hex` are the engagement itself — skip those.
 */
export function incomingThreatScore(
  state: GameState,
  legion: Legion,
  hex: string,
  cache?: SpatialCache,
): number {
  const ctx = cacheOf(state, cache)
  const ghost: Legion = { ...legion, hexLabel: hex }
  const hasTitan = legionHasTitan(legion)
  const ourPv = Math.max(1, legionPointValue(state, ghost))
  let threat = 0

  for (const enemy of state.legions) {
    if (enemy.playerId === legion.playerId) continue
    if (enemy.hexLabel === hex) continue
    const rolls = ctx.reachCounts.get(enemy.id)?.get(hex) ?? 0
    if (rolls <= 0) continue
    const { outcome } = estimateBattleOutcome(state, enemy, ghost, hex)
    if (outcome !== 'winMinimal' && outcome !== 'winHeavy') continue
    const p = rolls / 6
    const mul = hasTitan ? THREAT_TITAN_MUL : THREAT_WIN_MUL
    threat += ourPv * p * mul
  }
  return threat
}

/**
 * Friends one or two *legal* exits away (gates, not raw adjacency).
 * Weighted by their combat value on this hex; Titan stacks want escorts more.
 */
export function gateAwareSupportScore(
  state: GameState,
  legion: Legion,
  hexLabel: string,
): number {
  const board = state.variant.board
  const start = board.hexByLabel[hexLabel]
  if (!start) return 0

  const hasTitan = legionHasTitan(legion)
  const titanMul = hasTitan ? SUPPORT_TITAN_MUL : 1
  let score = 0

  const visited = new Set<string>([hexLabel])
  let frontier = [hexLabel]
  for (let dist = 1; dist <= 2; dist++) {
    const next: string[] = []
    for (const cur of frontier) {
      const h = board.hexByLabel[cur]
      if (!h) continue
      for (const n of legalFirstExits(h)) {
        if (visited.has(n)) continue
        visited.add(n)
        next.push(n)
        for (const friend of state.legions) {
          if (friend.playerId !== legion.playerId || friend.id === legion.id) continue
          if (friend.hexLabel !== n) continue
          const val = legionCombatValue(state, friend, hexLabel, 'defend')
          score += val * (dist === 1 ? SUPPORT_ADJ : SUPPORT_NEAR) * titanMul
        }
      }
    }
    frontier = next
  }
  return score
}

export function spatialScore(
  state: GameState,
  legion: Legion,
  hex: string,
  immediateValue: (dest: string) => number,
  cache?: SpatialCache,
  opts: { skipNextTurn?: boolean } = {},
): number {
  const support = gateAwareSupportScore(state, legion, hex)
  const threat = incomingThreatScore(state, legion, hex, cache)
  const options = opts.skipNextTurn
    ? 0
    : nextTurnOptionValue(state, legion, hex, immediateValue, cache)
  return support + options - threat
}
