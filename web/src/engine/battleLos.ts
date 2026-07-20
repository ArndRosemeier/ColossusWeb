/**
 * Rangestrike line of sight — Colossus `Battle.isLOSBlocked` / `isLOSBlockedDir`.
 * Geometric center-to-center path (not BFS). Hexspine LOS is clear if either side is clear.
 */
import type { BuiltBattleHex, BuiltBattleland, HexsideHazard } from './battleland'
import { blocksLOS, oppositeHazard } from './battleland'

const ALMOST = 1e-6

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < ALMOST
}

/** Odd-X columns sit half a hex lower (Colossus BattleHex). */
function adjustedY(hex: BuiltBattleHex): number {
  return (hex.x & 1) === 1 ? hex.y + 0.5 : hex.y
}

function isObstacle(hazard: HexsideHazard): boolean {
  return hazard !== 'nothing' && hazard !== 'river'
}

function isCliffOrDune(hazard: HexsideHazard): boolean {
  return hazard === 'cliff' || hazard === 'dune'
}

/**
 * Direction further left/right along the path from hex1 toward hex2.
 * Colossus `Battle.getDirection`.
 */
export function losDirection(
  land: BuiltBattleland,
  fromLabel: string,
  toLabel: string,
  left: boolean,
): number {
  const hex1 = land.hexByLabel[fromLabel]
  const hex2 = land.hexByLabel[toLabel]
  if (!hex1 || !hex2 || fromLabel === toLabel) return -1
  const x1 = hex1.x
  let y1 = adjustedY(hex1)
  const x2 = hex2.x
  let y2 = adjustedY(hex2)
  const xDist = x2 - x1
  const yDist = y2 - y1
  const xDistAndAHalf = 1.5 * xDist
  if (xDist >= 0) {
    if (yDist > xDistAndAHalf) return 3
    if (almostEqual(yDist, xDistAndAHalf)) return left ? 2 : 3
    if (yDist < -xDistAndAHalf) return 0
    if (almostEqual(yDist, -xDistAndAHalf)) return left ? 0 : 1
    if (yDist > 0) return 2
    if (yDist < 0) return 1
    return left ? 1 : 2
  }
  if (yDist < xDistAndAHalf) return 0
  if (almostEqual(yDist, xDistAndAHalf)) return left ? 5 : 0
  if (yDist > -xDistAndAHalf) return 3
  if (almostEqual(yDist, -xDistAndAHalf)) return left ? 3 : 4
  if (yDist > 0) return 4
  if (yDist < 0) return 5
  return left ? 4 : 5
}

/** Colossus `Battle.toLeft` — which side to prefer when not on a hexspine. */
function toLeft(xDist: number, yDist: number): boolean {
  const ratio = xDist / yDist
  return (
    ratio >= 1.5 ||
    (ratio >= 0 && ratio <= 0.75) ||
    (ratio >= -1.5 && ratio <= -0.75)
  )
}

function isLosBlockedDir(
  land: BuiltBattleland,
  occupied: ReadonlySet<string>,
  initialLabel: string,
  currentLabel: string,
  finalLabel: string,
  left: boolean,
  strikeElevation: number,
  strikerAtop: boolean,
  strikerAtopCliff: boolean,
  strikerAtopWall: boolean,
  midObstacle: boolean,
  midCliff: boolean,
  midChit: boolean,
  totalObstacles: number,
  totalWalls: number,
): boolean {
  const currentHex = land.hexByLabel[currentLabel]
  const finalHex = land.hexByLabel[finalLabel]
  const initialHex = land.hexByLabel[initialLabel]
  if (!currentHex || !finalHex || !initialHex) return true
  if (currentLabel === finalLabel) return false

  const direction = losDirection(land, currentLabel, finalLabel, left)
  if (direction < 0) return true
  const nextLabel = currentHex.neighbors[direction]
  if (!nextLabel) return true
  const nextHex = land.hexByLabel[nextLabel]
  if (!nextHex) return true

  const hexside = currentHex.hexsides[direction] ?? 'nothing'
  const hexside2 = oppositeHazard(land, currentHex, direction)

  let nextStrikerAtop = strikerAtop
  let nextStrikerAtopCliff = strikerAtopCliff
  let nextStrikerAtopWall = strikerAtopWall
  let nextMidObstacle = midObstacle
  let nextMidCliff = midCliff
  let nextMidChit = midChit
  let nextTotalObstacles = totalObstacles
  let nextTotalWalls = totalWalls

  if (currentLabel === initialLabel) {
    if (isObstacle(hexside)) {
      nextStrikerAtop = true
      nextTotalObstacles++
      if (hexside === 'cliff') nextStrikerAtopCliff = true
      else if (hexside === 'tower') {
        nextStrikerAtopWall = true
        nextTotalWalls++
      }
    }
    if (isObstacle(hexside2)) {
      nextMidObstacle = true
      nextTotalObstacles++
      if (isCliffOrDune(hexside2)) nextMidCliff = true
      else if (hexside2 === 'tower') return true
    }
  } else if (nextLabel === finalLabel) {
    let targetAtop = false
    let targetAtopCliff = false
    let targetAtopWall = false
    if (isObstacle(hexside)) {
      nextMidObstacle = true
      nextTotalObstacles++
      if (isCliffOrDune(hexside)) nextMidCliff = true
      else if (hexside === 'tower') return true
    }
    if (isObstacle(hexside2)) {
      targetAtop = true
      nextTotalObstacles++
      if (hexside2 === 'cliff') targetAtopCliff = true
      else if (hexside2 === 'tower') {
        nextTotalWalls++
        targetAtopWall = true
      }
    }
    if (nextMidChit && !targetAtopCliff) return true
    if (nextMidCliff && (!nextStrikerAtopCliff || !targetAtopCliff)) return true
    if (nextMidObstacle && !nextStrikerAtop && !targetAtop) return true
    if (
      nextTotalObstacles >= 3 &&
      (!nextStrikerAtop || !targetAtop) &&
      !nextStrikerAtopCliff &&
      !targetAtopCliff
    ) {
      return true
    }
    if (nextTotalWalls >= 2 && !(nextStrikerAtopWall || targetAtopWall)) return true
    return false
  } else {
    if (nextMidChit) return true
    if (isObstacle(hexside) || isObstacle(hexside2)) {
      nextMidObstacle = true
      nextTotalObstacles++
      if (isCliffOrDune(hexside) || isCliffOrDune(hexside2)) nextMidCliff = true
    }
  }

  if (blocksLOS(nextHex)) return true

  // Creatures block LOS unless both ends are higher, or cliff-base exception.
  if (
    occupied.has(nextLabel) &&
    nextHex.elevation >= strikeElevation &&
    (!nextStrikerAtopCliff || currentLabel !== initialLabel)
  ) {
    nextMidChit = true
  }

  return isLosBlockedDir(
    land,
    occupied,
    initialLabel,
    nextLabel,
    finalLabel,
    left,
    strikeElevation,
    nextStrikerAtop,
    nextStrikerAtopCliff,
    nextStrikerAtopWall,
    nextMidObstacle,
    nextMidCliff,
    nextMidChit,
    nextTotalObstacles,
    nextTotalWalls,
  )
}

/**
 * True if rangestrike LOS from `from` to `to` is blocked.
 * `occupied` = hex labels with any creature still on the battleland (including dead).
 * Hexspine: clear if either side path is clear (Colossus).
 */
export function isLosBlocked(
  land: BuiltBattleland,
  from: string,
  to: string,
  occupied: ReadonlySet<string> = new Set(),
): boolean {
  if (from === to) return false
  const hex1 = land.hexByLabel[from]
  const hex2 = land.hexByLabel[to]
  if (!hex1 || !hex2) return true

  const x1 = hex1.x
  let y1 = adjustedY(hex1)
  const x2 = hex2.x
  let y2 = adjustedY(hex2)
  const xDist = x2 - x1
  const yDist = y2 - y1
  const strikeElevation = Math.min(hex1.elevation, hex2.elevation)

  const blockedDir = (left: boolean) =>
    isLosBlockedDir(
      land,
      occupied,
      from,
      from,
      to,
      left,
      strikeElevation,
      false,
      false,
      false,
      false,
      false,
      false,
      0,
      0,
    )

  if (almostEqual(yDist, 0) || almostEqual(Math.abs(yDist), 1.5 * Math.abs(xDist))) {
    return blockedDir(true) && blockedDir(false)
  }
  return blockedDir(toLeft(xDist, yDist))
}
