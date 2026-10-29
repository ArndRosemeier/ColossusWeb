import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { PlayerState } from '../engine/types'
import { useReducedMotion } from '../ui/battlePresentation'
import { markerInk } from '../ui/markerArtwork'
import './victoryCelebration.css'

export function VictoryCelebration({ celebrationId, winner, onDismiss, onError, returnFocusRef }: {
  celebrationId: number; winner: PlayerState; onDismiss: () => void; onError: (message: string) => void
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const reduced = useReducedMotion()
  const [confetti, setConfetti] = useState(!reduced)
  const dialogRef = useRef<HTMLDialogElement>(null), viewRef = useRef<HTMLButtonElement>(null), closeRef = useRef<HTMLButtonElement>(null)
  const callbacks = useRef({ onDismiss, onError }); callbacks.current = { onDismiss, onError }
  const titleId = useId(), scoreId = useId()
  const ink = markerInk(winner.color.css)
  useLayoutEffect(() => { if (reduced) setConfetti(false) }, [reduced])
  useLayoutEffect(() => {
    const dialog = dialogRef.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    try { dialog.showModal(); viewRef.current?.focus({ preventScroll: true }) }
    catch (error) {
      callbacks.current.onError(`Victory celebration: ${error instanceof Error ? error.message : String(error)}`)
      callbacks.current.onDismiss()
      return
    }
    return () => {
      if (dialog.open) dialog.close()
      const target = previous && previous !== document.body && previous.isConnected && !previous.matches(':disabled') ? previous : returnFocusRef.current
      target?.focus({ preventScroll: true })
    }
  }, [celebrationId, returnFocusRef])
  return <dialog ref={dialogRef} className="victory-celebration" aria-labelledby={titleId} aria-describedby={scoreId}
    data-winner-id={winner.id} data-owner-color={winner.color.css} data-reduced-motion={reduced ? 'true' : 'false'}
    style={{ '--victory-color': winner.color.css, '--victory-ink': ink } as CSSProperties}
    onCancel={event => { event.preventDefault(); callbacks.current.onDismiss() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      if (event.shiftKey && document.activeElement === closeRef.current) { event.preventDefault(); viewRef.current?.focus() }
      else if (!event.shiftKey && document.activeElement === viewRef.current) { event.preventDefault(); closeRef.current?.focus() }
    }}>
    {confetti && !reduced && <div className="victory-confetti" aria-hidden="true" onAnimationEnd={event => {
      if (event.target === event.currentTarget) setConfetti(false)
    }}>
      {Array.from({ length: 32 }, (_, i) => <i key={i} style={{
        '--confetti-x': `${(i * 37 + 11) % 100}%`, '--confetti-drift': `${(i % 2 ? 1 : -1) * (28 + i % 5 * 16)}px`,
        '--confetti-delay': `${i % 7 * 35}ms`, '--confetti-turn': `${(i % 2 ? 1 : -1) * (200 + i % 4 * 90)}deg`,
        backgroundColor: [winner.color.css, '#dcc08c', '#f6ebd5'][i % 3], width: i % 3 === 0 ? 9 : 6, height: i % 3 === 1 ? 6 : 12,
      } as CSSProperties} />)}
    </div>}
    <div className="victory-card">
      <button ref={closeRef} type="button" className="victory-close" aria-label="Close victory celebration" onClick={onDismiss}>×</button>
      <p className="victory-eyebrow">A champion crowned</p>
      <svg className="victory-medal" viewBox="0 0 200 190" aria-hidden="true" focusable="false">
        <path d="M63 130 L51 181 L82 169 L101 187 L112 137 M137 130 L149 181 L118 169 L99 187 L88 137" fill={winner.color.css} stroke="#c4a26c" strokeWidth="2" />
        <path d="M50 147 Q15 100 47 48 M150 147 Q185 100 153 48" fill="none" stroke="#b19765" strokeWidth="3" />
        {[0, 1, 2, 3, 4].map(i => <g key={i} fill="#c9af77" transform={`translate(0 ${i * 17})`}>
          <path d="M38 55 Q19 41 24 32 Q41 35 38 55 M35 63 Q47 44 54 47 Q53 62 35 63" />
          <path d="M162 55 Q181 41 176 32 Q159 35 162 55 M165 63 Q153 44 146 47 Q147 62 165 63" />
        </g>)}
        <circle cx="100" cy="93" r="62" fill="#0c1720" stroke="#dcc28b" strokeWidth="4" />
        <circle className="victory-owner-face" cx="100" cy="93" r="54" fill={winner.color.css} />
        <circle cx="100" cy="93" r="48" fill="none" stroke={ink} strokeOpacity=".28" />
        <path d="M65 104 L58 65 L83 79 L100 51 L117 79 L142 65 L135 104 Z M67 113 H133" fill={ink} stroke={ink} strokeWidth="3" strokeLinejoin="round" />
        <path d="M100 124 L107 132 L100 140 L93 132 Z" fill={ink} />
        <path d="M64 48 A58 58 0 0 1 133 47" fill="none" stroke="#fff1ca" strokeOpacity=".65" strokeWidth="2" />
      </svg>
      <div className="victory-winner-banner"><h2 id={titleId}>{winner.name} wins</h2></div>
      <p className="victory-score" id={scoreId}><strong>{winner.score.toLocaleString()}</strong><span>final points</span></p>
      <p className="victory-board-note">The final board awaits.</p>
      <button ref={viewRef} type="button" className="victory-view-board" onClick={onDismiss}>View final board</button>
    </div>
  </dialog>
}
