/**
 * Reconstruct a legal walk path for move animations (masterboard + battle).
 */
import type { GateType, MasterHex } from '../types/variant'
import type { BattleState, BattleUnit, GameState, Legion } from './types'
import { battleLand } from './battle'
import {
  type BuiltBattleland,
  canFlyOver,
  getEntryCost,
  IMPASSABLE_COST,
} from './battleland'
import { getUnitSkill, isUnitAlive } from './battleStrike'
import { listTeleportMoves } from './movement'
import type { CreatureType } from '../types/variant'

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
    if (hex.exitType[j] === 'BLOCK') block = j
  }
  return block
}

function enemyLegionsOn(state: GameState, hexLabel: string, playerId: string): Legion[] {
  return state.legions.filter((l) => l.hexLabel === hexLabel && l.playerId !== playerId)
}

function friendlyLegionsOn(state: GameState, hexLabel: string, playerId: string): Legion[] {
  return state.legions.filter((l) => l.hexLabel === hexLabel && l.playerId === playerId)
}

/**
 * One legal masterboard walk from legion hex to `toHex` (inclusive), or null.
 * Mirrors Movement.findNormalMoves / exact-roll + engagement stop.
 */
export function findMasterMovePath(
  state: GameState,
  legion: Legion,
  roll: number,
  toHex: string,
): string[] | null {
  if (legion.hexLabel === toHex) return [toHex]
  const board = state.variant.board
  const start = board.hexByLabel[legion.hexLabel]
  if (!start || roll < 1) return null

  type Node = { hex: string; roll: number; block: number; cameFrom: number; path: string[] }
  const q: Node[] = [
    {
      hex: legion.hexLabel,
      roll,
      block: findBlock(start),
      cameFrom: NOWHERE,
      path: [legion.hexLabel],
    },
  ]
  const seen = new Set<string>()

  while (q.length) {
    const cur = q.shift()!
    const key = `${cur.hex}:${cur.roll}:${cur.block}:${cur.cameFrom}`
    if (seen.has(key)) continue
    seen.add(key)

    const hex = board.hexByLabel[cur.hex]
    if (!hex) continue

    const enemies = enemyLegionsOn(state, cur.hex, legion.playerId)
    if (enemies.length > 0 && cur.cameFrom !== NOWHERE) {
      const friends = friendlyLegionsOn(state, cur.hex, legion.playerId)
      if (friends.length === 0 && cur.hex === toHex) return cur.path
      continue
    }

    if (cur.roll === 0) {
      if (cur.cameFrom !== NOWHERE && cur.hex === toHex) {
        const friends = friendlyLegionsOn(state, cur.hex, legion.playerId).filter(
          (l) => l.id !== legion.id,
        )
        if (friends.length === 0) return cur.path
      }
      continue
    }

    const trySide = (side: number, nextBlock: number) => {
      const neighbor = hex.neighbors[side]
      if (!neighbor) return
      q.push({
        hex: neighbor,
        roll: cur.roll - 1,
        block: nextBlock,
        cameFrom: (side + 3) % 6,
        path: [...cur.path, neighbor],
      })
    }

    if (cur.block >= 0) {
      trySide(cur.block, ARROWS_ONLY)
    } else if (cur.block === ARCHES_AND_ARROWS) {
      for (let i = 0; i < 6; i++) {
        if (GATE_ORDINAL[hex.exitType[i]] >= GATE_ORDINAL.ARCH && i !== cur.cameFrom) {
          trySide(i, ARROWS_ONLY)
        }
      }
    } else if (cur.block === ARROWS_ONLY) {
      for (let i = 0; i < 6; i++) {
        if (GATE_ORDINAL[hex.exitType[i]] >= GATE_ORDINAL.ARROW && i !== cur.cameFrom) {
          trySide(i, ARROWS_ONLY)
        }
      }
    }
  }
  return null
}

export function isMasterTeleport(
  state: GameState,
  legion: Legion,
  roll: number,
  toHex: string,
): boolean {
  return listTeleportMoves(state, legion, roll).has(toHex)
}

function entrancesFor(battle: BattleState, unit: BattleUnit): string[] {
  return unit.legionId === battle.attackerLegionId
    ? battle.attackerEntrances
    : battle.defenderEntrances
}

/** Mirror battleMovement.findMoves, returning the first path that reaches `target`. */
function findMovesPath(
  land: BuiltBattleland,
  creature: CreatureType,
  occupied: Set<string>,
  hex: string,
  movesLeft: number,
  cameFrom: number,
  flies: boolean,
  path: string[],
  target: string,
): string[] | null {
  for (let i = 0; i < 6; i++) {
    if (i === cameFrom) continue
    const neighbor = land.hexByLabel[hex]?.neighbors[i]
    if (!neighbor) continue

    const reverseDir = (i + 3) % 6
    const nHex = land.hexByLabel[neighbor]
    if (!nHex) continue

    const blocked = occupied.has(neighbor)
    const entryCost = blocked ? IMPASSABLE_COST : getEntryCost(land, nHex, creature, reverseDir)

    if (entryCost < IMPASSABLE_COST && entryCost <= movesLeft) {
      const landPath = [...path, neighbor]
      if (neighbor === target) return landPath
      if (!flies && movesLeft > entryCost) {
        const found = findMovesPath(
          land,
          creature,
          occupied,
          neighbor,
          movesLeft - entryCost,
          reverseDir,
          flies,
          landPath,
          target,
        )
        if (found) return found
      }
    }

    if (flies && movesLeft > 1 && canFlyOver(nHex, creature)) {
      const flyPath = [...path, neighbor]
      const found = findMovesPath(
        land,
        creature,
        occupied,
        neighbor,
        movesLeft - 1,
        reverseDir,
        flies,
        flyPath,
        target,
      )
      if (found) return found
    }
  }
  return null
}

/**
 * Battle walk path (hex labels). Off-board units start at an entrance landing.
 */
export function findBattleMovePath(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
  toHex: string,
): string[] | null {
  const land = battleLand(state, battle)
  const creature = state.variant.creatures[unit.creatureType]
  if (!creature || !isUnitAlive(state, unit)) return null
  if (unit.hex === toHex) return unit.hex ? [unit.hex] : null

  const occupied = new Set(
    battle.units
      .filter((u) => u.id !== unit.id && isUnitAlive(state, u) && u.hex)
      .map((u) => u.hex!),
  )
  const skill = getUnitSkill(state, unit)
  const flies = creature.flies

  if (!unit.hex) {
    for (const label of entrancesFor(battle, unit)) {
      if (occupied.has(label)) continue
      const hex = land.hexByLabel[label]
      if (!hex) continue
      const entryCost = getEntryCost(land, hex, creature, -1)
      if (entryCost >= IMPASSABLE_COST || entryCost > skill) continue

      const path = [label]
      if (label === toHex) return path

      if (!flies && skill > entryCost) {
        const found = findMovesPath(
          land,
          creature,
          occupied,
          label,
          skill - entryCost,
          -1,
          false,
          path,
          toHex,
        )
        if (found) return found
      }
      if (flies && skill > 1) {
        const found = findMovesPath(
          land,
          creature,
          occupied,
          label,
          skill - 1,
          -1,
          true,
          path,
          toHex,
        )
        if (found) return found
      }
    }
    return null
  }

  return findMovesPath(land, creature, occupied, unit.hex, skill, -1, flies, [unit.hex], toHex)
}

export function fallbackPath(from: string | null, to: string): string[] {
  if (from == null) return [to]
  if (from === to) return [from]
  return [from, to]
}

export type MasterMovePathInfo = {
  path: string[]
  teleport: boolean
}

export function masterMovePathInfo(
  state: GameState,
  legion: Legion,
  roll: number,
  toHex: string,
  teleport?: boolean,
): MasterMovePathInfo {
  const isTp = teleport ?? isMasterTeleport(state, legion, roll, toHex)
  if (isTp) {
    return { path: [legion.hexLabel, toHex], teleport: true }
  }
  const path = findMasterMovePath(state, legion, roll, toHex)
  return {
    path: path ?? fallbackPath(legion.hexLabel, toHex),
    teleport: false,
  }
}

export function battleMovePathInfo(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
  toHex: string,
): { path: string[]; fromOffBoard: boolean } {
  const path = findBattleMovePath(state, battle, unit, toHex)
  return {
    path: path ?? fallbackPath(unit.hex, toHex),
    fromOffBoard: unit.hex == null,
  }
}
