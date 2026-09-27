import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GateType } from '../../types/variant'
import { MasterHexGates } from '../MasterHexGates'
import { archGeometry, blockOutline } from '../gateGeometry'

const SCALE = 30

/**
 * Which side of the directed line v1->v2 the point lies on (sign only).
 * Positive means the point is on the +n side, where `n = (-sin θ, cos θ)`.
 */
function side(
  px: number,
  py: number,
  vx1: number,
  vy1: number,
  vx2: number,
  vy2: number,
): number {
  return Math.sign((vx2 - vx1) * (py - vy1) - (vy2 - vy1) * (px - vx1))
}

const EDGES: { name: string; v: [number, number, number, number] }[] = [
  { name: 'horizontal hexside', v: [0, 0, SCALE, 0] },
  { name: 'slanted hexside', v: [0, 0, SCALE * 0.5, (SCALE * Math.sqrt(3)) / 2] },
  {
    name: 'reversed slanted hexside',
    v: [SCALE, 5, SCALE * 0.5, 5 + (SCALE * Math.sqrt(3)) / 2],
  },
]

/**
 * The bug this protects against: ARCH and BLOCK were drawn with the SAME rectangle
 * (`MasterHexGates.tsx`, `if (gate === 'BLOCK' || gate === 'ARCH')`), so a hexside with
 * an ARCH exit marker and a BLOCK entrance marker showed two identical squares. On the
 * real board one direction is a ROUNDED gate and the other a square — see GUIMasterHex
 * .drawGate() case ARCH and the Default variant's exit 138 -> 39 (ARCH) vs 39 -> 138
 * (BLOCK).
 */
describe('ARCH gates are rounded, BLOCK gates are square', () => {
  for (const { name, v } of EDGES) {
    const [vx1, vy1, vx2, vy2] = v

    it(`draws the ARCH cap as an arc, not a polygon — ${name}`, () => {
      const arch = archGeometry(vx1, vy1, vx2, vy2, SCALE)
      // An SVG arc command is what makes the cap ROUND. A rectangle would have none.
      expect(arch.cap).toMatch(/^M [-\d.]+ [-\d.]+ A [\d.]+ [\d.]+ 0 0 0 [-\d.]+ [-\d.]+$/)
      expect(arch.stem).toHaveLength(4)
      expect(arch.sides).toHaveLength(2)
    })

    it(`puts the round side opposite the square stem — ${name}`, () => {
      const arch = archGeometry(vx1, vy1, vx2, vy2, SCALE)
      const bulgeSide = side(arch.bulge[0], arch.bulge[1], vx1, vy1, vx2, vy2)
      expect(bulgeSide).not.toBe(0)
      // Both outer stem corners sit on the far side of the hexside from the bulge,
      // so the gate is round on one side and square on the other.
      for (const corner of [arch.stem[1]!, arch.stem[2]!]) {
        expect(side(corner[0], corner[1], vx1, vy1, vx2, vy2)).toBe(-bulgeSide)
      }
    })
  }

  it('no longer collapses ARCH into the BLOCK rectangle', () => {
    const [vx1, vy1, vx2, vy2] = [0, 0, SCALE, 0]
    const block = blockOutline(vx1, vy1, vx2, vy2, SCALE)
    const arch = archGeometry(vx1, vy1, vx2, vy2, SCALE)

    // BLOCK stays a plain 4-point bar with no arc in it.
    expect(block).toHaveLength(4)
    // ...and ARCH is genuinely different geometry, not that same rectangle.
    expect(arch.stem).not.toEqual(block)
    expect(arch.cap).toContain('A ')
  })
})

/**
 * The geometry above being right is not enough: the RENDERER must dispatch ARCH through
 * it. The original bug lived in the component's branch condition, so a pin that only
 * exercised `archGeometry` would stay green while the UI drew squares again.
 */
describe('MasterHexGates renders ARCH as a rounded gate', () => {
  const VERTS: [number, number][] = Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k
    return [SCALE * Math.cos(a), SCALE * Math.sin(a)] as [number, number]
  })

  function markupFor(gate: GateType): string {
    const exitType: GateType[] = ['NONE', gate, 'NONE', 'NONE', 'NONE', 'NONE']
    const entranceType: GateType[] = ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE']
    return renderToStaticMarkup(
      createElement(MasterHexGates, {
        verts: VERTS,
        inverted: false,
        exitType,
        entranceType,
        scale: SCALE,
      }),
    )
  }

  it('emits a semicircular arc for ARCH and no arc at all for BLOCK', () => {
    const arch = markupFor('ARCH')
    const block = markupFor('BLOCK')
    expect(arch).toMatch(/<path[^>]*d="M [-\d.]+ [-\d.]+ A [\d.]+ [\d.]+ 0 0 0/)
    expect(block).not.toContain('<path')
    expect(arch).not.toEqual(block)
  })
})
