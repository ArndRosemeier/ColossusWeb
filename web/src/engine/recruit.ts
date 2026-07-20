import type { CreatureType, TerrainDef } from '../types/variant'
import type { GameState, Legion } from './types'

export function countCreatures(legion: Legion, type: string): number {
  return legion.creatures.filter((c) => c.type === type).length
}

export function isLord(creatures: Record<string, CreatureType>, type: string): boolean {
  const c = creatures[type]
  return Boolean(c?.lord || c?.demilord)
}

/**
 * Regular recruit: climb the recruit tree for this terrain.
 * Titan/Colossus: only a legion that moved this turn may muster,
 * and only if height <= 6 (so result is at most 7).
 */
export function listRecruits(state: GameState, legion: Legion): string[] {
  if (!legion.moved) return []
  if (legion.recruited) return []
  if (legion.creatures.length > 6) return []
  const hex = state.variant.board.hexByLabel[legion.hexLabel]
  if (!hex) return []
  const terrain = state.variant.terrains[hex.terrain]
  if (!terrain) return []

  if (hex.terrain === 'Tower') {
    return listTowerRecruits(state, legion, terrain)
  }
  if (!terrain.regularRecruit) return []

  const available: string[] = []
  const steps = terrain.recruits
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (step.name === 'Anything' || step.name === 'AnyNonLord') continue
    if ((state.caretaker[step.name] ?? 0) <= 0) continue

    if (i === 0) {
      // Lowest creature of the terrain: always available with space + caretaker stock
      available.push(step.name)
      continue
    }
    const prev = steps[i - 1]
    const need = step.number
    if (need <= 0) continue
    if (countCreatures(legion, prev.name) >= need) {
      available.push(step.name)
    }
  }
  return [...new Set(available)]
}

function listTowerRecruits(state: GameState, legion: Legion, terrain: TerrainDef): string[] {
  const available: string[] = []
  // Simplified tower: Centaur/Gargoyle/Ogre always; Warlock if has Titan; Guardian if 3 of same non-lord
  const basics = ['Centaur', 'Gargoyle', 'Ogre']
  for (const b of basics) {
    if ((state.caretaker[b] ?? 0) > 0) available.push(b)
  }
  if (legion.creatures.some((c) => c.type === 'Titan') && (state.caretaker.Warlock ?? 0) > 0) {
    available.push('Warlock')
  }
  const nonLords = legion.creatures.filter((c) => !isLord(state.variant.creatures, c.type))
  const counts = new Map<string, number>()
  for (const c of nonLords) counts.set(c.type, (counts.get(c.type) ?? 0) + 1)
  for (const n of counts.values()) {
    if (n >= 3 && (state.caretaker.Guardian ?? 0) > 0) {
      available.push('Guardian')
      break
    }
  }
  void terrain
  return [...new Set(available)]
}

export function applyRecruit(state: GameState, legionId: string, creatureType: string): void {
  const legion = state.legions.find((l) => l.id === legionId)
  if (!legion) throw new Error('Legion not found')
  const options = listRecruits(state, legion)
  if (!options.includes(creatureType)) throw new Error(`Cannot recruit ${creatureType}`)
  if ((state.caretaker[creatureType] ?? 0) <= 0) throw new Error('Caretaker empty')
  state.caretaker[creatureType] -= 1
  legion.creatures.push({ type: creatureType, hits: 0 })
  legion.recruited = true
}
