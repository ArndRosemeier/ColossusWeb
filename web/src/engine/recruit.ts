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

/** Tie-breaker only — fly / rangestrike matter, but development dominates. */
const MUSTER_FLY_BONUS = 1
const MUSTER_RANGESTRIKE_BONUS = 1
const MUSTER_MAGIC_MISSILE_BONUS = 1
/** How strongly future unlocks (e.g. 3 Cyclops → Behemoth) outweigh immediate PV. */
const MUSTER_DEVELOPMENT_WEIGHT = 1.35

/**
 * Primary upgrade edges only (consecutive Ter.xml steps), not regularRecruit
 * “recruit any earlier / self” edges — those point down the tree and must not
 * look like progress toward apex units.
 */
export function buildPrimaryRecruitEdges(terrain: TerrainDef): RecruitEdge[] {
  const rl = terrain.recruits
  const edges: RecruitEdge[] = []
  let prev: string | null = null
  for (const tr of rl) {
    const name = tr.name
    if (name && name !== 'Titan' && isConcreteCreature(name) && tr.number > 0) {
      if (prev != null && isConcreteCreature(prev) && prev !== 'Titan') {
        edges.push({ from: prev, to: name, number: tr.number })
      }
      prev = name
    } else {
      // Wildcards / Titan / zero-number tower steps break the upgrade chain
      prev = isConcreteCreature(name) && name !== 'Titan' ? name : null
    }
  }
  return edges
}

type DevelopmentEdge = {
  recruiter: string
  recruit: string
  needed: number
}

const developmentEdgeCache = new WeakMap<object, DevelopmentEdge[]>()

/**
 * Concrete recruiter→recruit upgrade edges across every terrain (variant-agnostic).
 */
export function listDevelopmentEdges(state: GameState): DevelopmentEdge[] {
  const terrains = state.variant.terrains as object
  const cached = developmentEdgeCache.get(terrains)
  if (cached) return cached

  const creatures = state.variant.creatures
  const edges: DevelopmentEdge[] = []
  const seen = new Set<string>()
  for (const terrain of Object.values(state.variant.terrains)) {
    for (const e of buildPrimaryRecruitEdges(terrain)) {
      if (!creatures[e.from] || !creatures[e.to]) continue
      const key = `${e.from}>${e.to}:${e.number}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ recruiter: e.from, recruit: e.to, needed: e.number })
    }
  }
  developmentEdgeCache.set(terrains, edges)
  return edges
}

/** Immediate combat / tactics value of adding this creature type. */
export function intrinsicMusterValue(state: GameState, creatureType: string): number {
  const def = state.variant.creatures[creatureType]
  if (!def) return 0
  let score = def.power * def.skill
  if (def.flies) score += MUSTER_FLY_BONUS
  if (def.rangestrikes) score += MUSTER_RANGESTRIKE_BONUS
  if (def.magicMissile) score += MUSTER_MAGIC_MISSILE_BONUS
  return score
}

function countByType(legion: Legion): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const c of legion.creatures) {
    counts[c.type] = (counts[c.type] ?? 0) + 1
  }
  return counts
}

/**
 * How far this composition is toward unlocking higher-tier musters on any terrain.
 * Only upward primary edges count (recruit stronger than recruiter). Progress is
 * squared so finishing the last recruiter (2/3 → 3/3) jumps more than starting
 * a new low-tier stack (0 → 1/3).
 *
 * `minTargetExclusive`: ignore unlocks that are not strictly stronger than this
 * (used so a Marsh stack of Trolls does not prefer recruiting an Ogre just to
 * dabble toward Minotaurs).
 */
export function compositionDevelopmentValue(
  state: GameState,
  counts: Record<string, number>,
  minTargetExclusive = 0,
): number {
  let total = 0
  for (const e of listDevelopmentEdges(state)) {
    const have = counts[e.recruiter] ?? 0
    if (have <= 0) continue
    const fromVal = intrinsicMusterValue(state, e.recruiter)
    const toVal = intrinsicMusterValue(state, e.recruit)
    if (toVal <= fromVal) continue
    if (toVal <= minTargetExclusive) continue
    const progress = Math.min(have / e.needed, 1)
    total += toVal * progress * progress
  }
  return total
}

/**
 * Rank a legal muster option for AI / Enter auto-pick / move previews.
 * Immediate ability-aware value + how much the new composition advances toward
 * the biggest units elsewhere in the variant's recruit graphs.
 */
export function scoreRecruitOption(
  state: GameState,
  creatureType: string,
  _hexLabel: string,
  legion: Legion,
): number {
  if (!state.variant.creatures[creatureType]) return -1
  const beforeCounts = countByType(legion)
  const afterCounts = { ...beforeCounts }
  afterCounts[creatureType] = (afterCounts[creatureType] ?? 0) + 1

  let maxOwned = 0
  for (const type of Object.keys(beforeCounts)) {
    maxOwned = Math.max(maxOwned, intrinsicMusterValue(state, type))
  }

  const developmentDelta =
    compositionDevelopmentValue(state, afterCounts, maxOwned) -
    compositionDevelopmentValue(state, beforeCounts, maxOwned)
  return (
    intrinsicMusterValue(state, creatureType) +
    MUSTER_DEVELOPMENT_WEIGHT * developmentDelta
  )
}

function pickBestRecruitName(
  state: GameState,
  legion: Legion,
  hexLabel: string,
  options: string[],
): string | null {
  if (options.length === 0) return null
  let best = options[0]!
  let bestRank = -Infinity
  for (const name of options) {
    const rank = scoreRecruitOption(state, name, hexLabel, legion)
    if (rank > bestRank) {
      bestRank = rank
      best = name
    }
  }
  return best
}

/** Best eligible recruit for a legion on its current hex (Muster phase). */
export function bestRecruit(state: GameState, legion: Legion): string | null {
  return pickBestRecruitName(state, legion, legion.hexLabel, listRecruits(state, legion))
}

/** Best eligible recruit at a destination (ability-aware + development). */
export function bestRecruitAt(
  state: GameState,
  legion: Legion,
  hexLabel: string,
): string | null {
  return pickBestRecruitName(
    state,
    legion,
    hexLabel,
    listRecruitOptionsAt(state, legion, hexLabel),
  )
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
