import { describe, expect, it } from 'vitest'
import { Body, Box, Quaternion, Vec3 } from 'cannon-es'
import {
  createDiceThrow,
  faceUp,
  oppositeFace,
  quatForFaceUp,
  quatToCssMatrix,
  seatOrigin,
  snapToNearestFaceUp,
  uprightness,
} from '../dicePhysics'

/** Outward normals of our CSS die mesh (Y-down, +Z toward viewer). */
const CSS_FACE_NORMAL: Record<number, [number, number, number]> = {
  1: [0, 0, 1],
  2: [0, -1, 0],
  3: [1, 0, 0],
  4: [-1, 0, 0],
  5: [0, 1, 0],
  6: [0, 0, -1],
}

function applyMatrix3d(matrix: string, v: [number, number, number]): [number, number, number] {
  const m = matrix.match(/matrix3d\((.*)\)/)?.[1]?.split(',').map(Number)
  if (!m || m.length < 11) throw new Error('bad matrix')
  return [
    m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2],
    m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2],
    m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2],
  ]
}

function rotateX(deg: number, v: [number, number, number]): [number, number, number] {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]]
}

/** Which pip faces the camera after quatToCssMatrix + rotateX(tilt), matching DiceOverlay. */
function cssFaceTowardCamera(faceUpValue: number, tiltDeg: number): number {
  const q = quatForFaceUp(faceUpValue)
  const matrix = quatToCssMatrix(q.x, q.y, q.z, q.w)
  let best = 1
  let bestZ = -Infinity
  for (const f of [1, 2, 3, 4, 5, 6]) {
    const world = rotateX(tiltDeg, applyMatrix3d(matrix, CSS_FACE_NORMAL[f]!))
    if (world[2] > bestZ) {
      bestZ = world[2]
      best = f
    }
  }
  return best
}

describe('dicePhysics', () => {
  it('quatForFaceUp puts the target face on world +Y', () => {
    for (const face of [1, 2, 3, 4, 5, 6]) {
      const q = quatForFaceUp(face)
      expect(faceUp(q)).toBe(face)
      expect(uprightness(q)).toBeGreaterThan(0.99)
    }
  })

  it('opposite faces sum to 7', () => {
    expect(oppositeFace(1)).toBe(6)
    expect(oppositeFace(2)).toBe(5)
    expect(oppositeFace(3)).toBe(4)
  })

  it('CSS view (negXZ + rotateX -84) shows the same face faceUp reports', () => {
    // Regression: old rotateX(+84) without Y-up→Y-down conversion swapped 2↔5
    for (const face of [1, 2, 3, 4, 5, 6]) {
      expect(cssFaceTowardCamera(face, -84)).toBe(face)
    }
    // Document the old bug so it cannot silently return
    expect(cssFaceTowardCamera(2, 84)).not.toBe(2)
    expect(cssFaceTowardCamera(5, 84)).not.toBe(5)
  })

  it('snapToNearestFaceUp keeps the face that was already up', () => {
    const body = new Body({ mass: 1, shape: new Box(new Vec3(0.3, 0.3, 0.3)) })
    body.quaternion.copy(quatForFaceUp(4))
    // Tip slightly toward an edge
    const tip = new Quaternion()
    tip.setFromAxisAngle(new Vec3(1, 0, 0), 0.35)
    body.quaternion = tip.mult(body.quaternion)
    const before = faceUp(body.quaternion)
    snapToNearestFaceUp(body)
    expect(faceUp(body.quaternion)).toBe(before)
    expect(uprightness(body.quaternion)).toBeGreaterThan(0.99)
  })

  it('throw settles flat with a readable face', () => {
    const handle = createDiceThrow({
      dieCount: 3,
      seed: 'phys-settle-1',
      seatIndex: 0,
      seatCount: 2,
    })
    for (let i = 0; i < 500; i++) {
      handle.step(1 / 60)
      if (handle.allSettled()) break
    }
    if (!handle.allSettled()) handle.forceSettle()
    for (const face of handle.readFaces()) {
      expect(face).toBeGreaterThanOrEqual(1)
      expect(face).toBeLessThanOrEqual(6)
    }
    for (const b of handle.bodies) {
      expect(uprightness(b.quaternion)).toBeGreaterThan(0.99)
    }
    handle.dispose()
  })

  it('seatOrigin places seat 0 on the near edge and aims inward', () => {
    const s0 = seatOrigin(0, 4, 4)
    expect(s0.z).toBeGreaterThan(0)
    expect(s0.dirZ).toBeLessThan(0)
    const s2 = seatOrigin(2, 4, 4)
    expect(s2.z).toBeLessThan(0)
    expect(s2.dirZ).toBeGreaterThan(0)
  })
})
