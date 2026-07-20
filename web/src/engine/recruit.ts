import type { CreatureType, TerrainDef } from '../types/variant'
import type { GameState, Legion } from './types'

const NO_RECRUIT = 99

const WILDCARD = new Set(['Anything', 'AnyNonLord', 'Lord', 'DemiLord'])

export function countCreatures(legion: Legion, type: string): number {
  return legion.creatures.filter((c) => c.type === type).length
}

export function isLord(creatures: Record<string, CreatureType>, type: string): boolean {
  const c = creatures[type]
  return Boolean(c?.lord || c?.demilord)
}

/**
 * Colossus `CreatureType.isImmortal` — Lords/Demi-Lords recycle to the caretaker.
 * Titans are lords but not immortal; ordinary creatures are removed from the game when slain.
 */
export function isImmortal(creatures: Record<string, CreatureType>, type: string): boolean {
  if (type === 'Titan') return false
  return isLord(creatures, type)
}

/** Return a slain character to caretaker stacks only if immortal (Angel, Archangel, Guardian, Warlock). */
export function returnEliminatedCreature(state: GameState, creatureType: string): void {
  if (!isImmortal(state.variant.creatures, creatureType)) return
  state.caretaker[creatureType] = (state.caretaker[creatureType] ?? 0) + 1
}

function isConcreteCreature(name: string): boolean {
  return !WILDCARD.has(name) && !name.startsWith('Special:')
}

export type RecruitEdge = {
  /** Recruiter name or wildcard (Anything, AnyNonLord, Lord, DemiLord, Titan, …). */
  from: string
  to: string
  number: number
}

/**
 * Colossus TerrainRecruitLoader.addToGraph — consecutive Ter.xml pairs become edges.
 * Titan / negative-number steps are recruiters only (never recruit targets).
 */
export function buildRecruitEdges(terrain: TerrainDef): RecruitEdge[] {
  const rl = terrain.recruits
  const edges: RecruitEdge[] = []
  let v1: string | null = null
  for (let i = 0; i < rl.length; i++) {
    const tr = rl[i]!
    const v2 = tr.name
    if (v2 && v2 !== 'Titan' && isConcreteCreature(v2) && tr.number >= 0) {
      if (v1 != null) {
        edges.push({ from: v1, to: v2, number: tr.number })
      }
      // Self-recruit; with regularRecruit also recruit any earlier concrete step
      for (let j = 0; j <= i; j++) {
        if (!(j === i || terrain.regularRecruit)) continue
        const tr2 = rl[j]!
        const v3 = tr2.name
        if (!isConcreteCreature(v3) || v3 === 'Titan') continue
        if (tr2.number > 0) edges.push({ from: v2, to: v3, number: 1 })
        else if (tr2.number === 0) edges.push({ from: v2, to: v3, number: 0 })
      }
    }
    v1 = v2
  }
  return edges
}

function edgeMatchesRecruiter(
  edgeFrom: string,
  recruiter: string,
  creatures: Record<string, CreatureType>,
): boolean {
  if (edgeFrom === recruiter) return true
  if (edgeFrom === 'Anything') return true
  if (edgeFrom === 'AnyNonLord') return !isLord(creatures, recruiter)
  if (edgeFrom === 'Lord') return Boolean(creatures[recruiter]?.lord)
  if (edgeFrom === 'DemiLord') return Boolean(creatures[recruiter]?.demilord)
  return false
}

/**
 * Colossus RecruitGraph.numberOfRecruiterNeeded for one terrain.
 */
export function numberOfRecruiterNeeded(
  terrain: TerrainDef,
  recruiter: string,
  recruit: string,
  creatures: Record<string, CreatureType>,
): number {
  let min = NO_RECRUIT
  for (const e of buildRecruitEdges(terrain)) {
    if (e.to !== recruit) continue
    if (!edgeMatchesRecruiter(e.from, recruiter, creatures)) continue
    if (e.number < min) min = e.number
  }
  return min
}

/**
 * Regular / tower / Abyss muster from the terrain recruit graph.
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

  const edges = buildRecruitEdges(terrain)
  if (edges.length === 0) return []
  const creatures = state.variant.creatures
  const available: string[] = []
  for (const recruit of new Set(edges.map((e) => e.to))) {
    if ((state.caretaker[recruit] ?? 0) <= 0) continue
    for (const c of legion.creatures) {
      const needed = numberOfRecruiterNeeded(terrain, c.type, recruit, creatures)
      if (needed < NO_RECRUIT && countCreatures(legion, c.type) >= needed) {
        available.push(recruit)
        break
      }
    }
  }
  return available
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
    splitThisTurn: false,
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

export { NO_RECRUIT }
