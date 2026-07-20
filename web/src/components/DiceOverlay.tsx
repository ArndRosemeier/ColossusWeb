import { useId, useLayoutEffect, useEffect, useRef, useState } from 'react'
import type { DiceRollDisplay, PendingDiceRoll } from '../engine/types'
import {
  createDiceThrow,
  quatToCssMatrix,
  worldToScreenPct,
  type DiceThrowHandle,
} from '../ui/dicePhysics'

const FACE_END: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  2: { x: -90, y: 0 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  5: { x: 90, y: 0 },
  6: { x: 0, y: 180 },
}

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

function DieFace({ value }: { value: number }) {
  const pips = PIPS[value] ?? []
  return (
    <div className="die-face" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={pips.includes(i) ? 'pip' : 'pip empty'} />
      ))}
    </div>
  )
}

function DieMesh({ size, hit }: { size: number; hit?: boolean }) {
  return (
    <div
      className={`die3d-wrap${hit === false ? ' die-miss' : ''}${hit === true ? ' die-hit' : ''}`}
      style={{
        width: size,
        height: size,
        ['--die-size' as string]: `${size}px`,
      }}
    >
      <div className="die3d">
        <div className="die-side front">
          <DieFace value={1} />
        </div>
        <div className="die-side back">
          <DieFace value={6} />
        </div>
        <div className="die-side right">
          <DieFace value={3} />
        </div>
        <div className="die-side left">
          <DieFace value={4} />
        </div>
        <div className="die-side top">
          <DieFace value={2} />
        </div>
        <div className="die-side bottom">
          <DieFace value={5} />
        </div>
      </div>
    </div>
  )
}

function TrayDie({ value, size, hit }: { value: number; size: number; hit?: boolean }) {
  const face = FACE_END[value] ?? FACE_END[1]
  return (
    <div
      className={`die3d-wrap${hit === false ? ' die-miss' : ''}${hit === true ? ' die-hit' : ''}`}
      style={{
        width: size,
        height: size,
        ['--die-size' as string]: `${size}px`,
      }}
    >
      <div
        className="die3d settled"
        style={{ transform: `rotateX(${face.x}deg) rotateY(${face.y}deg)` }}
      >
        <div className="die-side front">
          <DieFace value={1} />
        </div>
        <div className="die-side back">
          <DieFace value={6} />
        </div>
        <div className="die-side right">
          <DieFace value={3} />
        </div>
        <div className="die-side left">
          <DieFace value={4} />
        </div>
        <div className="die-side top">
          <DieFace value={2} />
        </div>
        <div className="die-side bottom">
          <DieFace value={5} />
        </div>
      </div>
    </div>
  )
}

function diePixelSize(count: number, fieldW: number): number {
  const base = count <= 2 ? 58 : count <= 6 ? 48 : count <= 10 ? 38 : 30
  return Math.max(22, Math.min(base, fieldW * 0.07))
}

interface Props {
  pending: PendingDiceRoll | null
  settled: DiceRollDisplay | null
  seatIndex: number
  seatCount: number
  /** When false, commit immediately via rng (instant AI / reduced motion). */
  animate: boolean
  onThrowDone: (values: number[] | undefined) => void
}

/**
 * Rigid-body dice thrown from the acting player's seat.
 * `pending` must stay set until `onThrowDone` — that is the animation lock.
 */
export function DiceOverlay({
  pending,
  settled,
  seatIndex,
  seatCount,
  animate,
  onThrowDone,
}: Props) {
  const [live, setLive] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const fieldSizeRef = useRef({ w: 800, h: 600 })
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([])
  const onDoneRef = useRef(onThrowDone)
  const seatRef = useRef({ seatIndex, seatCount })
  const animateRef = useRef(animate)
  const reactId = useId()

  onDoneRef.current = onThrowDone
  seatRef.current = { seatIndex, seatCount }
  animateRef.current = animate

  const showRoll = pending ?? settled
  const dieCount = pending?.dieCount ?? settled?.values.length ?? 0
  const trayReady = Boolean(settled && !pending)
  const showHits = settled?.context === 'strike' && settled.need != null

  useLayoutEffect(() => {
    const el = fieldRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 10 && r.height > 10) {
        fieldSizeRef.current = { w: r.width, h: r.height }
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Drive one throw per pending.id. useLayoutEffect so the first poses land before paint.
  // Generation token ignores Strict Mode's cancelled first pass.
  useLayoutEffect(() => {
    if (!pending) {
      setLive(false)
      return
    }

    const rollId = pending.id
    const count = pending.dieCount
    let cancelled = false
    let raf = 0
    let handle: DiceThrowHandle | null = null

    const finish = (values: number[] | undefined) => {
      if (cancelled) return
      cancelled = true
      onDoneRef.current(values)
    }

    if (!animateRef.current) {
      finish(undefined)
      return () => {
        cancelled = true
      }
    }

    setLive(true)

    const { seatIndex: seat, seatCount: seats } = seatRef.current
    handle = createDiceThrow({
      dieCount: count,
      seed: rollId,
      seatIndex: seat,
      seatCount: seats,
    })

    const field = fieldSizeRef.current
    const pxPerUnit = Math.min(field.w, field.h) / 11
    const size = diePixelSize(count, field.w)
    let last = performance.now()
    let elapsed = 0
    const minMs = 550
    const maxMs = 3200

    const writePoses = () => {
      if (!handle) return
      const poses = handle.poses()
      for (let i = 0; i < poses.length; i++) {
        const node = nodeRefs.current[i]
        const pose = poses[i]
        if (!node || !pose) continue
        const { left, top } = worldToScreenPct(pose.x, pose.z, handle.bounds)
        const lift = Math.max(0, pose.y - handle.halfExtent) * pxPerUnit
        const matrix = quatToCssMatrix(pose.qx, pose.qy, pose.qz, pose.qw)
        node.style.left = `${left}%`
        node.style.top = `${top}%`
        node.style.width = `${size}px`
        node.style.height = `${size}px`
        node.style.marginLeft = `${-size / 2}px`
        node.style.marginTop = `${-size / 2}px`
        node.style.transform = `translate3d(0, ${-lift}px, 0)`
        node.style.opacity = '1'
        const shadow = node.querySelector('.die-shadow') as HTMLElement | null
        if (shadow) {
          const h = Math.max(0, pose.y - handle.halfExtent)
          shadow.style.opacity = String(0.55 / (1 + h * 0.8))
          shadow.style.transform = `translateX(-50%) scale(${1 + h * 0.15})`
        }
        const cube = node.querySelector('.die3d') as HTMLElement | null
        if (cube) {
          cube.style.transform = `rotateX(84deg) ${matrix}`
          cube.style.setProperty('--die-size', `${size}px`)
        }
        const wrap = node.querySelector('.die3d-wrap') as HTMLElement | null
        if (wrap) {
          wrap.style.width = `${size}px`
          wrap.style.height = `${size}px`
          wrap.style.setProperty('--die-size', `${size}px`)
        }
      }
    }

    const tick = (now: number) => {
      if (cancelled || !handle) return
      const rawDt = Math.min(0.05, (now - last) / 1000)
      last = now
      elapsed += rawDt * 1000
      handle.step(rawDt)
      writePoses()

      const settledLongEnough = handle.allSettled() && elapsed >= minMs
      const timedOut = elapsed >= maxMs
      if (settledLongEnough || timedOut) {
        if (!handle.allSettled()) handle.forceSettle()
        writePoses()
        finish(handle.readFaces())
        return
      }
      raf = requestAnimationFrame(tick)
    }

    // Wait one frame so die node refs from this pending render are attached
    raf = requestAnimationFrame(() => {
      if (cancelled) return
      writePoses()
      raf = requestAnimationFrame(tick)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      handle?.dispose()
      handle = null
    }
  }, [pending?.id])

  // If pending clears externally, stop showing "live" throw state
  useEffect(() => {
    if (!pending) setLive(false)
  }, [pending])

  const size = diePixelSize(Math.max(dieCount, 1), fieldSizeRef.current.w)
  const traySize = dieCount <= 4 ? 32 : dieCount <= 8 ? 26 : 20

  return (
    <div className="dice-overlay" aria-live="polite">
      <div className="dice-board-field" ref={fieldRef}>
        {pending &&
          dieCount > 0 &&
          Array.from({ length: dieCount }, (_, i) => (
            <div
              key={`${reactId}-${pending.id}-die-${i}`}
              className={`die-throw${live ? ' in-flight' : ''}`}
              ref={(el) => {
                nodeRefs.current[i] = el
              }}
              style={{
                left: '50%',
                top: '55%',
                width: size,
                height: size,
                marginLeft: -size / 2,
                marginTop: -size / 2,
                opacity: live ? 1 : 0,
              }}
            >
              <div className="die-shadow" />
              <DieMesh size={size} />
            </div>
          ))}
      </div>

      {showRoll && dieCount > 0 && (
        <div className={`dice-tray${trayReady ? '' : ' dim'}`}>
          <div className="dice-tray-head">
            <span className="dice-tray-title">{showRoll.label}</span>
            {trayReady && showHits && (
              <span className="dice-tray-meta">
                need {settled!.need}+ · {settled!.hits ?? 0} hit
                {(settled!.hits ?? 0) === 1 ? '' : 's'}
              </span>
            )}
            {trayReady &&
              (settled!.context === 'movement' || settled!.context === 'mulligan') && (
                <span className="dice-tray-meta">movement {settled!.values[0]}</span>
              )}
          </div>
          {trayReady && (
            <div className="dice-tray-row">
              {settled!.values.map((v, i) => {
                const hit =
                  showHits && settled!.need != null ? v >= settled!.need : undefined
                return (
                  <TrayDie
                    key={`${reactId}-${settled!.id}-tray-${i}`}
                    value={v}
                    size={traySize}
                    hit={hit}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Whether the UI should play a physical throw for this roll. */
export function shouldAnimateDice(
  aiSpeed: 'paused' | 'slow' | 'normal' | 'fast' | 'instant',
  forAi: boolean,
): boolean {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return false
  }
  if (forAi && aiSpeed === 'instant') return false
  return true
}

/** @deprecated use shouldAnimateDice — kept for call sites that scale other FX */
export function diceAnimSpeedFactor(
  aiSpeed: 'paused' | 'slow' | 'normal' | 'fast' | 'instant',
  forAi: boolean,
): number {
  return shouldAnimateDice(aiSpeed, forAi) ? (forAi && aiSpeed === 'fast' ? 0.85 : 1) : 0
}
