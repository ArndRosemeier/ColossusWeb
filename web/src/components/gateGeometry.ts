/**
 * Master board gate geometry — the pure maths behind the white markers painted on a
 * master hexside. No React here on purpose: this module is the seam a test can pin,
 * and keeping it out of the component file keeps that file exporting components only.
 *
 * Ported from Colossus `GUIMasterHex.drawGate()`.
 */

/** Colossus GUIHex.len = scale / 3 */
export function gateLen(scale: number): number {
  return scale / 3
}

export function pts(points: [number, number][]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}

function wallOrSlope(
  j: number,
  vx1: number,
  vy1: number,
  vx2: number,
  vy2: number,
  theta: number,
  len: number,
  size: number,
): [number, number][] {
  const x0 = vx1 + ((vx2 - vx1) * (2 + 3 * j)) / 12
  const x1 = vx1 + ((vx2 - vx1) * (4 + 3 * j)) / 12
  const y0 = vy1 + ((vy2 - vy1) * (2 + 3 * j)) / 12
  const y1 = vy1 + ((vy2 - vy1) * (4 + 3 * j)) / 12
  const s = len / size
  return [
    [x0 - s * Math.sin(theta), y0 + s * Math.cos(theta)],
    [x0 + s * Math.sin(theta), y0 - s * Math.cos(theta)],
    [x1 + s * Math.sin(theta), y1 - s * Math.cos(theta)],
    [x1 - s * Math.sin(theta), y1 + s * Math.cos(theta)],
  ]
}

export function arrowTriple(
  j: number,
  vx1: number,
  vy1: number,
  vx2: number,
  vy2: number,
  theta: number,
  len: number,
): [number, number][] {
  const x0 = vx1 + ((vx2 - vx1) * (2 + 3 * j)) / 12
  const x1 = vx1 + ((vx2 - vx1) * (4 + 3 * j)) / 12
  const y0 = vy1 + ((vy2 - vy1) * (2 + 3 * j)) / 12
  const y1 = vy1 + ((vy2 - vy1) * (4 + 3 * j)) / 12
  return [
    [x0 - len * Math.sin(theta), y0 + len * Math.cos(theta)],
    [(x0 + x1) / 2 + len * Math.sin(theta), (y0 + y1) / 2 - len * Math.cos(theta)],
    [x1 - len * Math.sin(theta), y1 + len * Math.cos(theta)],
  ]
}

/** The BLOCK outline — a plain bar straddling the hexside. */
export function blockOutline(
  vx1: number,
  vy1: number,
  vx2: number,
  vy2: number,
  scale: number,
): [number, number][] {
  const theta = Math.atan2(vy2 - vy1, vx2 - vx1)
  return wallOrSlope(0, vx1, vy1, vx2, vy2, theta, gateLen(scale), 1)
}

export interface ArchGeometry {
  /** The square-sided stem: the quad Colossus builds from the BLOCK bar's outer points. */
  stem: [number, number][]
  /** The two perpendicular sides Colossus strokes (it leaves the far end open). */
  sides: [[number, number], [number, number]][]
  /** SVG path for the rounded cap: an OPEN semicircular arc, no chord. */
  cap: string
  /** Midpoint of the semicircle — the extreme point of the ROUND side. */
  bulge: [number, number]
}

/**
 * ARCH — Colossus paints this as a half-disc of radius `len` centred on the hexside
 * segment plus a quad stem, so the gate is ROUND on one side and SQUARE on the other.
 * Ported from `GUIMasterHex.drawGate()` case ARCH.
 *
 * The bulge is deliberately on the OPPOSITE side of the hexside from the stem: that is
 * what makes an ARCH read as a rounded gate rather than a BLOCK rectangle. Collapsing
 * the two (as MasterHexGates.tsx previously did) draws squares in both directions, so a
 * hexside carrying an ARCH exit and a BLOCK entrance showed two identical squares. On the
 * real board one direction is a rounded gate and the other a square — e.g. the Default
 * variant's exit 138 -> 39 is ARCH while 39 -> 138 is BLOCK. See masterHexGates.test.ts.
 */
export function archGeometry(
  vx1: number,
  vy1: number,
  vx2: number,
  vy2: number,
  scale: number,
): ArchGeometry {
  const len = gateLen(scale)
  const theta = Math.atan2(vy2 - vy1, vx2 - vx1)
  const x0 = vx1 + (vx2 - vx1) / 6
  const y0 = vy1 + (vy2 - vy1) / 6
  const x1 = vx1 + (vx2 - vx1) / 3
  const y1 = vy1 + (vy2 - vy1) / 3
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const dx = Math.cos(theta)
  const dy = Math.sin(theta)
  // n is the unit normal the BLOCK bar's first two points sit on; the stem stays on
  // +n and the half-disc bulges to -n.
  const nx = -Math.sin(theta)
  const ny = Math.cos(theta)

  const p3: [number, number] = [x1 + len * nx, y1 + len * ny]
  const p0: [number, number] = [x0 + len * nx, y0 + len * ny]
  const a: [number, number] = [cx + len * dx, cy + len * dy]
  const b: [number, number] = [cx - len * dx, cy - len * dy]
  const f = (v: number) => Number(v.toFixed(3))

  return {
    stem: [
      [x1, y1],
      p3,
      p0,
      [x0, y0],
    ],
    sides: [
      [
        [x1, y1],
        p3,
      ],
      [
        p0,
        [x0, y0],
      ],
    ],
    // sweep-flag 0 selects the half that passes through (cx,cy) - len*n.
    cap: `M ${f(a[0])} ${f(a[1])} A ${f(len)} ${f(len)} 0 0 0 ${f(b[0])} ${f(b[1])}`,
    bulge: [cx - len * nx, cy - len * ny],
  }
}
