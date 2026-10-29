import type { GameState } from '../engine/types'

export interface CameraRect { left: number; top: number; width: number; height: number }
export interface BattleCameraBoundary { direction: 'enter' | 'exit'; hexLabel: string }

export function visibleBattle(state: GameState | null): boolean {
  return Boolean(state?.battle && !state.battle.done)
}

/** A presentation boundary, never a command handler or second game-state machine. */
export function battleCameraBoundary(previous: GameState | null, next: GameState | null): BattleCameraBoundary | null {
  if (!previous || !next || visibleBattle(previous) === visibleBattle(next)) return null
  const entering = visibleBattle(next)
  const battle = (entering ? next : previous).battle!
  // On exit the losing legion may already have been removed, so read the old state first.
  const states = entering ? [next, previous] : [previous, next]
  for (const state of states) {
    for (const id of [battle.attackerLegionId, battle.defenderLegionId]) {
      const legion = state.legions.find(item => item.id === id)
      if (legion) return { direction: entering ? 'enter' : 'exit', hexLabel: legion.hexLabel }
    }
  }
  throw Error('Battle camera cannot locate the contested main-board hex.')
}

export function battleCameraKey(state: GameState | null): string | null {
  return visibleBattle(state) ? `${state!.battle!.attackerLegionId}:${state!.battle!.defenderLegionId}` : null
}

export function validCameraRect(rect: CameraRect): boolean {
  return [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0
}

/** Transform the actual contested-hex center to the destination board center.
 * Rotation is around the captured board's origin, so translation includes it. */
export function battleCameraFocus(board: CameraRect, hex: CameraRect, destination: CameraRect): {
  x: number; y: number; scale: number; angle: number; transform: string
} {
  if (![board, hex, destination].every(validCameraRect)) throw Error('Battle camera received invalid board geometry.')
  const scale = Math.max(1, Math.min(14, Math.min(destination.width / hex.width, destination.height / hex.height) * .9))
  const angle = -7
  const radians = angle * Math.PI / 180
  const hx = hex.left + hex.width / 2 - board.left, hy = hex.top + hex.height / 2 - board.top
  const x = destination.left + destination.width / 2 - board.left - scale * (Math.cos(radians) * hx - Math.sin(radians) * hy)
  const y = destination.top + destination.height / 2 - board.top - scale * (Math.sin(radians) * hx + Math.cos(radians) * hy)
  return { x, y, scale, angle, transform: `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${scale})` }
}
