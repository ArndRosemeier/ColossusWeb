import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { GameState } from '../engine/types'
import { getPresentationMode, usePresentationMode } from './presentationMode'
import type { GamePresentationObserver } from './gamePresentation'

/** Fresh outcome events only. Loading/enabling presentation must never replay a win. */
export function useVictoryCelebration(state: GameState | null, cameraActive: boolean, notify: (message: string) => void) {
  const mode = usePresentationMode()
  const seen = useRef(false), serial = useRef(0), alive = useRef(true)
  const [pending, setPending] = useState<{ id: number; winnerId: string } | null>(null)
  const notifyRef = useRef(notify); notifyRef.current = notify
  const dismiss = useCallback(() => setPending(null), [])
  const observe = useCallback<GamePresentationObserver>((previous, next, replacement = false) => {
    if (replacement || !previous || !next) {
      seen.current = Boolean(next?.winnerId || next?.draw)
      setPending(null)
      return
    }
    if (seen.current || previous.winnerId || previous.draw || !next.winnerId || next.draw) return
    // Consume the event in Classic too: enabling Animated later is not a fresh win.
    seen.current = true
    if (getPresentationMode() !== 'animated') return
    if (!next.players.some(player => player.id === next.winnerId)) {
      queueMicrotask(() => { if (alive.current) notifyRef.current(`Victory celebration: winner ${next.winnerId} is missing from the game.`) })
      return
    }
    setPending({ id: ++serial.current, winnerId: next.winnerId })
  }, [])
  useLayoutEffect(() => { if (mode !== 'animated') setPending(null) }, [mode])
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const winner = pending && mode === 'animated' && !cameraActive && state && !state.draw && state.winnerId === pending.winnerId
    ? state.players.find(player => player.id === pending.winnerId) ?? null : null
  return { observe, dismiss, celebration: winner && pending ? { id: pending.id, winner } : null }
}
