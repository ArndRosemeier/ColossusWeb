import type { CreatureType, TerrainDef } from '../types/variant'
import type { GameState, Legion } from './types'

const NO_RECRUIT = 99

export function countCreatures(legion: Legion, type: string): number {
  return legion.creatures.filter((c) => c.type === type).length
}

export function isLord(creatures: Record<string, CreatureType>, type: string): boolean {
  const c = creatures[type]
  return Boolean(c?.lord || c?.demilord)
}

function isConcreteRecruit(name: string): boolean {
  return (
    name !== 'Anything' &&
    name !== 'AnyNonLord' &&
    name !== 'Lord' &&
    name !== 'DemiLord' &&
    name !== 'Titan' &&
    !name.startsWith('Special:')
  )
}

/**
 * Colossus TerrainRecruitLoader / RecruitGraph edges for a regular terrain:
 * - N of previous step recruits the next (N from that step's number)
 * - 1 of a creature recruits itself (when its step number > 0)
 * - with regularRecruit, 1 of any higher tree creature recruits any lower
 */
export function numberOfRecruiterNeeded(
  terrain: TerrainDef,
  recruiter: string,
  recruit: string,
): number {
  const steps = terrain.recruits.filter((s) => isConcreteRecruit(s.name))
  const recruitIdx = steps.findIndex((s) => s.name === recruit)
  const recruiterIdx = steps.findIndex((s) => s.name === recruiter)
  if (recruitIdx < 0 || recruiterIdx < 0) return NO_RECRUIT

  const recruitStep = steps[recruitIdx]
  if (recruiter === recruit) {
    if (recruitStep.number > 0) return 1
    if (recruitStep.number === 0) return 0
    return NO_RECRUIT
  }

  // Direct climb: previous recruits next with that step's number
  if (recruiterIdx === recruitIdx - 1 && recruitStep.number > 0) {
    return recruitStep.number
  }

  // regularRecruit: higher creatures can recruit any lower with 1
  if (terrain.regularRecruit && recruiterIdx > recruitIdx) {
    return 1
  }

  return NO_RECRUIT
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

  const steps = terrain.recruits.filter((s) => isConcreteRecruit(s.name))
  const available: string[] = []
  for (const step of steps) {
    if ((state.caretaker[step.name] ?? 0) <= 0) continue
    for (const c of legion.creatures) {
      const needed = numberOfRecruiterNeeded(terrain, c.type, step.name)
      if (needed < NO_RECRUIT && countCreatures(legion, c.type) >= needed) {
        available.push(step.name)
        break
      }
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

/**
 * What this legion could muster if it ended its move on hexLabel
 * (Colossus possible-recruit chits during Move highlighting).
 */
export function listRecruitOptionsAt(
  state: GameState,
  legion: Legion,
  hexLabel: string,
): string[] {
  if (legion.creatures.length > 6) return []
  const phantom: Legion = {
    ...legion,
    hexLabel,
    moved: true,
    recruited: false,
    musteredThisTurn: null,
  }
  return listRecruits(state, phantom)
}

/** Strongest eligible recruit for a legion on its current hex (Muster phase). */
export function bestRecruit(state: GameState, legion: Legion): string | null {
  const options = listRecruits(state, legion)
  if (options.length === 0) return null
  let best = options[0]!
  let bestRank = -1
  for (const name of options) {
    const t = state.variant.creatures[name]
    const rank = (t?.power ?? 0) * (t?.skill ?? 0)
    if (rank >= bestRank) {
      bestRank = rank
      best = name
    }
  }
  return best
}

/** Strongest eligible recruit at a destination (by power × skill). */
export function bestRecruitAt(
  state: GameState,
  legion: Legion,
  hexLabel: string,
): string | null {
  const options = listRecruitOptionsAt(state, legion, hexLabel)
  if (options.length === 0) return null
  let best = options[0]!
  let bestRank = -1
  for (const name of options) {
    const t = state.variant.creatures[name]
    const rank = (t?.power ?? 0) * (t?.skill ?? 0)
    if (rank >= bestRank) {
      bestRank = rank
      best = name
    }
  }
  return best
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
  legion.musteredThisTurn = creatureType
}
