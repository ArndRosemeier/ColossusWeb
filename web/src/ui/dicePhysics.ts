import {
  Body,
  Box,
  ContactMaterial,
  Material,
  Quaternion,
  Vec3,
  World,
} from 'cannon-es'

/** Pip face on our CSS cube for each local axis (matches Die3D geometry). */
export const FACE_NORMAL: Record<number, Vec3> = {
  1: new Vec3(0, 0, 1), // front
  2: new Vec3(0, 1, 0), // top
  3: new Vec3(1, 0, 0), // right
  4: new Vec3(-1, 0, 0), // left
  5: new Vec3(0, -1, 0), // bottom
  6: new Vec3(0, 0, -1), // back
}

const FACE_VALUES = [1, 2, 3, 4, 5, 6] as const

export type DiePose = {
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
  sleeping: boolean
}

export type DiceThrowHandle = {
  world: World
  bodies: Body[]
  halfExtent: number
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  step: (dtSec: number) => void
  poses: () => DiePose[]
  /** Current face-up values (valid once settled; approximate while tumbling). */
  readFaces: () => number[]
  allSettled: () => boolean
  /** Snap each die flat onto its nearest face (keeps whatever came up). */
  forceSettle: () => void
  dispose: () => void
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Which pip face is most aligned with world +Y (sky / result face). */
export function faceUp(q: Quaternion): number {
  const localUp = new Vec3()
  q.conjugate().vmult(new Vec3(0, 1, 0), localUp)
  let best = 1
  let bestDot = -Infinity
  for (const v of FACE_VALUES) {
    const d = localUp.dot(FACE_NORMAL[v]!)
    if (d > bestDot) {
      bestDot = d
      best = v
    }
  }
  return best
}

/** Opposite pip face (standard die: opposites sum to 7). */
export function oppositeFace(face: number): number {
  return 7 - face
}

/** Quaternion that puts `face` flush with world +Y (yaw preserved separately). */
export function quatForFaceUp(face: number): Quaternion {
  const n = FACE_NORMAL[face] ?? FACE_NORMAL[1]!
  const q = new Quaternion()
  q.setFromVectors(n, new Vec3(0, 1, 0))
  return q
}

/** How upright the nearest face is (1 = perfectly flat, ~0.58 = on an edge). */
export function uprightness(q: Quaternion): number {
  const localUp = new Vec3()
  q.conjugate().vmult(new Vec3(0, 1, 0), localUp)
  let best = 0
  for (const v of FACE_VALUES) {
    best = Math.max(best, localUp.dot(FACE_NORMAL[v]!))
  }
  return best
}

/**
 * Snap onto the nearest face that is already up — does not change the result,
 * only removes edge/corner wobble.
 */
export function snapToNearestFaceUp(body: Body): void {
  const face = faceUp(body.quaternion)
  const qTarget = quatForFaceUp(face)
  const euler = new Vec3()
  body.quaternion.toEuler(euler, 'YZX')
  const yaw = new Quaternion()
  yaw.setFromAxisAngle(new Vec3(0, 1, 0), euler.y)
  body.quaternion.copy(yaw.mult(qTarget))
  body.angularVelocity.setZero()
  body.velocity.x *= 0.15
  body.velocity.z *= 0.15
  body.velocity.y = 0
}

function makeWall(world: World, mat: Material, pos: Vec3, half: Vec3): Body {
  const body = new Body({
    mass: 0,
    shape: new Box(half),
    material: mat,
    position: pos,
  })
  world.addBody(body)
  return body
}

/**
 * Seat 0 at the near edge (+Z / bottom of screen); further seats walk
 * counter-clockwise around the table.
 */
export function seatOrigin(
  seatIndex: number,
  seatCount: number,
  radius: number,
): { x: number; z: number; dirX: number; dirZ: number } {
  const n = Math.max(1, seatCount)
  const angle = ((seatIndex % n) / n) * Math.PI * 2
  const x = Math.sin(angle) * radius
  const z = Math.cos(angle) * radius
  const len = Math.hypot(x, z) || 1
  return { x, z, dirX: -x / len, dirZ: -z / len }
}

export function createDiceThrow(opts: {
  dieCount: number
  seed: string
  seatIndex: number
  seatCount: number
}): DiceThrowHandle {
  const rng = mulberry(hashSeed(opts.seed))
  const n = Math.max(1, opts.dieCount)
  const halfExtent = n <= 2 ? 0.4 : n <= 6 ? 0.32 : n <= 10 ? 0.26 : 0.22

  const world = new World({ gravity: new Vec3(0, -55, 0) })
  world.allowSleep = true
  world.defaultContactMaterial.friction = 0.7
  world.defaultContactMaterial.restitution = 0.08

  const dieMat = new Material('die')
  const groundMat = new Material('ground')
  world.addContactMaterial(
    new ContactMaterial(dieMat, groundMat, {
      friction: 0.85,
      restitution: 0.12,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 4,
    }),
  )
  world.addContactMaterial(
    new ContactMaterial(dieMat, dieMat, {
      friction: 0.4,
      restitution: 0.15,
    }),
  )

  const minX = -5.2
  const maxX = 5.2
  const minZ = -3.6
  const maxZ = 3.6
  const wallH = 3.5
  const wallT = 0.4

  const ground = new Body({
    mass: 0,
    shape: new Box(new Vec3(8, 0.5, 6)),
    material: groundMat,
    position: new Vec3(0, -0.5, 0),
  })
  world.addBody(ground)

  makeWall(world, groundMat, new Vec3(0, wallH / 2, minZ - wallT), new Vec3(8, wallH / 2, wallT))
  makeWall(world, groundMat, new Vec3(0, wallH / 2, maxZ + wallT), new Vec3(8, wallH / 2, wallT))
  makeWall(world, groundMat, new Vec3(minX - wallT, wallH / 2, 0), new Vec3(wallT, wallH / 2, 6))
  makeWall(world, groundMat, new Vec3(maxX + wallT, wallH / 2, 0), new Vec3(wallT, wallH / 2, 6))

  const seat = seatOrigin(opts.seatIndex, opts.seatCount, 3.5)
  // Perpendicular for fanning dice along the player's hand
  const sideX = -seat.dirZ
  const sideZ = seat.dirX

  const bodies: Body[] = []
  const shape = new Box(new Vec3(halfExtent, halfExtent, halfExtent))

  for (let i = 0; i < n; i++) {
    const body = new Body({
      mass: 1.4,
      shape,
      material: dieMat,
      allowSleep: true,
      sleepSpeedLimit: 0.22,
      sleepTimeLimit: 0.22,
      angularDamping: 0.35,
      linearDamping: 0.12,
    })

    const lane = (i - (n - 1) / 2) * (halfExtent * 2.35)
    const x0 = seat.x + sideX * lane + (rng() - 0.5) * 0.35
    const z0 = seat.z + sideZ * lane + (rng() - 0.5) * 0.35
    const y0 = 0.95 + rng() * 0.55 + (i % 3) * 0.08
    body.position.set(x0, y0, z0)

    const q = new Quaternion()
    q.setFromEuler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2, 'XYZ')
    body.quaternion.copy(q)

    const speed = 7.5 + rng() * 2.8
    const lift = 3.2 + rng() * 1.8
    body.velocity.set(
      seat.dirX * speed + (rng() - 0.5) * 1.4,
      lift,
      seat.dirZ * speed + (rng() - 0.5) * 1.4,
    )

    // Enough spin to tumble, not so much they skate on edges
    body.angularVelocity.set(
      (rng() - 0.5) * 16,
      (rng() - 0.5) * 14,
      (rng() - 0.5) * 16,
    )

    body.applyImpulse(
      new Vec3(seat.dirX * 0.6, 0.35 + rng() * 0.3, seat.dirZ * 0.6),
      new Vec3((rng() - 0.5) * halfExtent * 0.6, (rng() - 0.5) * halfExtent * 0.6, (rng() - 0.5) * halfExtent * 0.6),
    )

    world.addBody(body)
    bodies.push(body)
  }

  let settledFrames = 0
  let locked = false

  const lockFlat = () => {
    for (const body of bodies) {
      snapToNearestFaceUp(body)
      body.position.y = halfExtent
      body.velocity.setZero()
      body.angularVelocity.setZero()
      body.sleep()
    }
    locked = true
    settledFrames = 99
  }

  const step = (dtSec: number) => {
    const clamped = Math.min(dtSec, 0.04)
    world.step(1 / 60, clamped, 4)

    if (locked) return

    let allQuiet = true
    for (const body of bodies) {
      // Soft bounds
      if (body.position.x < minX + halfExtent) body.velocity.x += 3
      if (body.position.x > maxX - halfExtent) body.velocity.x -= 3
      if (body.position.z < minZ + halfExtent) body.velocity.z += 3
      if (body.position.z > maxZ - halfExtent) body.velocity.z -= 3

      const speed = body.velocity.length() + body.angularVelocity.length() * 0.4
      const up = uprightness(body.quaternion)
      const onGround = body.position.y <= halfExtent + 0.2

      // Once mostly stopped, gently pull onto the nearest face (no result change)
      if (onGround && speed < 4 && up < 0.92) {
        const face = faceUp(body.quaternion)
        const local = FACE_NORMAL[face]!
        const worldNormal = new Vec3()
        body.quaternion.vmult(local, worldNormal)
        const axis = new Vec3()
        worldNormal.cross(new Vec3(0, 1, 0), axis)
        if (axis.length() > 1e-5) {
          axis.normalize()
          const ang = Math.acos(Math.min(1, Math.max(-1, worldNormal.dot(new Vec3(0, 1, 0)))))
          const strength = speed < 1.2 ? 22 : 8
          body.torque.x += axis.x * ang * strength
          body.torque.y += axis.y * ang * strength
          body.torque.z += axis.z * ang * strength
        }
      }

      if (speed > 0.4 || !onGround || up < 0.88) allQuiet = false
    }

    if (allQuiet) {
      settledFrames++
      if (settledFrames > 10) lockFlat()
    } else {
      settledFrames = 0
    }
  }

  const poses = (): DiePose[] =>
    bodies.map((b) => ({
      x: b.position.x,
      y: b.position.y,
      z: b.position.z,
      qx: b.quaternion.x,
      qy: b.quaternion.y,
      qz: b.quaternion.z,
      qw: b.quaternion.w,
      sleeping: b.sleepState === Body.SLEEPING || locked,
    }))

  const readFaces = () => bodies.map((b) => faceUp(b.quaternion))

  const allSettled = () => locked

  const dispose = () => {
    for (const b of [...world.bodies]) world.removeBody(b)
  }

  return {
    world,
    bodies,
    halfExtent,
    bounds: { minX, maxX, minZ, maxZ },
    step,
    poses,
    readFaces,
    allSettled,
    forceSettle: lockFlat,
    dispose,
  }
}

/** Cannon quaternion → CSS matrix3d (column-major). */
export function quatToCssMatrix(qx: number, qy: number, qz: number, qw: number): string {
  const x = qx
  const y = qy
  const z = qz
  const w = qw
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2

  const r00 = 1 - (yy + zz)
  const r01 = xy - wz
  const r02 = xz + wy
  const r10 = xy + wz
  const r11 = 1 - (xx + zz)
  const r12 = yz - wx
  const r20 = xz - wy
  const r21 = yz + wx
  const r22 = 1 - (xx + yy)

  return `matrix3d(${r00},${r10},${r20},0,${r01},${r11},${r21},0,${r02},${r12},${r22},0,0,0,0,1)`
}

export function worldToScreenPct(
  x: number,
  z: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): { left: number; top: number } {
  const left = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * 100
  const top = ((bounds.maxZ - z) / (bounds.maxZ - bounds.minZ)) * 100
  return { left, top }
}
