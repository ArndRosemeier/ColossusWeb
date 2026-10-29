import { advanceBattlePhase, battleLand, doCarry, legalBattleMovesFor, legalStrikesFor, resolveStrikeFor } from '../engine/battle'
import { getStrikeDice, getStrikeNumber, getUnitPower, isUnitAlive, legalCarryTargetIds, legalStrikes, listStrikeRaiseOptions, hexDistance } from '../engine/battleStrike'
import { hazardDamageToCreature, meleeNeighbors, type BuiltBattleland } from '../engine/battleland'
import type { BattleState, BattleUnit, GameCommand, GameState } from '../engine/types'
import type { AiProfile } from './profiles'
import { strikeExpectations } from './battleProbability'

export interface BattleRolloutOptions {
  enabled: boolean
  candidateLimit: number
  trialsPerCandidate: number
  maxTransitionNodes: number
  maxPolicyEvaluations: number
  horizonCycles: number
  policyMoveCandidates: number
  seed?: number
}
export const HARD_BATTLE_ROLLOUT: Readonly<BattleRolloutOptions> = Object.freeze({ enabled: true,
  candidateLimit: 3, trialsPerCandidate: 8, maxTransitionNodes: 3072, maxPolicyEvaluations: 20000, horizonCycles: 2, policyMoveCandidates: 3 })
/** Strike roots skip one maneuver, leaving room for more paired evidence. */
export const HARD_BATTLE_STRIKE_ROLLOUT: Readonly<BattleRolloutOptions> = Object.freeze({ ...HARD_BATTLE_ROLLOUT, trialsPerCandidate: 16 })
export function strikeRolloutOptions(battle: BattleState, overrides: Partial<BattleRolloutOptions>) {
  return { ...HARD_BATTLE_STRIKE_ROLLOUT, trialsPerCandidate: battle.units.length <= 6 ? 32 : 16, ...overrides }
}
export interface BattleRolloutWork {
  completedRollouts: number
  terminalRollouts: number
  creditedRounds: number
  transitionNodes: number
  policyEvaluations: number
  policyCacheHits: number
  horizonCycles: number
  minCompletedCycles: number
  exhausted: boolean
  boundaryStops: number
  usedRollout: boolean
  changedDecision: boolean
  reason: 'complete' | 'budget' | 'boundary' | 'disabled' | 'insufficient'
  decisions: { command: GameCommand; completed: number; meanUtility: number; pairedAdvantage: number; pairedStdError: number | null; accepted: boolean }[]
}

export function rolloutOptions(options: Partial<BattleRolloutOptions> = {}): BattleRolloutOptions {
  const result = { ...HARD_BATTLE_ROLLOUT, ...options }
  for (const [name, maximum] of [['candidateLimit', 8], ['trialsPerCandidate', 32], ['maxTransitionNodes', 16384],
    ['maxPolicyEvaluations', 100000], ['horizonCycles', 4], ['policyMoveCandidates', 8]] as const) {
    if (!Number.isInteger(result[name]) || result[name] < 1 || result[name] > maximum) throw new Error(`Invalid battle rollout ${name}`)
  }
  if (result.horizonCycles < 2 || typeof result.enabled !== 'boolean' || (result.seed !== undefined && !Number.isSafeInteger(result.seed))) {
    throw new Error('Invalid battle rollout options')
  }
  return result
}

function localRng(seed: number) {
  let value = seed >>> 0
  return () => { value = (Math.imul(1664525, value) + 1013904223) >>> 0; return value / 4294967296 }
}
function positionSeed(battle: BattleState) {
  let hash = 2166136261
  const text = `${battle.turn}:${battle.activeHalf}:${battle.phase}:` + battle.units.map(unit => `${unit.id}/${unit.hex}/${unit.hits}/${unit.struck}/${unit.moved}`).join('|')
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return hash >>> 0
}

/** Clone only mutable game data; the large variant remains shared and read-only. */
function trialState(state: GameState, battle: BattleState): GameState {
  const { variant, ...mutable } = state
  return { ...structuredClone({ ...mutable, log: [], battle }), variant }
}
function cycle(battle: BattleState) { return (battle.turn - 1) * 2 + Number(battle.activeHalf === 'attacker') }
function phasePosition(battle: BattleState) { return cycle(battle) * 3 + (battle.phase === 'Strike' ? 1 : battle.phase === 'Strikeback' ? 2 : 0) }
function pv(state: GameState, unit: BattleUnit, profile: AiProfile) {
  return getUnitPower(state, unit) * state.variant.creatures[unit.creatureType].skill +
    (unit.creatureType === 'Titan' ? profile.battleTitanValue * 2.5 : 0)
}

function strikeScore(state: GameState, battle: BattleState, attacker: BattleUnit, target: BattleUnit, profile: AiProfile, raised?: number) {
  const land = battleLand(state, battle), melee = meleeNeighbors(land, attacker.hex!).includes(target.hex!)
  const natural = getStrikeNumber(state, attacker, target, land, melee), need = raised === undefined ? natural : Math.max(natural, raised)
  const carry = melee ? legalCarryTargetIds(state, battle, land, attacker, target, need > natural ? need : undefined) : []
  const others = carry.map(id => battle.units.find(unit => unit.id === id)!)
  const stats = strikeExpectations(getStrikeDice(state, land, attacker, target, melee), need,
    Math.max(0, getUnitPower(state, target) - target.hits), others.reduce((sum, unit) => sum + Math.max(0, getUnitPower(state, unit) - unit.hits), 0))
  const value = pv(state, target, profile)
  return value * (stats.expectedDamage + 12 * stats.killProbability) +
    stats.expectedOverflow * Math.max(0, ...others.map(unit => pv(state, unit, profile))) * 0.45
}

type Budget = { transitionNodes: number; policyEvaluations: number; policyCacheHits: number }
type PolicyCache = Map<string, { command: GameCommand; held: string[] }>
function cachedDistance(land: BuiltBattleland, from: string, to: string, distances: Map<string, number>) {
  const key = from < to ? `${from}/${to}` : `${to}/${from}`
  let distance = distances.get(key)
  if (distance === undefined) { distance = hexDistance(land, from, to); distances.set(key, distance) }
  return distance
}
function policy(state: GameState, battle: BattleState, profile: AiProfile, held: Set<string>, budget: Budget, options: BattleRolloutOptions, distances: Map<string, number>): GameCommand | null {
  const land = battleLand(state, battle)
  if (battle.pendingCarry) {
    const carry = battle.pendingCarry
    const targets = carry.targetIds.map(id => battle.units.find(unit => unit.id === id)!).filter(unit => unit && isUnitAlive(state, unit))
    targets.sort((a, b) => {
      const value = (unit: BattleUnit) => pv(state, unit, profile) * (carry.hitsLeft >= getUnitPower(state, unit) - unit.hits ? 20 : carry.hitsLeft)
      return value(b) - value(a)
    })
    return targets.length ? { type: 'battleCarry', targetId: targets[0].id } : null
  }
  if (battle.phase === 'Strike' || battle.phase === 'Strikeback') {
    let best: GameCommand = { type: 'battleDonePhase' }, bestScore = -Infinity, bestForced = false
    for (const attacker of battle.units) {
      if (attacker.playerId !== battle.activePlayerId || attacker.struck || !attacker.hex) continue
      const targets = legalStrikesFor(state, battle, attacker), forced = targets.length === 1
      for (const id of targets) {
        const target = battle.units.find(unit => unit.id === id)!
        const optionsForStrike = [undefined, ...listStrikeRaiseOptions(state, battle, land, attacker, target).options.map(option => option.need)]
        for (const raisedStrikeNumber of optionsForStrike) {
          if (budget.policyEvaluations >= options.maxPolicyEvaluations) return null
          budget.policyEvaluations++
          const score = strikeScore(state, battle, attacker, target, profile, raisedStrikeNumber)
          if ((forced && !bestForced) || (forced === bestForced && score > bestScore)) {
            bestForced = forced; bestScore = score
            best = { type: 'battleStrike', attackerId: attacker.id, defenderId: id, raisedStrikeNumber }
          }
        }
      }
    }
    return best
  }
  // A cheap nonrecursive rollout policy: coordinate one mobile fighter at a time.
  const movers = battle.units.filter(unit => unit.playerId === battle.activePlayerId && !unit.moved && isUnitAlive(state, unit) &&
    !held.has(`${cycle(battle)}:${unit.id}`)).sort((a, b) => Number(a.creatureType === 'Titan') - Number(b.creatureType === 'Titan') || pv(state, b, profile) - pv(state, a, profile))
  for (const unit of movers) {
    const origin = unit.hex
    const enemies = battle.units.filter(enemy => enemy.playerId !== unit.playerId && enemy.hex && isUnitAlive(state, enemy))
    const short: { hex: string; score: number }[] = []
    for (const hex of legalBattleMovesFor(state, battle, unit)) {
      if (budget.policyEvaluations >= options.maxPolicyEvaluations) return null
      budget.policyEvaluations++
      const adjacent = meleeNeighbors(land, hex)
      const nearest = Math.min(99, ...enemies.map(enemy => cachedDistance(land, hex, enemy.hex!, distances)))
      const contact = enemies.filter(enemy => adjacent.includes(enemy.hex!)).length
      const damage = hazardDamageToCreature(land.hexByLabel[hex].terrain, state.variant.creatures[unit.creatureType])
      short.push({ hex, score: contact * (unit.creatureType === 'Titan' ? -10 : 8) - nearest * 2 - damage * 20 })
    }
    short.sort((a, b) => b.score - a.score)
    const choices = [...(origin ? [origin] : []), ...short.slice(0, options.policyMoveCandidates).map(choice => choice.hex)]
    let bestHex = origin, bestScore = -Infinity
    for (const hex of choices) {
      if (budget.policyEvaluations >= options.maxPolicyEvaluations) return null
      budget.policyEvaluations++
      unit.hex = hex
      let offense = 0, threat = 0, distance = 99
      for (const id of legalStrikes(state, battle, land, unit, true)) offense = Math.max(offense, strikeScore(state, battle, unit, battle.units.find(target => target.id === id)!, profile))
      for (const enemy of battle.units) {
        if (enemy.playerId === unit.playerId || !enemy.hex || !isUnitAlive(state, enemy)) continue
        const separation = cachedDistance(land, hex, enemy.hex, distances)
        distance = Math.min(distance, separation)
        if (legalStrikes(state, battle, land, enemy, true).includes(unit.id)) threat += strikeScore(state, battle, enemy, unit, profile) * 0.6
      }
      const damage = hazardDamageToCreature(land.hexByLabel[hex].terrain, state.variant.creatures[unit.creatureType])
      const doomed = unit.creatureType === 'Titan' && damage >= getUnitPower(state, unit) - unit.hits
      const score = doomed ? -Infinity : offense - threat - (distance === 99 ? 0 : distance * (battle.activeHalf === 'attacker' ? 3 : 0.6)) - damage * pv(state, unit, profile) * 2
      if (score > bestScore) { bestScore = score; bestHex = hex }
    }
    unit.hex = origin
    if (bestHex && bestHex !== origin) return { type: 'battleMove', unitId: unit.id, toHex: bestHex }
    held.add(`${cycle(battle)}:${unit.id}`)
  }
  return { type: 'battleDonePhase' }
}

/** Lower-level engine only: never dispatch, allocate real dice IDs, or resolve acquisitions. */
function apply(state: GameState, battle: BattleState, command: GameCommand, rng: () => number, policyVerified = false): number {
  if (command.type === 'battleMove') {
    const unit = battle.units.find(candidate => candidate.id === command.unitId)
    if (!unit || battle.phase !== 'Move' || unit.playerId !== battle.activePlayerId || (!policyVerified && !legalBattleMovesFor(state, battle, unit).includes(command.toHex))) throw new Error('Illegal rollout move')
    unit.hex = command.toHex; unit.moved = true; battle.moveStack.push(unit.id)
  } else if (command.type === 'battleStrike') {
    const unit = battle.units.find(candidate => candidate.id === command.attackerId)
    if (!unit || unit.playerId !== battle.activePlayerId || (!policyVerified && !legalStrikesFor(state, battle, unit).includes(command.defenderId))) throw new Error('Illegal rollout strike')
    if (command.raisedStrikeNumber !== undefined && !policyVerified) {
      const target = battle.units.find(candidate => candidate.id === command.defenderId)!
      if (!listStrikeRaiseOptions(state, battle, battleLand(state, battle), unit, target).options.some(option => option.need === command.raisedStrikeNumber)) throw new Error('Illegal rollout raised strike')
    }
    resolveStrikeFor(state, battle, command.attackerId, command.defenderId, rng, undefined, command.raisedStrikeNumber)
  } else if (command.type === 'battleCarry') doCarry(state, battle, command.targetId)
  else if (command.type === 'battleDonePhase') {
    const before = phasePosition(battle)
    advanceBattlePhase(state, battle)
    return Math.max(1, phasePosition(battle) - before + Number(battle.done))
  } else throw new Error('Unsupported rollout command')
  return 1
}

export function battleRolloutUtility(state: GameState, battle: BattleState, playerId: string, profile: AiProfile) {
  if (battle.done) {
    // Time loss eliminates the entire attacker legion even though its Titan
    // need not have entered fallen or set endedByTitanKill yet.
    const deadTitans = [...battle.units, ...battle.fallen].filter(unit => unit.creatureType === 'Titan' &&
      (!isUnitAlive(state, unit) || (battle.timeLoss && unit.legionId === battle.attackerLegionId)))
    const ownTitanLost = deadTitans.some(unit => unit.playerId === playerId)
    const enemyTitanLost = deadTitans.some(unit => unit.playerId !== playerId)
    const contenders = state.players.filter(player => !player.dead || deadTitans.some(unit => unit.playerId === player.id)).length
    if (ownTitanLost && enemyTitanLost) return contenders <= 2 ? 0 : -1000000
    if (ownTitanLost) return -1000000
    if (enemyTitanLost) return 1000000
    if (battle.winnerPlayerId === playerId) return 100000
    if (battle.winnerPlayerId !== null) return -100000
    return 0
  }
  let value = 0
  for (const unit of battle.units) {
    if (!isUnitAlive(state, unit)) continue
    const health = Math.max(0, getUnitPower(state, unit) - unit.hits) / getUnitPower(state, unit)
    value += (unit.playerId === playerId ? 1 : -1) * pv(state, unit, profile) * (0.35 + 0.65 * health)
  }
  const attackerId = state.legions.find(legion => legion.id === battle.attackerLegionId)!.playerId
  return value + (playerId === attackerId ? -1 : 1) * battle.turn * 3
}

export function runBattleTrial(state: GameState, battle: BattleState, first: GameCommand, profile: AiProfile,
  seed: number, options: BattleRolloutOptions, budget = { transitionNodes: 0, policyEvaluations: 0, policyCacheHits: 0 }, distances = new Map<string, number>(), policyCache: PolicyCache = new Map()) {
  options = rolloutOptions(options)
  const sim = trialState(state, battle), current = sim.battle!, startCycle = cycle(current), playerId = battle.activePlayerId
  const rng = localRng(seed), held = new Set<string>()
  let command: GameCommand | null = first
  let verified = false
  while (true) {
    if (current.done || (current.phase === 'Move' && cycle(current) >= startCycle + options.horizonCycles)) {
      return { complete: true, boundary: false, utility: battleRolloutUtility(sim, current, playerId, profile), cycles: cycle(current) - startCycle, battle: current }
    }
    if (current.phase === 'Recruit' || current.phase === 'Summon') return { complete: false, boundary: true, utility: 0, cycles: cycle(current) - startCycle, battle: current }
    if (budget.transitionNodes + 3 > options.maxTransitionNodes || budget.policyEvaluations >= options.maxPolicyEvaluations) {
      return { complete: false, boundary: false, utility: 0, cycles: cycle(current) - startCycle, battle: current }
    }
    if (!command) {
      const key = JSON.stringify([current.turn, current.activeHalf, current.phase, current.activePlayerId, current.pendingCarry,
        current.units.map(unit => [unit.id, unit.hex, unit.hits, unit.moved, unit.struck]), [...held]])
      const cached = policyCache.get(key)
      if (cached) {
        budget.policyEvaluations++; budget.policyCacheHits++
        command = cached.command; cached.held.forEach(id => held.add(id))
      } else {
        command = policy(sim, current, profile, held, budget, options, distances)
        if (command) policyCache.set(key, { command, held: [...held] })
      }
      verified = true // Engine-legal policy choice, applied immediately to this exact position.
    }
    if (!command) return { complete: false, boundary: false, utility: 0, cycles: cycle(current) - startCycle, battle: current }
    budget.transitionNodes += apply(sim, current, command, rng, verified)
    command = null
    sim.log.length = 0
  }
}

/** Common random numbers per trial, equal completed rounds only; no caller RNG. */
export function sampleBattleChoices(state: GameState, battle: BattleState, candidates: GameCommand[], fallback: GameCommand,
  profile: AiProfile, overrides: Partial<BattleRolloutOptions> = {}) {
  const options = rolloutOptions(overrides)
  const work: BattleRolloutWork = { completedRollouts: 0, terminalRollouts: 0, creditedRounds: 0, transitionNodes: 0, policyEvaluations: 0, policyCacheHits: 0,
    horizonCycles: options.horizonCycles, minCompletedCycles: options.horizonCycles, exhausted: false, boundaryStops: 0,
    usedRollout: false, changedDecision: false, reason: 'insufficient', decisions: [] }
  if (!options.enabled) { work.reason = 'disabled'; return { command: fallback, work } }
  const distinct = new Map<string, GameCommand>()
  distinct.set(JSON.stringify(fallback), fallback)
  for (const command of candidates) if (distinct.size < options.candidateLimit) distinct.set(JSON.stringify(command), command)
  const choices = [...distinct.values()], sums = choices.map(() => 0), observations: number[][] = choices.map(() => [])
  const budget = { transitionNodes: 0, policyEvaluations: 0, policyCacheHits: 0 }
  const distances = new Map<string, number>()
  const policyCache: PolicyCache = new Map()
  if (choices.length < 2) return { command: fallback, work }
  const seed = options.seed ?? positionSeed(battle)
  let boundary = false
  for (let trial = 0; trial < options.trialsPerCandidate; trial++) {
    const values: number[] = []
    for (let index = 0; index < choices.length; index++) {
      const result = runBattleTrial(state, battle, choices[index], profile, (seed + Math.imul(trial + 1, 0x9e3779b9)) >>> 0, options, budget, distances, policyCache)
      if (!result.complete) {
        if (result.boundary) { work.boundaryStops++; boundary = true }
        else work.exhausted = true
        break
      }
      work.completedRollouts++
      if (result.battle.done) work.terminalRollouts++
      work.minCompletedCycles = Math.min(work.minCompletedCycles, result.cycles)
      values.push(result.utility)
    }
    if (values.length !== choices.length) break
    values.forEach((value, index) => { sums[index] += value; observations[index].push(value) })
    work.creditedRounds++
  }
  work.transitionNodes = budget.transitionNodes; work.policyEvaluations = budget.policyEvaluations; work.policyCacheHits = budget.policyCacheHits
  work.decisions = choices.map((command, index) => {
    const n = work.creditedRounds, differences = observations[index].map((value, trial) => value - observations[0][trial])
    const pairedAdvantage = n ? differences.reduce((sum, value) => sum + value, 0) / n : 0
    const pairedStdError = n > 1 ? Math.sqrt(differences.reduce((sum, value) => sum + (value - pairedAdvantage) ** 2, 0) / (n - 1) / n) : Infinity
    const terminalWins = differences.filter(value => value >= 50000).length, terminalLosses = differences.filter(value => value <= -50000).length
    const accepted = index === 0 || (n >= 4 && pairedAdvantage - 1.5 * pairedStdError > 0.5 &&
      (!(terminalWins || terminalLosses) || (terminalWins >= 2 && terminalWins > terminalLosses)))
    return { command, completed: n, meanUtility: n ? sums[index] / n : 0, pairedAdvantage, pairedStdError: n > 1 ? pairedStdError : null, accepted }
  })
  // Censored support boundaries or incomplete sampling never beat a proven fallback.
  if (boundary || work.creditedRounds < options.trialsPerCandidate) {
    work.reason = boundary ? 'boundary' : 'budget'
    return { command: fallback, work }
  }
  const best = work.decisions.filter(choice => choice.accepted).reduce((a, b) => b.meanUtility > a.meanUtility ? b : a)
  work.usedRollout = true; work.reason = 'complete'
  work.changedDecision = JSON.stringify(best.command) !== JSON.stringify(fallback)
  return { command: best.command, work }
}
