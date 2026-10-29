import { describe, expect, it, vi } from 'vitest'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { dispatch } from '../../engine/GameEngine'
import { startBattle, legalBattleMovesFor, battleLand, legalStrikesFor, resolveStrikeFor } from '../../engine/battle'
import { isUnitAlive } from '../../engine/battleStrike'
import { hazardDamageToCreature } from '../../engine/battleland'
import type { EntrySide, GameState } from '../../engine/types'
import { planBattleDeployment, pickBestBattleMove } from '../evaluateBattle'
import { HARD_BATTLE_DEPLOYMENT } from '../battleDeployment'
import { AI_PROFILES } from '../profiles'

const types = ['Titan', 'Gorgon', 'Gorgon', 'Cyclops', 'Cyclops', 'Behemoth', 'Ogre']
function entry(terrain = 'Woods', side: EntrySide = 'Left', creatures = types) {
  const state = twoPlayerGame(71), a = state.legions[0], d = state.legions[1]
  a.hexLabel = d.hexLabel = Object.values(state.variant.board.hexByLabel).find(hex => hex.terrain === terrain)!.label
  a.enteredFrom = side
  a.creatures = creatures.map(type => ({ type, hits: 0 })); d.creatures = creatures.map(type => ({ type, hits: 0 }))
  state.phase = 'Fight'; state.players[1].kind = 'ai'; state.players[1].aiDifficultyId = 'hard'
  state.battle = startBattle(state, a, d, () => 0)
  return state
}
function freeze(value: unknown, seen = new Set<unknown>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value); Object.values(value).forEach(child => freeze(child, seen)); Object.freeze(value)
}
function completeEntry(state: GameState, hard: boolean) {
  let next = state
  const actor = next.battle!.activePlayerId
  for (let i = 0; i < 7; i++) {
    if (!next.battle!.units.some(unit => unit.playerId === actor && !unit.hex && isUnitAlive(next, unit))) break
    const command = pickBestBattleMove(next, next.battle!, AI_PROFILES.balanced, () => 0, { deployment: hard ? {} : false })
    expect(command.type).toBe('battleMove')
    next = dispatch(next, command, () => 0)
  }
  expect(next.battle!.units.filter(unit => unit.playerId === actor && !unit.hex && isUnitAlive(next, unit))).toEqual([])
  return next
}
describe('Hard complete-side initial deployment', () => {
  it('finishes bounded real seven-versus-seven Woods entry with the same world RNG count and frozen inputs', () => {
    const state = entry(), before = JSON.stringify(state)
    freeze(state)
    const rng = vi.fn(() => 0), now = vi.spyOn(Date, 'now'), random = vi.spyOn(Math, 'random')
    let result
    const start = performance.now()
    try {
      result = planBattleDeployment(state, state.battle!, AI_PROFILES.balanced, rng)
      expect(now).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled()
    } finally { now.mockRestore(); random.mockRestore() }
    console.log('HARD-DEPLOYMENT-WOODS', JSON.stringify({ result, elapsedMs: performance.now() - start }))
    expect(rng).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(state)).toBe(before)
    expect(planBattleDeployment(state, state.battle!, AI_PROFILES.balanced, () => 0)).toEqual(result)
    expect(result.work.usedPlan).toBe(true)
    expect(result.work.reachedDepth).toBe(7)
    expect(result.work.completeFormations).toBeGreaterThan(1)
    expect(result.work.nodes).toBeLessThanOrEqual(HARD_BATTLE_DEPLOYMENT.maxNodes)
    let played = state
    for (const command of result.plan) {
      const unit = played.battle!.units.find(unit => unit.id === command.unitId)!
      expect(legalBattleMovesFor(played, played.battle!, unit)).toContain(command.toHex)
      played = dispatch(played, command, () => 0)
    }
    expect(played.battle!.units.filter(unit => unit.playerId === played.battle!.activePlayerId).every(unit => unit.hex)).toBe(true)
  })
  it('falls back exactly when node or response work is incomplete and validates budgets', () => {
    const state = entry(), rng = vi.fn(() => 0)
    const control = pickBestBattleMove(state, state.battle!, AI_PROFILES.balanced, () => 0, { deployment: false })
    for (const deployment of [{ maxNodes: 1 }, { maxResponseNodes: 1 }]) {
      const result = planBattleDeployment(state, state.battle!, AI_PROFILES.balanced, rng, { deployment })
      expect(result.command).toEqual(control); expect(result.work.exhausted).toBe(true); expect(result.work.usedPlan).toBe(false)
    }
    expect(rng).toHaveBeenCalledTimes(2)
    expect(() => planBattleDeployment(state, state.battle!, AI_PROFILES.balanced, () => 0, { deployment: { maxNodes: 0 } })).toThrow('Invalid battle deployment')
  })
  it('does not use the initial formation search for later reinforcement entry', () => {
    const state = entry()
    state.battle!.turn = 4; state.battle!.firstManeuverDone.defender = true
    const control = pickBestBattleMove(state, state.battle!, AI_PROFILES.balanced, () => 0, { deployment: false })
    const result = planBattleDeployment(state, state.battle!, AI_PROFILES.balanced, () => 0)
    expect(result.command).toEqual(control)
    expect(result.work).toMatchObject({ nodes: 0, usedPlan: false, reason: 'unsupported' })
  })
  it.each(['easy', 'normal'] as const)('preserves %s entry commands, RNG consumption and mandatory Woods Titan entry', level => {
    let state = entry()
    state.players[1].aiDifficultyId = level
    for (let step = 0; step < 7; step++) {
      const live = vi.fn(() => 0.4), disabled = vi.fn(() => 0.4)
      const command = pickBestBattleMove(state, state.battle!, AI_PROFILES.balanced, live)
      expect(command).toEqual(pickBestBattleMove(state, state.battle!, AI_PROFILES.balanced, disabled, { deployment: false }))
      expect(live.mock.calls).toEqual(disabled.mock.calls)
      state = dispatch(state, command, () => 0)
    }
    expect(state.battle!.units.filter(unit => unit.playerId === state.players[1].id).every(unit => unit.hex)).toBe(true)
  })
  it('recomputes complete legal continuations after actual partial entries without stranding any creature', () => {
    let state = entry()
    for (let step = 0; step < 7; step++) {
      const result = planBattleDeployment(state, state.battle!, AI_PROFILES.balanced, () => 0)
      expect(result.work.usedPlan).toBe(true)
      expect(result.plan).toHaveLength(7 - step)
      state = dispatch(state, result.command, () => 0)
    }
    state = dispatch(state, { type: 'battleDonePhase' }, () => 0)
    expect(state.battle!.firstManeuverDone).toEqual({ attacker: false, defender: true })
    expect(state.log.filter(line => /failed to enter/.test(line))).toEqual([])
    expect(state.winnerId).toBeFalsy()
  })
  it('keeps a one-HP Titan off deterministic lethal Tundra terrain during entry', () => {
    const state = entry('Tundra'), titan = state.battle!.units.find(unit => unit.playerId === state.battle!.activePlayerId && unit.creatureType === 'Titan')!
    titan.hits = state.players[1].titanPower - 1
    const played = completeEntry(state, true), landed = played.battle!.units.find(unit => unit.id === titan.id)!
    const land = battleLand(played, played.battle!)
    expect(hazardDamageToCreature(land.hexByLabel[landed.hex!].terrain, played.variant.creatures.Titan)).toBe(0)
    const advanced = dispatch(played, { type: 'battleDonePhase' }, () => 0)
    expect(advanced.players[1].dead).toBe(false)
    expect(advanced.battle?.units.find(unit => unit.id === titan.id)?.hits).toBe(titan.hits)
  })
  it('deploys an actually supported Titan formation instead of leaving the Titan on the rim', () => {
    const state = entry(), normal = completeEntry(state, false), hard = completeEntry(state, true)
    const guards = (position: GameState) => {
      const battle = position.battle!, land = battleLand(position, battle)
      const titan = battle.units.find(unit => unit.playerId === battle.activePlayerId && unit.creatureType === 'Titan')!
      return battle.units.filter(unit => unit.playerId === titan.playerId && unit !== titan && unit.hex && land.hexByLabel[titan.hex!].neighbors.includes(unit.hex)).length
    }
    expect(guards(normal)).toBe(2)
    expect(guards(hard)).toBe(5)
  })
  it('coordinates a useful extra frontline attack against an enemy that entered through the actual engine', () => {
    let state = entry('Woods', 'Left', ['Titan', 'Ranger', 'Ranger', 'Ogre', 'Ogre', 'Gargoyle', 'Centaur'])
    state = dispatch(completeEntry(state, false), { type: 'battleDonePhase' }, () => 0)
    state.players[0].aiDifficultyId = 'hard'
    const start = performance.now(), result = planBattleDeployment(state, state.battle!, AI_PROFILES.balanced, () => 0)
    console.log('HARD-DEPLOYMENT-ATTACKER', JSON.stringify({ elapsedMs: performance.now() - start, work: result.work, score: result.score, baselineScore: result.baselineScore }))
    const liveStart = performance.now(), live = pickBestBattleMove(state, state.battle!, AI_PROFILES.balanced, () => 0)
    console.log('HARD-DEPLOYMENT-LIVE-PICKER', JSON.stringify({ elapsedMs: performance.now() - liveStart, command: live }))
    expect(live).toEqual(result.command)
    expect(result.work.usedPlan).toBe(true)
    expect(result.work.reachedDepth).toBe(7)
    expect(result.score!).toBeGreaterThan(result.baselineScore! + 0.5)
    const normal = dispatch(completeEntry(state, false), { type: 'battleDonePhase' }, () => 0)
    const hard = dispatch(completeEntry(state, true), { type: 'battleDonePhase' }, () => 0)
    const ownGargoyle = (position: GameState) => position.battle!.units.find(unit => unit.playerId === state.players[0].id && unit.creatureType === 'Gargoyle')!
    const normalGargoyle = ownGargoyle(normal), hardGargoyle = ownGargoyle(hard)
    expect(normal.battle!.phase).toBe('Strike'); expect(hard.battle!.phase).toBe('Strike')
    expect(legalStrikesFor(normal, normal.battle!, normalGargoyle)).toEqual([])
    const target = legalStrikesFor(hard, hard.battle!, hardGargoyle)[0]
    expect(target).toBeTruthy()
    const centaur = hard.battle!.units.find(unit => unit.playerId === state.players[0].id && unit.creatureType === 'Centaur')!
    expect(legalStrikesFor(hard, hard.battle!, centaur).some(id => id !== target)).toBe(true)
    // Actual extra combat action, not merely a formation-heuristic assertion.
    const victim = hard.battle!.units.find(unit => unit.id === target)!, before = victim.hits
    resolveStrikeFor(hard, hard.battle!, hardGargoyle.id, target, () => 0, [6, 6, 6, 6])
    expect(victim.hits - before).toBe(4)
    expect(hard.log.some(line => /failed to enter/.test(line))).toBe(false)
  })
})
