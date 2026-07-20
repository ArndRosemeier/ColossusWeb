import { describe, expect, it } from 'vitest'
import { Quaternion, Vec3 } from 'cannon-es'
import {
  createDiceThrow,
  faceUp,
  oppositeFace,
  quatForFaceUp,
  seatOrigin,
  snapToNearestFaceUp,
  uprightness,
} from '../dicePhysics'
import { Body, Box } from 'cannon-es'

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
