import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { advanceBattlePhase, applyBattleSupport, legalBattleMovesFor, listBattleReinforceOptions, removeDeadCreatures, resolveStrikeFor, startBattle, type BattleSupportCommand } from '../../engine/battle'
import { dispatch } from '../../engine/GameEngine'
import type { BattleState, GameState } from '../../engine/types'
import { pickBattleSupport } from '../battleSupport'
import { pickAiCommand } from '../simpleAi'
import { AI_PROFILES } from '../profiles'
import { battleRolloutUtility, HARD_BATTLE_ROLLOUT, runBattleTrial, sampleBattleChoices } from '../battleRollout'

function fixture(terrain = 'Brush', ownTypes = ['Ogre'], enemyTypes = ['Gargoyle', 'Gargoyle']) {
  const state = twoPlayerGame(444), own = state.legions[0], enemy = state.legions[1]
  const hex = Object.values(state.variant.board.hexByLabel).find(cell => cell.terrain === terrain)!.label
  own.creatures = ownTypes.map(type => ({ type, hits: 0 })); enemy.creatures = enemyTypes.map(type => ({ type, hits: 0 }))
  own.hexLabel = enemy.hexLabel = hex; own.enteredFrom = 'Bottom'; state.phase = 'Fight'
  const battle = startBattle(state, own, enemy, () => .5)
  state.battle = battle; battle.turn = 3; battle.phase = 'Move'; battle.activeHalf = 'attacker'; battle.activePlayerId = own.playerId
  battle.firstManeuverDone = { attacker: true, defender: true }; battle.attackerCommitted = true
  const ours = battle.units.filter(unit => unit.playerId === own.playerId), theirs = battle.units.filter(unit => unit.playerId === enemy.playerId)
  ours.forEach((unit, index) => { unit.hex = ['A1', 'A2', 'B1'][index] })
  theirs.forEach((unit, index) => { unit.hex = ['F4', 'F3', 'E5'][index] })
  return { state, battle, ours, theirs, own, enemy }
}
function copy(state: GameState) { const { variant, ...mutable } = state; return { ...structuredClone(mutable), variant } as GameState }
function donor(state: GameState, types = ['Angel', 'Archangel', 'Ogre']) {
  const source = { ...structuredClone(state.legions[0]), id: 'donor', markerId: 'Rd02', hexLabel: '100',
    creatures: types.map(type => ({ type, hits: 0 })), knownPublic: [...types] }
  state.legions.push(source); return source
}
function supportPhase(battle: BattleState, phase: 'Recruit' | 'Summon') {
  battle.phase = phase
  battle.activeHalf = phase === 'Recruit' ? 'defender' : 'attacker'
  battle.activePlayerId = battle.units.find(unit => unit.legionId === (phase === 'Recruit' ? battle.defenderLegionId : battle.attackerLegionId))!.playerId
  if (phase === 'Recruit') battle.turn = 4
  else { battle.summonState = 'firstBlood'; battle.pendingSummon = true }
}
function frozen(value: unknown, seen = new Set<unknown>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value); Object.values(value).forEach(child => frozen(child, seen)); Object.freeze(value)
}

describe('shared real and sampled battle support', () => {
  it.each<BattleSupportCommand>([{ type: 'battleReinforce', creatureType: 'Cyclops' }, { type: 'battleSkipReinforce' },
    { type: 'battleSummon', fromLegionId: 'donor' }, { type: 'battleSkipSummon' }])('dispatch and the single authority agree exactly for $type', command => {
    const { state, battle } = fixture(); donor(state)
    supportPhase(battle, command.type === 'battleReinforce' || command.type === 'battleSkipReinforce' ? 'Recruit' : 'Summon')
    const expected = copy(state); applyBattleSupport(expected, expected.battle!, command)
    const rng = vi.fn(() => { throw new Error('Support must not consume dice') })
    expect(dispatch(state, command, rng)).toEqual(expected); expect(rng).not.toHaveBeenCalled()
  })
  it('reserves actual stock, reveals the creature and leaves a deterministic off-board reinforcement for its real Move', () => {
    const { state, battle, enemy } = fixture(); supportPhase(battle, 'Recruit')
    enemy.knownPublic = ['Gargoyle']; const stock = state.caretaker.Cyclops
    expect(pickBattleSupport(state, battle)).toEqual({ type: 'battleReinforce', creatureType: 'Cyclops' })
    applyBattleSupport(state, battle, pickBattleSupport(state, battle))
    expect(state.caretaker.Cyclops).toBe(stock - 1); expect(enemy.creatures.map(creature => creature.type)).toEqual(['Gargoyle', 'Gargoyle', 'Cyclops'])
    expect(enemy.knownPublic).toContain('Cyclops')
    expect(battle.units.at(-1)).toMatchObject({ id: 'bu-r-3', creatureType: 'Cyclops', legionId: enemy.id, playerId: enemy.playerId, hex: null, moved: false, moveOriginHex: null })
    expect(battle).toMatchObject({ phase: 'Move', defenderReinforced: true })
    expect(legalBattleMovesFor(state, battle, battle.units.at(-1)!).length).toBeGreaterThan(0)
  })
  it('summons the first eligible creature rather than the stronger later Archangel, preserves caretaker and updates both public rosters', () => {
    const { state, battle, own } = fixture(); const source = donor(state); supportPhase(battle, 'Summon')
    const stock = { ...state.caretaker }
    expect(pickBattleSupport(state, battle)).toEqual({ type: 'battleSummon', fromLegionId: source.id })
    applyBattleSupport(state, battle, pickBattleSupport(state, battle))
    expect(source.creatures.map(creature => creature.type)).toEqual(['Archangel', 'Ogre'])
    expect(source.knownPublic).toEqual(['Archangel', 'Ogre']); expect(own.knownPublic).toContain('Angel')
    expect(state.caretaker).toEqual(stock); expect(battle.units.at(-1)).toMatchObject({ id: 'bu-s-3', creatureType: 'Angel', hex: null, moveOriginHex: null, moved: false })
    expect(battle).toMatchObject({ attackerSummoned: true, pendingSummon: false, summonState: 'tooLate', phase: 'Move' })
  })
  it('declining reinforcement preserves the post-battle right; declining summon closes its one-time window', () => {
    const { state, battle } = fixture(); supportPhase(battle, 'Recruit')
    applyBattleSupport(state, battle, { type: 'battleSkipReinforce' })
    expect(battle).toMatchObject({ phase: 'Move', defenderReinforced: false })
    supportPhase(battle, 'Summon'); applyBattleSupport(state, battle, { type: 'battleSkipSummon' })
    expect(battle).toMatchObject({ phase: 'Move', attackerSummoned: false, pendingSummon: false, summonState: 'tooLate' })
  })
  it('keeps live handler validation order and its existing tooLate handling instead of silently adding a new rule', () => {
    const { state, battle } = fixture(); donor(state); supportPhase(battle, 'Recruit')
    state.caretaker.Hydra = 0
    expect(() => applyBattleSupport(state, battle, { type: 'battleReinforce', creatureType: 'Hydra' })).toThrow('Caretaker empty')
    expect(dispatch(state, { type: 'battleReinforce', creatureType: 'Hydra' }).message).toBe('Caretaker empty')
    supportPhase(battle, 'Summon'); battle.summonState = 'tooLate'
    expect(pickBattleSupport(state, battle)).toEqual({ type: 'battleSkipSummon' })
    // Dispatch historically accepts an explicitly submitted donor in this state;
    // extracting its body must not silently change validation semantics.
    applyBattleSupport(state, battle, { type: 'battleSummon', fromLegionId: 'donor' })
    expect(battle.attackerSummoned).toBe(true)
  })
  it.each(['easy', 'normal', 'hard'] as const)('keeps the actual %s chooser deterministic without consuming real RNG in both support phases', difficulty => {
    const { state, battle } = fixture(); donor(state)
    state.players.forEach(player => { player.kind = 'ai'; player.aiDifficultyId = difficulty })
    const rng = vi.fn(() => { throw new Error('Unexpected chooser RNG') })
    for (const phase of ['Recruit', 'Summon'] as const) {
      supportPhase(battle, phase)
      expect(pickAiCommand(state, rng)).toEqual(pickBattleSupport(state, battle))
    }
    expect(rng).not.toHaveBeenCalled()
  })
  it('crosses real turn-four Recruit inside the requested horizon and enters exactly one legal reinforcement', () => {
    const { state, battle } = fixture(); const before = JSON.stringify(state)
    const oracle = copy(state); advanceBattlePhase(oracle, oracle.battle!)
    expect(oracle.battle).toMatchObject({ phase: 'Recruit', turn: 4, activeHalf: 'defender' })
    expect(listBattleReinforceOptions(oracle, oracle.battle!)).toContain('Cyclops')
    const result = runBattleTrial(state, battle, { type: 'battleDonePhase' }, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })
    console.log('REINFORCE-TRIAL', JSON.stringify({ complete: result.complete, boundary: result.boundary, cycles: result.cycles, units: result.battle.units }))
    expect(result).toMatchObject({ complete: true, boundary: false, cycles: 2 })
    expect(result.battle.defenderReinforced).toBe(true)
    const recruit = result.battle.units.find(unit => unit.id === 'bu-r-3')!
    expect(recruit.creatureType).toBe('Cyclops'); expect(recruit.hex).not.toBeNull()
    applyBattleSupport(oracle, oracle.battle!, pickBattleSupport(oracle, oracle.battle!))
    expect(legalBattleMovesFor(oracle, oracle.battle!, oracle.battle!.units.at(-1)!)).toContain(recruit.hex)
    expect(JSON.stringify(state)).toBe(before)
  })
  it('crosses real first-blood Summon inside its horizon with the shared first-donor policy and actual later entry', () => {
    const { state, battle, ours, theirs } = fixture('Plains', ['Colossus', 'Ogre'], ['Ogre', 'Titan'])
    state.players[1].titanPower = 12
    battle.turn = 5; battle.phase = 'Strike'; ours[0].hex = 'C3'; ours[1].hex = 'A1'; theirs[0].hex = 'C4'; theirs[0].hits = 5; theirs[1].hex = 'F4'
    const source = donor(state); const before = JSON.stringify(state)
    const oracle = copy(state); resolveStrikeFor(oracle, oracle.battle!, ours[0].id, theirs[0].id, () => 0, Array(10).fill(6))
    expect(oracle.battle).toMatchObject({ summonState: 'firstBlood', pendingSummon: true })
    const result = runBattleTrial(state, battle, { type: 'battleStrike', attackerId: ours[0].id, defenderId: theirs[0].id }, AI_PROFILES.balanced,
      84, { ...HARD_BATTLE_ROLLOUT, horizonCycles: 3 })
    expect(result).toMatchObject({ complete: true, boundary: false, cycles: 3 })
    expect(result.battle.attackerSummoned).toBe(true)
    expect([...result.battle.units, ...result.battle.fallen].some(unit => unit.creatureType === 'Angel' && unit.id.startsWith('bu-s-'))).toBe(true)
    expect([...result.battle.units, ...result.battle.fallen].some(unit => unit.creatureType === 'Archangel')).toBe(false)
    expect(source.creatures.map(creature => creature.type)).toEqual(['Angel', 'Archangel', 'Ogre']); expect(JSON.stringify(state)).toBe(before)
  })
  it('does not invent an entry hex when every real later reinforcement entrance is blocked', () => {
    const { state, battle, ours } = fixture(); supportPhase(battle, 'Recruit')
    battle.defenderEntrances = [ours[0].hex!]
    applyBattleSupport(state, battle, pickBattleSupport(state, battle))
    const recruit = battle.units.at(-1)!
    expect(legalBattleMovesFor(state, battle, recruit)).toEqual([])
    // Make the original pieces unable to move; the real engine permits a late
    // recruit to remain staged rather than fabricating a landing or first-entry kill.
    battle.units.filter(unit => unit.id !== recruit.id).forEach(unit => { unit.moved = true })
    const result = runBattleTrial(state, battle, { type: 'battleDonePhase' }, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })
    expect(result).toMatchObject({ complete: true, boundary: false })
    expect(result.battle.units.find(unit => unit.id === recruit.id)).toMatchObject({ hex: null, hits: 0 })
  })
  it('reuses exact support states while separating changed caretaker, first donor order, flags and same-ID different-type units', () => {
    const { state, battle } = fixture(); const cache = new Map(), distances = new Map<string, number>()
    const run = (value: GameState) => {
      const budget = { transitionNodes: 0, policyEvaluations: 0, policyCacheHits: 0 }
      const result = runBattleTrial(value, value.battle!, { type: 'battleDonePhase' }, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT }, budget, distances, cache)
      return { result, budget }
    }
    const cold = run(state), warm = run(state)
    expect(warm.result).toEqual(cold.result); expect(warm.budget.policyCacheHits).toBeGreaterThan(0)
    const noCyclops = copy(state); noCyclops.caretaker.Cyclops = 0
    const cached = run(noCyclops), fresh = runBattleTrial(noCyclops, noCyclops.battle!, { type: 'battleDonePhase' }, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })
    expect(cached.result).toEqual(fresh)
    expect(cached.result.battle.units.find(unit => unit.id === 'bu-r-3')?.creatureType).not.toBe('Cyclops')
    const changed = copy(state); changed.battle!.units[0].creatureType = 'Titan'; changed.legions[0].creatures[0].type = 'Titan'; changed.players[0].titanPower = 12
    expect(run(changed).result).toEqual(runBattleTrial(changed, changed.battle!, { type: 'battleDonePhase' }, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT }))
    supportPhase(battle, 'Summon'); donor(state)
    const summoned = runBattleTrial(state, battle, pickBattleSupport(state, battle), AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT }, undefined, distances, cache)
    const reversed = copy(state); reversed.legions.find(legion => legion.id === 'donor')!.creatures.reverse()
    const different = runBattleTrial(reversed, reversed.battle!, pickBattleSupport(reversed, reversed.battle!), AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT }, undefined, distances, cache)
    expect(different).toEqual(runBattleTrial(reversed, reversed.battle!, pickBattleSupport(reversed, reversed.battle!), AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT }))
    expect(summoned.battle.units.find(unit => unit.id.startsWith('bu-s-'))?.creatureType).toBe('Angel')
    expect(different.battle.units.find(unit => unit.id.startsWith('bu-s-'))?.creatureType).toBe('Archangel')
  })
  it('credits actual outside-donor losses instead of minting free material from a surviving summoned Angel', () => {
    const { state, battle } = fixture(); donor(state); supportPhase(battle, 'Summon')
    const origin = copy(state)
    const terminal = (summon: boolean, angelDies = false) => {
      const result = copy(origin), b = result.battle!
      applyBattleSupport(result, b, summon ? { type: 'battleSummon', fromLegionId: 'donor' } : { type: 'battleSkipSummon' })
      b.units.filter(unit => unit.legionId === b.defenderLegionId || (angelDies && unit.creatureType === 'Angel')).forEach(unit => { unit.hits = 999 })
      removeDeadCreatures(result, b)
      expect(b.done).toBe(true)
      return result
    }
    const noSummon = terminal(false), survivor = terminal(true), casualty = terminal(true, true)
    const utility = (value: GameState, playerId = state.players[0].id) => battleRolloutUtility(value, value.battle!, playerId, AI_PROFILES.balanced, origin)
    // Real terminal survivors heal. Ogre12 remains in each battle; transferring
    // Angel24 from the donor changes no world material unless it dies.
    expect(utility(noSummon)).toBe(12); expect(utility(survivor)).toBe(12); expect(utility(casualty)).toBe(-12)
    expect(utility(survivor, state.players[1].id)).toBe(-12)
    expect(utility(casualty, state.players[1].id)).toBe(12)
    expect(battleRolloutUtility(survivor, survivor.battle!, state.players[0].id, AI_PROFILES.balanced)).toBe(36)
  })
  it('keeps support inside the existing work ceilings and accepts only complete paired rounds from frozen state', () => {
    const { state, battle, ours } = fixture(); const before = JSON.stringify(state); frozen(state)
    const started = performance.now()
    const result = sampleBattleChoices(state, battle, [{ type: 'battleMove', unitId: ours[0].id, toHex: 'A2' }], { type: 'battleDonePhase' }, AI_PROFILES.balanced)
    console.log('SAMPLED-SUPPORT-WORK', JSON.stringify({ ms: performance.now() - started, work: result.work }))
    expect(result.work).toMatchObject({ usedRollout: true, boundaryStops: 0, creditedRounds: 8, completedRollouts: 16 })
    expect(result.work.transitionNodes).toBeLessThanOrEqual(3072); expect(result.work.policyEvaluations).toBeLessThanOrEqual(20000)
    const tiny = sampleBattleChoices(state, battle, [{ type: 'battleMove', unitId: ours[0].id, toHex: 'A2' }], { type: 'battleDonePhase' }, AI_PROFILES.balanced, { maxTransitionNodes: 1 })
    expect(tiny.work).toMatchObject({ usedRollout: false, creditedRounds: 0, exhausted: true })
    expect(tiny.command).toEqual({ type: 'battleDonePhase' }); expect(JSON.stringify(state)).toBe(before)
  })
  it('routes live support and sampled support through exactly one selector and engine authority', () => {
    const engine = readFileSync(new URL('../../engine/GameEngine.ts', import.meta.url), 'utf8')
    const live = readFileSync(new URL('../simpleAi.ts', import.meta.url), 'utf8')
    const rollout = readFileSync(new URL('../battleRollout.ts', import.meta.url), 'utf8')
    expect(engine).toContain('applyBattleSupport(state, battle, command)')
    expect(engine).not.toContain('Defender reinforces with'); expect(engine).not.toContain('Summoned angel leaves the source')
    expect(live).toContain('return pickBattleSupport(state, battle)'); expect(live).not.toContain('listBattleSummonSources')
    expect(rollout).toContain('return pickBattleSupport(state, battle)'); expect(rollout).toContain('applyBattleSupport(state, battle, command)')
  })
})
