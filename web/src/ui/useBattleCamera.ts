import { useCallback, useId, useLayoutEffect, useRef } from 'react'
import type { GameState } from '../engine/types'
import { getPresentationMode, usePresentationMode } from './presentationMode'
import { useReducedMotion } from './battlePresentation'
import { battleCameraBoundary, battleCameraKey, validCameraRect, visibleBattle } from './battleCamera'
import { cameraSnapshot, showBattleCamera, type CameraCapture } from './battleCameraOverlay'

export type BattleCameraObserver = (previous: GameState | null, next: GameState | null, replacement?: boolean) => void

/** Observe before App.putState swaps DOM; consume after the real incoming board mounts.
 * Both local commit and remote adoption use this seam. Nothing delays a game commit. */
export function useBattleCamera(state: GameState | null, notify: (message: string) => void) {
  const boardRef = useRef<HTMLDivElement>(null)
  const mode = usePresentationMode(), reducedMotion = useReducedMotion()
  const pending = useRef<(CameraCapture & { incomingKey: string | null }) | null>(null)
  const cancel = useRef<(() => void) | null>(null)
  const serial = useRef(0)
  const scope = `battle-camera-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const alive = useRef(true)
  const notifyRef = useRef(notify); notifyRef.current = notify
  const report = useCallback((error: unknown) => {
    // Errors are notices after the immediate commit, avoiding recursive putState.
    const message = `Battle camera: ${error instanceof Error ? error.message : String(error)}`
    queueMicrotask(() => { if (alive.current) notifyRef.current(message) })
  }, [])
  const reset = useCallback(() => { pending.current = null; cancel.current?.(); cancel.current = null }, [])
  const observe = useCallback<BattleCameraObserver>((previous, next, replacement = false) => {
    if (replacement || !previous || !next) { reset(); return }
    if (getPresentationMode() !== 'animated') { reset(); return }
    if (visibleBattle(previous) && visibleBattle(next) && battleCameraKey(previous) !== battleCameraKey(next)) { reset(); return }
    try {
      const boundary = battleCameraBoundary(previous, next)
      if (!boundary) return
      reset()
      const pane = boardRef.current
      const svg = pane?.querySelector<SVGSVGElement>(boundary.direction === 'enter' ? 'svg.master-board' : 'svg.battle-board')
      // Rapid batched boundaries may supersede a board before it ever paints.
      if (!svg) {
        if (pane && !pane.querySelector('svg.master-board, svg.battle-board')) throw Error('Cannot capture the outgoing board.')
        return
      }
      const outgoing = cameraSnapshot(svg, `${scope}-${++serial.current}-from`)
      if (!outgoing) return
      const hex = boundary.direction === 'enter' ? [...svg.querySelectorAll('[data-hex]')].find(node => node.getAttribute('data-hex') === boundary.hexLabel)?.querySelector('polygon')?.getBoundingClientRect() : null
      if (boundary.direction === 'enter' && (!hex || !validCameraRect(hex))) throw Error(`Cannot measure contested hex ${boundary.hexLabel}.`)
      pending.current = { boundary, outgoing, hex: hex ? { left: hex.left, top: hex.top, width: hex.width, height: hex.height } : null, incomingKey: battleCameraKey(next) }
    } catch (error) { reset(); report(error) }
  }, [report, reset, scope])

  useLayoutEffect(() => { reset() }, [mode, reducedMotion, reset])
  useLayoutEffect(() => {
    alive.current = true
    return () => { alive.current = false; reset() }
  }, [reset])
  useLayoutEffect(() => {
    const capture = pending.current
    if (!capture) return
    pending.current = null
    if (mode !== 'animated' || !state || capture.incomingKey !== battleCameraKey(state)) return
    try {
      const pane = boardRef.current
      const svg = pane?.querySelector<SVGSVGElement>(capture.boundary.direction === 'enter' ? 'svg.battle-board' : 'svg.master-board')
      if (!pane || !svg) {
        if (pane && !pane.querySelector('svg.master-board, svg.battle-board')) throw Error('Cannot capture the incoming board.')
        return
      }
      const incoming = cameraSnapshot(svg, `${scope}-${serial.current}-to`)
      if (!incoming) return
      const target = capture.boundary.direction === 'exit' ? [...svg.querySelectorAll('[data-hex]')].find(node => node.getAttribute('data-hex') === capture.boundary.hexLabel)?.querySelector('polygon')?.getBoundingClientRect() : capture.hex
      if (!target || !validCameraRect(target)) throw Error(`Cannot measure returning hex ${capture.boundary.hexLabel}.`)
      cancel.current = showBattleCamera(capture, incoming, target, pane.getBoundingClientRect(), reducedMotion, report, () => { cancel.current = null })
    } catch (error) { reset(); report(error) }
  })
  return { boardRef, observe }
}
