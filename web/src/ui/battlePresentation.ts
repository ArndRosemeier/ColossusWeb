import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DiceRollDisplay, PendingDiceRoll } from '../engine/types'

function subscribeReducedMotion(listener: () => void): () => void {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion,
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false)
}

export interface StrikePresentation { id: string; attackerId: string; startedAt: number }

/** Observe physical and immediate strikes at ONE seam, deduplicated by engine roll ID.
 * Observe in classic mode too, so enabling the preference never replays an old roll.
 */
export function useBattleStrikePresentation(
  pending: PendingDiceRoll | null | undefined,
  settled: DiceRollDisplay | null | undefined,
  enabled: boolean,
): StrikePresentation | null {
  const seen = useRef(new Set<string>())
  const [strike, setStrike] = useState<StrikePresentation | null>(null)
  const pendingId = pending?.strike ? pending.id : undefined
  const pendingAttacker = pending?.strike?.attackerId
  const settledId = settled?.strike ? settled.id : undefined
  const settledAttacker = settled?.strike?.attackerId
  useEffect(() => {
    const id = pendingId ?? settledId
    const attackerId = pendingAttacker ?? settledAttacker
    const fresh = id !== undefined && !seen.current.has(id)
    // A prior settled roll may still be in the tray alongside a new pending roll.
    if (pendingId) seen.current.add(pendingId)
    if (settledId) seen.current.add(settledId)
    if (!enabled) setStrike(null)
    else if (fresh && id && attackerId) setStrike({ id, attackerId, startedAt: Date.now() })
  }, [pendingId, pendingAttacker, settledId, settledAttacker, enabled])
  return enabled ? strike : null
}
