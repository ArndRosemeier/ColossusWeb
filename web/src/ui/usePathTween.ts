import { useEffect, useRef, useState } from 'react'
import { pointAlongPath, trailPoints, teleportOpacity, type Point } from './moveAnimation'

/**
 * Drives 0→1 progress over `durationMs`, calling `onDone` once at the end.
 */
export function useMoveProgress(durationMs: number, onDone: () => void): number {
  const [t, setT] = useState(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    let finished = false
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / Math.max(1, durationMs))
      setT(p)
      if (p >= 1) {
        if (!finished) {
          finished = true
          onDoneRef.current()
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [durationMs])

  return t
}

export function usePathTween(
  points: Point[],
  durationMs: number,
  teleport: boolean,
  onDone: () => void,
): {
  t: number
  pos: Point
  trail: Point[]
  opacity: { origin: number; ghost: number }
} {
  const t = useMoveProgress(durationMs, onDone)
  if (teleport) {
    const opacity = teleportOpacity(t)
    const atEnd = t >= 0.45
    return {
      t,
      pos: atEnd ? (points[points.length - 1] ?? points[0]) : points[0],
      trail: [],
      opacity,
    }
  }
  return {
    t,
    pos: pointAlongPath(points, t),
    trail: trailPoints(points, t),
    opacity: { origin: 0, ghost: 1 },
  }
}

export function pointsToSvg(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}
