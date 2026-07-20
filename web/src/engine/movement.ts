import type { BuiltBoard, GateType, MasterHex } from '../types/variant'
import type { EntrySide, GameState, Legion } from './types'

const ARCHES_AND_ARROWS = -1
const ARROWS_ONLY = -2
const NOWHERE = -1

const GATE_ORDINAL: Record<GateType, number> = {
  NONE: 0,
  BLOCK: 1,
  ARCH: 2,
  ARROW: 3,
  ARROWS: 4,
}

function findBlock(hex: MasterHex): number {
  let block = ARCHES_AND_ARROWS
  for (let j = 0; j < 6; j++) {
    if (hex.exitType[j] === 'BLOCK') {
      block = j
    }
  }
  return block
}

function findEntrySide(hex: MasterHex, cameFrom: number): EntrySide {
  if (cameFrom === -1) return 'Bottom'
  if (hex.terrain === 'Tower') return 'Bottom'
  const entrySide = (6 + cameFrom - hex.labelSide) % 6
  // Map hexside to Left/Right/Bottom like Colossus EntrySide
  if (entrySide === 1 || entrySide === 2) return 'Right'
  if (entrySide === 4 || entrySide === 5) return 'Left'
  return 'Bottom'
}

function enemyLegionsOn(state: GameState, hexLabel: string, playerId: string): Legion[] {
  return state.legions.filter((l) => l.hexLabel === hexLabel && l.playerId !== playerId)
}

function friendlyLegionsOn(state: GameState, hexLabel: string, playerId: string): Legion[] {
  return state.legions.filter((l) => l.hexLabel === hexLabel && l.playerId === playerId)
}

function isOccupied(state: GameState, hexLabel: string): boolean {
  return state.legions.some((l) => l.hexLabel === hexLabel)
}

/**
 * Port of Movement.findNormalMoves — returns hexLabel:entrySide tuples.
 */
function findNormalMoves(
  state: GameState,
  board: BuiltBoard,
  hexLabel: string,
  legion: Legion,
  roll: number,
  block: number,
  cameFrom: number,
): Set<string> {
  const result = new Set<string>()
  const hex = board.hexByLabel[hexLabel]
  if (!hex) return result

  const enemies = enemyLegionsOn(state, hexLabel, legion.playerId)
  if (enemies.length > 0 && cameFrom !== NOWHERE) {
    const friends = friendlyLegionsOn(state, hexLabel, legion.playerId)
    if (friends.length === 0) {
      result.add(`${hexLabel}:${findEntrySide(hex, cameFrom)}`)
    }
    return result
  }

  if (roll === 0) {
    const friends = friendlyLegionsOn(state, hexLabel, legion.playerId).filter(
      (l) => l.id !== legion.id,
    )
    if (friends.length > 0) return result
    if (cameFrom !== NOWHERE) {
      result.add(`${hexLabel}:${findEntrySide(hex, cameFrom)}`)
    }
    return result
  }

  if (roll < 0) return result

  const trySide = (side: number, nextBlock: number) => {
    const neighbor = hex.neighbors[side]
    if (!neighbor) return
    const nested = findNormalMoves(
      state,
      board,
      neighbor,
      legion,
      roll - 1,
      nextBlock,
      (side + 3) % 6,
    )
    for (const t of nested) result.add(t)
  }

  if (block >= 0) {
    trySide(block, ARROWS_ONLY)
  } else if (block === ARCHES_AND_ARROWS) {
    for (let i = 0; i < 6; i++) {
      if (GATE_ORDINAL[hex.exitType[i]] >= GATE_ORDINAL.ARCH && i !== cameFrom) {
        trySide(i, ARROWS_ONLY)
      }
    }
  } else if (block === ARROWS_ONLY) {
    for (let i = 0; i < 6; i++) {
      if (GATE_ORDINAL[hex.exitType[i]] >= GATE_ORDINAL.ARROW && i !== cameFrom) {
        trySide(i, ARROWS_ONLY)
      }
    }
  }

  return result
}

function findNearbyUnoccupied(
  state: GameState,
  board: BuiltBoard,
  hexLabel: string,
  roll: number,
  cameFrom: number,
  visited: Set<string>,
): Set<string> {
  const result = new Set<string>()
  if (visited.has(`${hexLabel}:${roll}:${cameFrom}`)) return result
  visited.add(`${hexLabel}:${roll}:${cameFrom}`)
  const hex = board.hexByLabel[hexLabel]
  if (!hex) return result
  if (!isOccupied(state, hexLabel)) result.add(hexLabel)
  if (roll <= 0) return result
  for (let i = 0; i < 6; i++) {
    if (i === cameFrom) continue
    if (hex.exitType[i] === 'NONE' && hex.entranceType[i] === 'NONE') continue
    const n = hex.neighbors[i]
    if (!n) continue
    for (const h of findNearbyUnoccupied(state, board, n, roll - 1, (i + 3) % 6, visited)) {
      result.add(h)
    }
  }
  return result
}

export function listTeleportMoves(state: GameState, legion: Legion, roll: number): Set<string> {
  const result = new Set<string>()
  if (roll !== 6 || legion.moved) return result
  const player = state.players.find((p) => p.id === legion.playerId)
  if (!player || player.hasTeleported) return result
  const board = state.variant.board
  const hex = board.hexByLabel[legion.hexLabel]
  if (!hex) return result

  // Tower teleport
  if (hex.terrain === 'Tower' && legion.creatures.some((c) => {
    const t = state.variant.creatures[c.type]
    return t?.lord || t?.demilord
  })) {
    for (const h of findNearbyUnoccupied(state, board, legion.hexLabel, 6, NOWHERE, new Set())) {
      if (h !== legion.hexLabel) result.add(h)
    }
    for (const tower of board.towers) {
      if (tower !== legion.hexLabel && !isOccupied(state, tower)) result.add(tower)
    }
  }

  // Titan teleport: Colossus score >= titan_teleport (Default 400 ≈ power 10)
  const teleportScore = state.variant.data.titanTeleport ?? 400
  if (legion.creatures.some((c) => c.type === 'Titan') && player.score >= teleportScore) {
    for (const other of state.legions) {
      if (other.playerId === legion.playerId) continue
      const friends = friendlyLegionsOn(state, other.hexLabel, legion.playerId)
      if (friends.length === 0) result.add(other.hexLabel)
    }
  }

  return result
}

export function listNormalMoveHexes(state: GameState, legion: Legion, roll: number): Map<string, EntrySide> {
  const map = new Map<string, EntrySide>()
  if (legion.moved || roll < 1) return map
  const board = state.variant.board
  const hex = board.hexByLabel[legion.hexLabel]
  if (!hex) return map
  const tuples = findNormalMoves(state, board, legion.hexLabel, legion, roll, findBlock(hex), NOWHERE)
  for (const tuple of tuples) {
    const [label, side] = tuple.split(':') as [string, EntrySide]
    if (!map.has(label)) map.set(label, side)
  }
  return map
}

export function listAllMoves(state: GameState, legion: Legion, roll: number): Map<string, { side: EntrySide; teleport: boolean }> {
  const result = new Map<string, { side: EntrySide; teleport: boolean }>()
  for (const [hex, side] of listNormalMoveHexes(state, legion, roll)) {
    result.set(hex, { side, teleport: false })
  }
  for (const hex of listTeleportMoves(state, legion, roll)) {
    if (!result.has(hex)) result.set(hex, { side: 'Bottom', teleport: true })
  }
  return result
}

export function rollDie(rng: () => number): number {
  return 1 + Math.floor(rng() * 6)
}
