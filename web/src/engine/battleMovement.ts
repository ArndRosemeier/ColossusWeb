/**
 * Battle movement — Colossus BattleMovementServerSide (skill budget, flyers, contact).
 */
import type { BuiltBattleland } from './battleland'
import { battleNeighbors, canFlyOver, getEntryCost, IMPASSABLE_COST } from './battleland'
import type { BattleState, BattleUnit, GameState } from './types'
import { getUnitSkill, isUnitAlive } from './battleStrike'

export function isInContact(
  state: GameState,
  battle: BattleState,
  land: BuiltBattleland,
  unit: BattleUnit,
): boolean {
  if (!unit.hex || !isUnitAlive(state, unit)) return false
  for (const n of battleNeighbors(land, unit.hex)) {
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

export function legalBattleMoves(
  state: GameState,
  battle: BattleState,
  land: BuiltBattleland,
  unit: BattleUnit,
): string[] {
  if (unit.moved || !isUnitAlive(state, unit)) return []
  const creature = state.variant.creatures[unit.creatureType]
  if (!creature) return []

  // Contact lock (cliff exception omitted if not on cliff hexside — Colossus gates leave)
  if (unit.hex && isInContact(state, battle, land, unit)) {
    return []
  }

  const occupied = new Set(
    battle.units.filter((u) => u.id !== unit.id && isUnitAlive(state, u) && u.hex).map((u) => u.hex!),
  )

  const skill = getUnitSkill(state, unit)
  const result = new Set<string>()

  // Enter from off-board
  if (!unit.hex) {
    const entrances =
      unit.legionId === battle.attackerLegionId
        ? battle.attackerEntrances
        : battle.defenderEntrances
    for (const label of entrances) {
      if (occupied.has(label)) continue
      const hex = land.hexByLabel[label]
      if (!hex) continue
      const cost = getEntryCost(land, hex, creature, -1)
      if (cost <= skill && cost < IMPASSABLE_COST) result.add(label)
    }
    return [...result]
  }

  if (creature.flies) {
    // BFS fly-over with landing cost
    const queue: { label: string; dist: number }[] = [{ label: unit.hex, dist: 0 }]
    const seen = new Set<string>([unit.hex])
    while (queue.length) {
      const cur = queue.shift()!
      if (cur.dist >= skill) continue
      for (const n of battleNeighbors(land, cur.label)) {
        const nHex = land.hexByLabel[n]
        if (!nHex || seen.has(n)) continue
        if (!canFlyOver(nHex, creature) && occupied.has(n)) continue
        if (!canFlyOver(nHex, creature)) continue
        seen.add(n)
        const nextDist = cur.dist + 1
        if (nextDist > skill) continue
        queue.push({ label: n, dist: nextDist })
        if (!occupied.has(n)) {
          const cameFrom = land.hexByLabel[cur.label]?.neighbors.findIndex((x) => x === n) ?? -1
          const landCost = getEntryCost(land, nHex, creature, cameFrom >= 0 ? (cameFrom + 3) % 6 : -1)
          // Remaining move must cover landing — Colossus: cost to land counted in path
          if (landCost < IMPASSABLE_COST && nextDist + Math.max(0, landCost - 1) <= skill) {
            result.add(n)
          } else if (landCost <= 1 && nextDist <= skill) {
            result.add(n)
          }
        }
      }
    }
  } else {
    // Ground: recursive entry costs
    const visit = (label: string, remaining: number, cameFrom: number) => {
      for (let side = 0; side < 6; side++) {
        if (side === cameFrom) continue
        const n = land.hexByLabel[label]?.neighbors[side]
        if (!n || occupied.has(n)) continue
        const nHex = land.hexByLabel[n]
        if (!nHex) continue
        const enterSide = (side + 3) % 6
        const cost = getEntryCost(land, nHex, creature, enterSide)
        if (cost >= IMPASSABLE_COST || cost > remaining) continue
        result.add(n)
        if (remaining - cost > 0) visit(n, remaining - cost, enterSide)
      }
    }
    visit(unit.hex, skill, -1)
  }

  result.delete(unit.hex)
  return [...result]
}
