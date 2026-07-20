/**
 * Battle movement — Colossus BattleMovementServerSide (skill budget, flyers, contact).
 * Off-board units start on a virtual entrance: land on an entry hex (costs skill), then
 * may continue inland with remaining skill in the same move.
 */
import type { BuiltBattleland } from './battleland'
import { battleNeighbors, canFlyOver, getEntryCost, IMPASSABLE_COST, meleeNeighbors } from './battleland'
import type { BattleState, BattleUnit, GameState } from './types'
import { getUnitSkill, isUnitAlive } from './battleStrike'
import type { CreatureType } from '../types/variant'

export function isInContact(
  state: GameState,
  battle: BattleState,
  land: BuiltBattleland,
  unit: BattleUnit,
): boolean {
  if (!unit.hex || !isUnitAlive(state, unit)) return false
  // Cliffs break contact (Colossus / Titan: adjacent across cliff ≠ engaged).
  for (const n of meleeNeighbors(land, unit.hex)) {
    if (
      battle.units.some(
        (u) => u.hex === n && u.playerId !== unit.playerId && isUnitAlive(state, u),
      )
    ) {
      return true
    }
  }
  return false
}

function entrancesFor(battle: BattleState, unit: BattleUnit): string[] {
  return unit.legionId === battle.attackerLegionId
    ? battle.attackerEntrances
    : battle.defenderEntrances
}

/**
 * Recursively find moves from `hex` (Colossus findMoves).
 * `cameFrom` is the hexside entered from (-1 = none / do not block any side).
 */
function findMoves(
  land: BuiltBattleland,
  creature: CreatureType,
  occupied: Set<string>,
  hex: string,
  movesLeft: number,
  cameFrom: number,
  flies: boolean,
): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < 6; i++) {
    if (i === cameFrom) continue
    const neighbor = land.hexByLabel[hex]?.neighbors[i]
    if (!neighbor) continue

    const reverseDir = (i + 3) % 6
    const nHex = land.hexByLabel[neighbor]
    if (!nHex) continue

    const blocked = occupied.has(neighbor)
    const entryCost = blocked
      ? IMPASSABLE_COST
      : getEntryCost(land, nHex, creature, reverseDir)

    if (entryCost < IMPASSABLE_COST && entryCost <= movesLeft) {
      set.add(neighbor)
      if (!flies && movesLeft > entryCost) {
        for (const m of findMoves(
          land,
          creature,
          occupied,
          neighbor,
          movesLeft - entryCost,
          reverseDir,
          flies,
        )) {
          set.add(m)
        }
      }
    }

    // Fliers fly over for 1 MP (Colossus); may continue over occupied hexes
    if (flies && movesLeft > 1 && canFlyOver(nHex, creature)) {
      for (const m of findMoves(
        land,
        creature,
        occupied,
        neighbor,
        movesLeft - 1,
        reverseDir,
        flies,
      )) {
        set.add(m)
      }
    }
  }
  return set
}

/**
 * From off-board: treat each free entrance landing as the first step from a virtual
 * entrance hex (full skill), then continue inland like Colossus showMoves.
 */
function findEntryMoves(
  land: BuiltBattleland,
  creature: CreatureType,
  occupied: Set<string>,
  entrances: string[],
  skill: number,
): Set<string> {
  const set = new Set<string>()
  const flies = creature.flies
  for (const label of entrances) {
    if (occupied.has(label)) continue
    const hex = land.hexByLabel[label]
    if (!hex) continue
    // Entering the board from the rim: no hexside hazard from the virtual entrance
    const entryCost = getEntryCost(land, hex, creature, -1)
    if (entryCost >= IMPASSABLE_COST || entryCost > skill) continue

    set.add(label)
    if (!flies && skill > entryCost) {
      for (const m of findMoves(land, creature, occupied, label, skill - entryCost, -1, false)) {
        set.add(m)
      }
    }
    if (flies && skill > 1) {
      // After spending 1 to leave the virtual entrance onto `label`, fly onward
      for (const m of findMoves(land, creature, occupied, label, skill - 1, -1, true)) {
        set.add(m)
      }
    }
  }
  return set
}

export function legalBattleMoves(
  state: GameState,
  battle: BattleState,
  land: BuiltBattleland,
  unit: BattleUnit,
): string[] {
  if (unit.moved || !isUnitAlive(state, unit)) return []
  const creature = state.variant.creatures[unit.creatureType]
  if (!creature) return []

  if (unit.hex && isInContact(state, battle, land, unit)) {
    return []
  }

  const occupied = new Set(
    battle.units.filter((u) => u.id !== unit.id && isUnitAlive(state, u) && u.hex).map((u) => u.hex!),
  )

  const skill = getUnitSkill(state, unit)

  if (!unit.hex) {
    return [...findEntryMoves(land, creature, occupied, entrancesFor(battle, unit), skill)]
  }

  const result = findMoves(land, creature, occupied, unit.hex, skill, -1, creature.flies)
  result.delete(unit.hex)
  return [...result]
}
