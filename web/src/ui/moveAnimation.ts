/**
 * Shared move-animation timing + active-anim descriptors for board overlays.
 */
import type { AiSpeedId } from './aiSpeed'
import type { GameState, GameCommand } from '../engine/types'
import { getUnitPower, getUnitSkill } from '../engine/battle'
import { battleMovePathInfo, masterMovePathInfo } from '../engine/movePath'

export type Point = { x: number; y: number }

export type MasterMoveAnim = {
  board: 'master'
  pieceId: string
  pathLabels: string[]
  teleport: boolean
  durationMs: number
  markerId: string
  count: number
}

export type BattleMoveAnim = {
  board: 'battle'
  pieceId: string
  pathLabels: string[]
  teleport: false
  fromOffBoard: boolean
  durationMs: number
  creatureType: string
  power: number
  skill: number
  baseColor?: string
  hits: number
}

export type MoveAnim = MasterMoveAnim | BattleMoveAnim

const EASE = (t: number) => t * t * (3 - 2 * t)

/** Position along polyline by normalized progress 0–1. */
export function pointAlongPath(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1 || t <= 0) return points[0]
  if (t >= 1) return points[points.length - 1]

  const segs: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const len = Math.hypot(dx, dy)
    segs.push(len)
    total += len
  }
  if (total <= 0) return points[points.length - 1]

  let dist = EASE(t) * total
  for (let i = 0; i < segs.length; i++) {
    if (dist <= segs[i] || i === segs.length - 1) {
      const u = segs[i] <= 0 ? 1 : dist / segs[i]
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * u,
        y: points[i].y + (points[i + 1].y - points[i].y) * u,
      }
    }
    dist -= segs[i]
  }
  return points[points.length - 1]
}

/** Trail polyline from start through current progress. */
export function trailPoints(points: Point[], t: number): Point[] {
  if (points.length === 0) return []
  if (t <= 0) return [points[0]]
  const cur = pointAlongPath(points, t)
  if (t >= 1) return [...points]
  const eased = EASE(t)
  const segs: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    segs.push(len)
    total += len
  }
  if (total <= 0) return [points[0], cur]
  let dist = eased * total
  const out: Point[] = [points[0]]
  for (let i = 0; i < segs.length; i++) {
    if (dist <= segs[i]) {
      out.push(cur)
      return out
    }
    dist -= segs[i]
    out.push(points[i + 1])
  }
  out.push(cur)
  return out
}

export function teleportOpacity(t: number): { origin: number; ghost: number } {
  // Fade out origin 0–0.4, ghost appears 0.45–1 at destination
  if (t < 0.4) return { origin: 1 - t / 0.4, ghost: 0 }
  if (t < 0.45) return { origin: 0, ghost: 0 }
  return { origin: 0, ghost: (t - 0.45) / 0.55 }
}

function speedFactor(aiSpeed: AiSpeedId, forAi: boolean): number {
  if (!forAi) return 1
  switch (aiSpeed) {
    case 'paused':
      return 1
    case 'slow':
      return 1
    case 'normal':
      return 0.72
    case 'fast':
      return 0.48
    case 'instant':
      return 0
  }
}

export function moveAnimDurationMs(
  pathLen: number,
  opts: { teleport: boolean; aiSpeed: AiSpeedId; forAi: boolean },
): number {
  const factor = speedFactor(opts.aiSpeed, opts.forAi)
  if (factor === 0) return 0
  if (opts.teleport) return Math.round(320 * factor)
  const steps = Math.max(1, pathLen - 1)
  const raw = 70 + steps * 85
  return Math.round(Math.min(520, Math.max(220, raw)) * factor)
}

export function shouldSkipMoveAnim(aiSpeed: AiSpeedId, forAi: boolean): boolean {
  if (forAi && aiSpeed === 'instant') return true
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return true
  }
  return false
}

export function buildMoveAnim(
  state: GameState,
  cmd: GameCommand,
  opts: { aiSpeed: AiSpeedId; forAi: boolean },
): MoveAnim | null {
  if (cmd.type === 'move') {
    const legion = state.legions.find((l) => l.id === cmd.legionId)
    if (!legion || state.movementRoll == null) return null
    const info = masterMovePathInfo(state, legion, state.movementRoll, cmd.toHex, cmd.teleport)
    const durationMs = moveAnimDurationMs(info.path.length, {
      teleport: info.teleport,
      aiSpeed: opts.aiSpeed,
      forAi: opts.forAi,
    })
    if (durationMs <= 0) return null
    return {
      board: 'master',
      pieceId: legion.id,
      pathLabels: info.path,
      teleport: info.teleport,
      durationMs,
      markerId: legion.markerId,
      count: legion.creatures.length,
    }
  }
  if (cmd.type === 'battleMove') {
    const battle = state.battle
    if (!battle || battle.done) return null
    const unit = battle.units.find((u) => u.id === cmd.unitId)
    if (!unit) return null
    const info = battleMovePathInfo(state, battle, unit, cmd.toHex)
    const durationMs = moveAnimDurationMs(info.path.length, {
      teleport: false,
      aiSpeed: opts.aiSpeed,
      forAi: opts.forAi,
    })
    if (durationMs <= 0) return null
    const t = state.variant.creatures[unit.creatureType]
    return {
      board: 'battle',
      pieceId: unit.id,
      pathLabels: info.path,
      teleport: false,
      fromOffBoard: info.fromOffBoard,
      durationMs,
      creatureType: unit.creatureType,
      power: getUnitPower(state, unit),
      skill: getUnitSkill(state, unit),
      baseColor: t?.baseColor,
      hits: unit.hits,
    }
  }
  return null
}

export function isMoveCommand(cmd: GameCommand): cmd is Extract<
  GameCommand,
  { type: 'move' } | { type: 'battleMove' }
> {
  return cmd.type === 'move' || cmd.type === 'battleMove'
}

/** Hide static piece while its move anim is playing. */
export function isPieceAnimating(anim: MoveAnim | null, pieceId: string): boolean {
  return anim != null && anim.pieceId === pieceId
}
