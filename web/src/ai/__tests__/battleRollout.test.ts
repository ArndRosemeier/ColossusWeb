// Outcome fixtures deliberately use the lower-level engine independently of the planner.
import { describe, expect, it, vi } from 'vitest'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { startBattle, battleLand, advanceBattlePhase, applyTimeLoss, applyBattleResult, removeDeadCreatures, doCarry, resolveStrikeFor, legalStrikesFor, legalBattleMovesFor, listBattleReinforceOptions, listBattleSummonSources } from '../../engine/battle'
import { dispatch } from '../../engine/GameEngine'
import { getStrikeDice, getStrikeNumber, getUnitPower, listStrikeRaiseOptions } from '../../engine/battleStrike'
import { strikeExpectations } from '../battleProbability'
import { battleRolloutUtility, HARD_BATTLE_ROLLOUT, runBattleTrial, sampleBattleChoices, sampleBattleRoots, hasPendingInitialEntry } from '../battleRollout'
import { AI_PROFILES } from '../profiles'
import { planBattleManeuver, planBattleStrike, pickBestBattleMove } from '../evaluateBattle'
import { pickAiCommand } from '../simpleAi'
import type { GameCommand, GameState } from '../../engine/types'

function fixture(ownTypes = ['Hydra', 'Hydra'], enemyTypes = ['Titan', 'Colossus'], terrain = 'Plains') {
  const state = twoPlayerGame(17), own = state.legions[0], enemy = state.legions[1]
  const hex = Object.values(state.variant.board.hexByLabel).find(cell => cell.terrain === terrain)!.label
  own.creatures = ownTypes.map(type => ({ type, hits: 0 })); enemy.creatures = enemyTypes.map(type => ({ type, hits: 0 }))
  own.hexLabel = enemy.hexLabel = hex; own.enteredFrom = 'Bottom'; state.phase = 'Fight'
  state.players[0].aiDifficultyId = 'hard'; state.players[1].titanPower = 12; state.players[1].score = 600
  const battle = startBattle(state, own, enemy, () => 0.5)
  state.battle = battle; battle.turn = 5; battle.phase = 'Strike'; battle.activeHalf = 'attacker'; battle.activePlayerId = own.playerId
  battle.firstManeuverDone = { attacker: true, defender: true }
  const ours = battle.units.filter(unit => unit.playerId === own.playerId), theirs = battle.units.filter(unit => unit.playerId === enemy.playerId), land = battleLand(state, battle)
  return { state, battle, ours, theirs, land }
}
function combination() {
  const result = fixture(), { state, land, ours, theirs } = result
  theirs[0].hex = 'C3'; theirs[0].hits = 4; theirs[1].hex = 'D3'; theirs[1].hits = 9
  const common = land.hexByLabel.C3.neighbors.filter(label => label && land.hexByLabel.D3.neighbors.includes(label))
  expect(common).toHaveLength(2)
  ours[0].hex = common[0]; ours[1].hex = common[1]
  expect(getUnitPower(state, theirs[0]) - theirs[0].hits).toBe(8)
  return result
}
function deepFreeze(value: unknown, seen = new Set<unknown>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value); for (const child of Object.values(value)) deepFreeze(child, seen)
  Object.freeze(value)
}
function retainTitansOutsideBattle(state: GameState) {
  const reserveHex = Object.values(state.variant.board.hexByLabel).find(hex => hex.label !== state.legions[0].hexLabel)!.label
  state.legions.push(...state.legions.map(legion => ({ ...structuredClone(legion), id: `${legion.id}-reserve`, hexLabel: reserveHex, creatures: [{ type: 'Titan', hits: 0 }] })))
}

describe('Hard battle search resolves actual sampled outcomes', () => {
  it('allows physically complete first entry and lets the real engine commit its still-pending first maneuver', () => {
    const { state, battle, ours, theirs } = fixture(['Ogre', 'Ogre'], ['Ogre', 'Ogre'])
    battle.phase = 'Move'; battle.turn = 1; battle.firstManeuverDone.attacker = false; battle.attackerCommitted = false
    ours[0].hex = 'A1'; ours[1].hex = 'A2'; theirs[0].hex = 'F3'; theirs[1].hex = 'F4'
    ours.forEach(unit => { unit.moved = true })
    expect(hasPendingInitialEntry(state, battle)).toBe(false)
    const { variant, ...mutable } = state, oracle = { ...structuredClone(mutable), variant } as GameState
    advanceBattlePhase(oracle, oracle.battle!)
    expect(oracle.battle).toMatchObject({ activeHalf: 'defender', phase: 'Move', attackerCommitted: true, firstManeuverDone: { attacker: true, defender: true } })
    const trial = runBattleTrial(state, battle, { type: 'battleDonePhase' }, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })
    expect(trial).toMatchObject({ complete: true, boundary: false, cycles: 2 })
    expect(trial.battle.attackerCommitted).toBe(true)
    expect(trial.battle.firstManeuverDone).toEqual({ attacker: true, defender: true })
    expect(battle.attackerCommitted).toBe(false); expect(battle.firstManeuverDone.attacker).toBe(false)
  })
  it('credits a completed horizon before its next real reinforcement decision without inventing a recruit', () => {
    const { state, battle, ours, theirs } = fixture(['Ogre'], ['Gargoyle', 'Gargoyle'], 'Brush')
    battle.turn = 3; battle.phase = 'Move'; battle.activeHalf = 'defender'; battle.activePlayerId = state.players[1].id
    ours[0].hex = 'A1'; theirs[0].hex = 'F4'; theirs[1].hex = 'F3'
    expect(listBattleReinforceOptions(state, battle).length).toBeGreaterThan(0)
    const { variant, ...mutable } = state, oracle = { ...structuredClone(mutable), variant } as GameState
    advanceBattlePhase(oracle, oracle.battle!)
    expect(oracle.battle).toMatchObject({ activeHalf: 'attacker', turn: 3, phase: 'Move' })
    advanceBattlePhase(oracle, oracle.battle!)
    expect(oracle.battle).toMatchObject({ activeHalf: 'defender', turn: 4, phase: 'Recruit' })
    const trial = runBattleTrial(state, battle, { type: 'battleDonePhase' }, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })
    expect(trial).toMatchObject({ complete: true, boundary: false, cycles: 2 })
    expect(trial.battle).toMatchObject({ activeHalf: 'defender', turn: 4, phase: 'Recruit' })
    expect(trial.battle.units).toHaveLength(3)
    expect(trial.battle.units.some(unit => unit.creatureType === 'Cyclops')).toBe(false)
  })
  it('keeps the actual Normal formation against a pyrrhic contact formation after real ordinary Strikeback', () => {
    const { state, battle, ours, theirs } = fixture(['Hydra', 'Ogre'], ['Ogre'])
    battle.phase = 'Move'; ours[0].hex = 'A2'; ours[1].hex = 'B2'; ours[1].hits = 5; theirs[0].hex = 'C4'; theirs[0].hits = 5
    retainTitansOutsideBattle(state)
    const control = pickBestBattleMove(state, battle, AI_PROFILES.balanced, () => 0, { rollout: false })
    const baseline = control.type === 'battleMove' ? dispatch(state, control, () => 0) : state
    const badCommand: GameCommand = { type: 'battleMove', unitId: ours[0].id, toHex: 'A1' }
    const bad = dispatch(dispatch(state, badCommand, () => 0), { type: 'battleMove', unitId: ours[1].id, toHex: 'C3' }, () => 0)
    const roots = [
      { id: 'normal', battle: baseline.battle!, first: { type: 'battleDonePhase' as const }, command: control },
      { id: 'pyrrhic', battle: bad.battle!, first: { type: 'battleDonePhase' as const }, command: badCommand },
    ]
    const result = sampleBattleRoots(state, battle, roots.slice(1), roots[0], AI_PROFILES.balanced, { seed: 84 })
    console.log('NORMAL-VS-PYRRHIC-FORMATION', JSON.stringify(result))
    expect(result.work).toMatchObject({ usedRollout: true, creditedRounds: 8, completedRollouts: 16 })
    expect(result.rootId).toBe('normal'); expect(result.command).toEqual(control)
    expect(result.work.decisions[1].meanUtility).toBeLessThan(result.work.decisions[0].meanUtility)
    for (let index = 0; index < roots.length; index++) {
      let sum = 0
      for (let round = 0; round < 8; round++) {
        const seed = (84 + Math.imul(round + 1, 0x9e3779b9)) >>> 0
        const trial = runBattleTrial(state, roots[index].battle, roots[index].first, AI_PROFILES.balanced, seed, { ...HARD_BATTLE_ROLLOUT })
        expect(trial.complete).toBe(true); sum += trial.utility
      }
      expect(result.work.decisions[index].meanUtility).toBeCloseTo(sum / 8, 10)
    }
    advanceBattlePhase(baseline, baseline.battle!)
    const normalHydra = baseline.battle!.units.find(unit => unit.id === ours[0].id)!
    expect(legalStrikesFor(baseline, baseline.battle!, normalHydra)).toContain(theirs[0].id)
    resolveStrikeFor(baseline, baseline.battle!, normalHydra.id, theirs[0].id, () => 0, Array(5).fill(6))
    advanceBattlePhase(baseline, baseline.battle!)
    expect(baseline.battle?.done).toBe(true)
    expect(battleRolloutUtility(baseline, baseline.battle!, state.players[0].id, AI_PROFILES.balanced)).toBe(42)
    // Same initial wounded Ogre, but contact lets its slain opponent retaliate.
    advanceBattlePhase(bad, bad.battle!)
    resolveStrikeFor(bad, bad.battle!, ours[1].id, theirs[0].id, () => 0, [6, 1, 1, 1, 1, 1])
    advanceBattlePhase(bad, bad.battle!)
    expect(legalStrikesFor(bad, bad.battle!, bad.battle!.units.find(unit => unit.id === theirs[0].id)!)).toContain(ours[1].id)
    resolveStrikeFor(bad, bad.battle!, theirs[0].id, ours[1].id, () => 0, [6, 1, 1, 1, 1, 1])
    advanceBattlePhase(bad, bad.battle!)
    expect(bad.battle).toMatchObject({ done: true, winnerPlayerId: state.players[0].id })
    expect(battleRolloutUtility(bad, bad.battle!, state.players[0].id, AI_PROFILES.balanced)).toBe(30)
  })
  it('stops at the support horizon and resolves a real safe skip inside a longer horizon', () => {
    const { state, battle, ours, theirs } = fixture(['Colossus', 'Ogre'], ['Ogre', 'Titan'])
    ours[0].hex = 'C3'; ours[1].hex = 'A1'; theirs[0].hex = 'C4'; theirs[0].hits = 5; theirs[1].hex = 'F4'
    state.legions.push({ ...structuredClone(state.legions[0]), id: 'summon-donor', hexLabel: '100',
      creatures: [{ type: 'Titan', hits: 0 }, { type: 'Angel', hits: 0 }] })
    expect(listBattleSummonSources(state, battle)).toHaveLength(1)
    const { variant, ...mutable } = state, oracle = { ...structuredClone(mutable), variant } as GameState, b = oracle.battle!
    resolveStrikeFor(oracle, b, ours[0].id, theirs[0].id, () => 0, Array(10).fill(6))
    advanceBattlePhase(oracle, b)
    resolveStrikeFor(oracle, b, theirs[0].id, ours[0].id, () => 0, Array(6).fill(1))
    advanceBattlePhase(oracle, b)
    expect(b).toMatchObject({ activeHalf: 'defender', turn: 6, phase: 'Move' })
    advanceBattlePhase(oracle, b)
    expect(b).toMatchObject({ activeHalf: 'attacker', turn: 6, phase: 'Summon' })
    const first: GameCommand = { type: 'battleStrike', attackerId: ours[0].id, defenderId: theirs[0].id }
    const trial = runBattleTrial(state, battle, first, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })
    expect(trial).toMatchObject({ complete: true, boundary: false, cycles: 2 })
    expect(trial.battle.phase).toBe('Summon')
    expect(trial.battle.units.some(unit => unit.creatureType === 'Angel')).toBe(false)
    expect(state.legions.find(legion => legion.id === 'summon-donor')!.creatures).toHaveLength(2)
    const longer = runBattleTrial(state, battle, first, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT, horizonCycles: 3 })
    expect(longer).toMatchObject({ complete: true, boundary: false, cycles: 3 })
    expect(longer.battle.attackerSummoned).toBe(false) // Existing policy protects the donor's lone Titan.
    expect(longer.battle.summonState).toBe('tooLate')
    expect(longer.battle.units.some(unit => unit.creatureType === 'Angel')).toBe(false)
  })
  it('does not mistake four forced Gargoyle hits for a favorable expected exchange or lost ordinary Strikeback', () => {
    const { state, battle, ours, theirs, land } = fixture(['Gargoyle'], ['Ranger'])
    ours[0].hex = 'C3'; theirs[0].hex = 'C4'
    const attack = getStrikeNumber(state, ours[0], theirs[0], land, true), retaliation = getStrikeNumber(state, theirs[0], ours[0], land, true)
    expect(attack).toBe(5); expect(retaliation).toBe(3)
    expect(strikeExpectations(4, attack, 4).killProbability).toBeCloseTo(1 / 81)
    expect(strikeExpectations(4, retaliation, 4).killProbability).toBeCloseTo(16 / 81)
    resolveStrikeFor(state, battle, ours[0].id, theirs[0].id, () => 0, [6, 6, 6, 6])
    advanceBattlePhase(state, battle)
    expect(legalStrikesFor(state, battle, theirs[0])).toContain(ours[0].id)
    resolveStrikeFor(state, battle, theirs[0].id, ours[0].id, () => 0, [6, 6, 6, 6])
    advanceBattlePhase(state, battle)
    expect(battle).toMatchObject({ done: true, winnerPlayerId: null })
    expect(battle.fallen).toHaveLength(2)
  })
  it('compares an actual pyrrhic ordinary win with an unfinished superior army on the same material scale', () => {
    const { state, battle, ours, theirs } = fixture(['Hydra', 'Hydra'], ['Colossus'])
    retainTitansOutsideBattle(state)
    battle.turn = 1; ours[0].hex = 'C3'; ours[1].hex = 'A1'; theirs[0].hex = 'D3'; theirs[0].hits = 9
    const continuation = battleRolloutUtility(state, battle, state.players[0].id, AI_PROFILES.balanced)
    // One hit finishes the Colossus, whose real dead Strikeback kills the first
    // Hydra. The other full-health Hydra survives the completed engagement.
    resolveStrikeFor(state, battle, ours[0].id, theirs[0].id, () => 0, [6, ...Array(9).fill(1)])
    advanceBattlePhase(state, battle)
    expect(legalStrikesFor(state, battle, theirs[0])).toContain(ours[0].id)
    resolveStrikeFor(state, battle, theirs[0].id, ours[0].id, () => 0, Array(10).fill(6))
    advanceBattlePhase(state, battle)
    expect(battle).toMatchObject({ done: true, winnerPlayerId: state.players[0].id })
    const costlyWin = battleRolloutUtility(state, battle, state.players[0].id, AI_PROFILES.balanced)
    expect(costlyWin).toBe(30)
    expect(continuation).toBeGreaterThan(costlyWin)
    applyBattleResult(state, battle)
    expect(state.legions.find(legion => legion.playerId === state.players[0].id)!.creatures).toEqual([{ type: 'Hydra', hits: 0 }])
  })
  it('values healed ordinary survivors by their actual material and removes the entire time-loss loser', () => {
    const survivorValue = (type: string) => {
      const { state, battle, ours, theirs } = fixture([type], ['Ogre'])
      retainTitansOutsideBattle(state)
      ours[0].hex = 'C3'; ours[0].hits = getUnitPower(state, ours[0]) - 1
      theirs[0].hex = 'F4'; theirs[0].hits = getUnitPower(state, theirs[0])
      removeDeadCreatures(state, battle)
      expect(battle.done).toBe(true)
      const value = battleRolloutUtility(state, battle, state.players[0].id, AI_PROFILES.balanced)
      applyBattleResult(state, battle)
      expect(state.legions.find(legion => legion.id === battle.attackerLegionId)!.creatures).toEqual([{ type, hits: 0 }])
      return value
    }
    expect(survivorValue('Hydra')).toBe(30)
    expect(survivorValue('Ogre')).toBe(12)
    const { state, battle, ours, theirs } = fixture(['Hydra'], ['Ogre'])
    ours[0].hex = 'A1'; theirs[0].hex = 'F4'; theirs[0].hits = 5
    applyTimeLoss(state, battle)
    expect(battleRolloutUtility(state, battle, state.players[0].id, AI_PROFILES.balanced)).toBe(-12)
    // Pre-result snapshot can still contain alive attackers; clock authority
    // eliminates them regardless of that representation.
    ours[0].hits = 0
    expect(battleRolloutUtility(state, battle, state.players[0].id, AI_PROFILES.balanced)).toBe(-12)
    applyBattleResult(state, battle)
    expect(state.legions.some(legion => legion.id === battle.attackerLegionId)).toBe(false)
  })
  it('censors actual Woods first deployment instead of crediting a greedy simulated Titan entry failure', () => {
    const { state } = fixture(['Titan', 'Ogre'], ['Titan', 'Gorgon', 'Gorgon', 'Cyclops', 'Cyclops', 'Behemoth', 'Ogre'], 'Woods')
    state.players[1].kind = 'ai'; state.players[1].aiDifficultyId = 'normal'
    state.legions[0].enteredFrom = 'Left'
    const battle = startBattle(state, state.legions[0], state.legions[1], () => 0)
    state.battle = battle
    const fallback = pickAiCommand(state, () => 0)!
    expect(fallback.type).toBe('battleMove')
    const alternatives = battle.units.flatMap(unit => legalBattleMovesFor(state, battle, unit).map(toHex => ({ type: 'battleMove' as const, unitId: unit.id, toHex })))
      .filter(command => JSON.stringify(command) !== JSON.stringify(fallback))
    expect(alternatives.length).toBeGreaterThan(0)
    const result = sampleBattleChoices(state, battle, alternatives, fallback, AI_PROFILES.balanced)
    expect(result.command).toEqual(fallback)
    expect(result.work).toMatchObject({ reason: 'boundary', boundaryStops: 1, completedRollouts: 0, creditedRounds: 0, transitionNodes: 0, usedRollout: false })
    let game = state
    for (let step = 0; step < 60 && game.battle && !game.battle.firstManeuverDone.defender; step++) {
      const command = pickAiCommand(game, () => 0)!
      game = dispatch(game, command, () => 0)
    }
    expect(game.battle?.firstManeuverDone.defender).toBe(true)
    expect(game.log.filter(line => /failed to enter/.test(line))).toEqual([])
    expect(game.battle?.fallen.some(unit => unit.creatureType === 'Titan')).toBe(false)
    expect(game.winnerId).toBeFalsy()
    expect(game.battle?.firstManeuverDone).toEqual({ attacker: false, defender: true })
    const pendingEnemyEntry = runBattleTrial(game, game.battle!, { type: 'battleDonePhase' }, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })
    expect(pendingEnemyEntry).toMatchObject({ complete: false, boundary: true, utility: 0, cycles: 0 })
  })
  it('sees the two-action Titan kill that the one-ply kill/carry choice misses', () => {
    const { state, battle, ours, theirs } = combination()
    battle.turn = 7 // The second action must finish the Titan now; turn-eight time loss is real.
    const myopic = planBattleStrike(state, battle, AI_PROFILES.balanced, () => 0, false)
    const start = performance.now()
    const searched = planBattleStrike(state, battle, AI_PROFILES.balanced, () => 0, { seed: 84 })
    console.log('Hard combination fixture', JSON.stringify({ myopic, searched, elapsedMs: performance.now() - start }))
    expect(myopic.command).toMatchObject({ type: 'battleStrike', defenderId: theirs[1].id })
    expect(searched.rollout?.completedRollouts).toBeGreaterThan(0)
    expect(searched.rollout?.creditedRounds).toBe(32)
    expect(searched.command).toMatchObject({ type: 'battleStrike', defenderId: theirs[0].id })
    const resolveLine = (targetTitan: boolean) => {
      const { variant, ...mutable } = state, sim = { ...structuredClone(mutable), variant } as GameState, b = sim.battle!
      const faces = [6, 6, 6, 6, 1, 1, 1, 1, 1, 1]
      resolveStrikeFor(sim, b, ours[0].id, targetTitan ? theirs[0].id : theirs[1].id, () => 0, faces)
      if (b.pendingCarry) doCarry(sim, b, theirs[0].id)
      resolveStrikeFor(sim, b, ours[1].id, theirs[0].id, () => 0, faces)
      if (b.pendingCarry) doCarry(sim, b, theirs[1].id)
      advanceBattlePhase(sim, b)
      for (const unit of b.units.filter(unit => unit.playerId === b.activePlayerId)) {
        const target = legalStrikesFor(sim, b, unit)[0]
        if (target) {
          const defender = b.units.find(candidate => candidate.id === target)!
          resolveStrikeFor(sim, b, unit.id, target, () => 0, Array(getStrikeDice(sim, battleLand(sim, b), unit, defender, true)).fill(1))
          if (b.pendingCarry) doCarry(sim, b, b.pendingCarry.targetIds[0])
        }
      }
      advanceBattlePhase(sim, b)
      return b
    }
    expect(resolveLine(true)).toMatchObject({ done: true, endedByTitanKill: true, winnerPlayerId: state.players[0].id })
    const delayed = resolveLine(false)
    expect(delayed).toMatchObject({ done: true, timeLoss: true, winnerPlayerId: state.players[1].id })
    expect(delayed.units.find(unit => unit.id === theirs[0].id)!.hits).toBe(11)
  })
  it('uses isolated deterministic dice on frozen inputs and preserves the established real chooser RNG count', () => {
    const { state, battle } = combination(), before = JSON.stringify(state)
    deepFreeze(state)
    const world = vi.fn(() => 0), now = vi.spyOn(Date, 'now'), random = vi.spyOn(Math, 'random')
    try {
      const result = planBattleStrike(state, battle, AI_PROFILES.balanced, world, { seed: 84 })
      expect(world).toHaveBeenCalledTimes(1)
      expect(now).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled()
      expect(planBattleStrike(state, battle, AI_PROFILES.balanced, () => 0, { seed: 84 })).toEqual(result)
      expect(JSON.stringify(state)).toBe(before)
    } finally { now.mockRestore(); random.mockRestore() }
  })
  it('rejects one lucky paired terminal improvement rather than obligatorily gambling because the seat is Hard', () => {
    const { state, battle } = combination()
    const fallback = planBattleStrike(state, battle, AI_PROFILES.balanced, () => 0, false)
    const result = planBattleStrike(state, battle, AI_PROFILES.balanced, () => 0, { seed: 84, trialsPerCandidate: 16 })
    expect(result.rollout?.usedRollout).toBe(true)
    expect(result.rollout?.decisions.some(choice => choice.pairedAdvantage > 0 && !choice.accepted)).toBe(true)
    expect(result.command).toEqual(fallback.command)
  })
  it('retains a slain ordinary striker through real Strikeback', () => {
    const { state, battle, ours, theirs } = fixture(['Ogre'], ['Ogre'])
    ours[0].hex = 'C3'; ours[0].hits = 5; theirs[0].hex = 'C4'; theirs[0].hits = 5
    const trial = runBattleTrial(state, battle, { type: 'battleStrike', attackerId: ours[0].id, defenderId: theirs[0].id },
      AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })
    expect(trial.complete).toBe(true)
    expect(trial.battle).toMatchObject({ done: true, winnerPlayerId: null })
    expect(trial.battle.fallen.map(unit => unit.id).sort()).toEqual([ours[0].id, theirs[0].id].sort())
  })
  it('values actual Titan time-loss elimination identically to combat elimination, including multiplayer mutual loss', () => {
    const clock = fixture(['Titan'], ['Titan'])
    clock.ours[0].hex = 'A1'; clock.theirs[0].hex = 'F4'
    applyTimeLoss(clock.state, clock.battle)
    expect(clock.battle.timeLoss).toBe(true); expect(clock.battle.endedByTitanKill).not.toBe(true)
    expect(battleRolloutUtility(clock.state, clock.battle, clock.state.players[0].id, AI_PROFILES.balanced)).toBe(-1000000)
    applyBattleResult(clock.state, clock.battle)
    expect(clock.state.players[0].dead).toBe(true)
    const combat = fixture(['Titan'], ['Titan'])
    combat.ours[0].hex = 'A1'; combat.theirs[0].hex = 'F4'; combat.ours[0].hits = getUnitPower(combat.state, combat.ours[0])
    removeDeadCreatures(combat.state, combat.battle)
    expect(combat.battle.endedByTitanKill).toBe(true)
    expect(battleRolloutUtility(combat.state, combat.battle, combat.state.players[0].id, AI_PROFILES.balanced)).toBe(-1000000)
    const mutual = fixture(['Titan'], ['Titan'])
    mutual.ours[0].hits = getUnitPower(mutual.state, mutual.ours[0]); mutual.theirs[0].hits = getUnitPower(mutual.state, mutual.theirs[0])
    removeDeadCreatures(mutual.state, mutual.battle)
    expect(battleRolloutUtility(mutual.state, mutual.battle, mutual.state.players[0].id, AI_PROFILES.balanced)).toBe(0)
    const third = twoPlayerGame(17, { players: [{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }, { name: 'C', kind: 'human' }] })
    mutual.state.players.push(third.players[2]); mutual.state.legions.push(third.legions.find(legion => legion.playerId === third.players[2].id)!)
    expect(battleRolloutUtility(mutual.state, mutual.battle, mutual.state.players[0].id, AI_PROFILES.balanced)).toBe(-1000000)
    applyBattleResult(mutual.state, mutual.battle)
    expect(mutual.state.players[0].dead).toBe(true)
    expect(battleRolloutUtility(mutual.state, mutual.battle, mutual.state.players[0].id, AI_PROFILES.balanced)).toBe(-1000000)
  })
  it('leaves Normal and Easy decisions and real RNG calls identical with search enabled/disabled', () => {
    const { state, battle } = combination()
    for (const level of ['easy', 'normal'] as const) {
      state.players[0].aiDifficultyId = level
      const first = vi.fn(() => 0.4), second = vi.fn(() => 0.4)
      expect(planBattleStrike(state, battle, AI_PROFILES.balanced, first)).toEqual(planBattleStrike(state, battle, AI_PROFILES.balanced, second, false))
      expect(first.mock.calls).toEqual(second.mock.calls)
      expect(first).toHaveBeenCalledTimes(1)
    }
  })
  it('falls back without crediting partial candidates under a one-node budget', () => {
    const { state, battle } = combination()
    const baseline = planBattleStrike(state, battle, AI_PROFILES.balanced, () => 0, false)
    const result = planBattleStrike(state, battle, AI_PROFILES.balanced, () => 0, { maxTransitionNodes: 1 })
    expect(result.command).toEqual(baseline.command)
    expect(result.rollout).toMatchObject({ creditedRounds: 0, completedRollouts: 0, exhausted: true, usedRollout: false, transitionNodes: 0 })
  })
  it('uses actual Normal maneuver fallback and preserves mandatory clock safety before sampling', () => {
    const { state, battle, ours, theirs } = fixture(['Ogre'], ['Ogre'])
    battle.phase = 'Move'; ours[0].hex = 'A1'; theirs[0].hex = 'F4'
    const normal = { ...state, players: state.players.map(player => ({ ...player, aiDifficultyId: 'normal' as const })) }
    const result = planBattleManeuver(state, battle, AI_PROFILES.balanced, { rollout: { maxTransitionNodes: 1 } })
    expect(result.command).toEqual(planBattleManeuver(normal, battle, AI_PROFILES.balanced).command)
    expect(result.rollout?.usedRollout).toBe(false)
    const safe = fixture(['Ogre'], ['Titan'])
    safe.state.players[1].aiDifficultyId = 'hard'; safe.state.players[1].titanPower = 6
    safe.battle.phase = 'Move'; safe.battle.activeHalf = 'defender'; safe.battle.activePlayerId = safe.state.players[1].id; safe.battle.turn = 7
    safe.theirs[0].hex = 'A3'; safe.theirs[0].hits = 5; safe.ours[0].hex = 'C1'
    const hold = planBattleManeuver(safe.state, safe.battle, AI_PROFILES.balanced)
    expect(hold.command).toEqual({ type: 'battleDonePhase' }); expect(hold.rollout).toBeUndefined()
  })
  it('compares both roots through real in-horizon reinforcement without mutating the original army', () => {
    const { state, battle, ours, theirs } = fixture(['Ogre'], ['Gargoyle', 'Gargoyle'], 'Brush')
    battle.turn = 3; battle.phase = 'Move'
    ours[0].hex = 'A1'; theirs[0].hex = 'F4'; theirs[1].hex = 'F3'
    const fallback: GameCommand = { type: 'battleDonePhase' }
    const result = sampleBattleChoices(state, battle, [{ type: 'battleMove', unitId: ours[0].id, toHex: 'A2' }], fallback, AI_PROFILES.balanced)
    expect(result.command).toEqual(fallback)
    expect(result.work).toMatchObject({ boundaryStops: 0, usedRollout: true, reason: 'complete', creditedRounds: 8, completedRollouts: 16 })
    expect(state.battle!.units).toHaveLength(3)
  })
  it('keeps legal carry and raised strike numbers under engine validation', () => {
    const { state, battle, ours, theirs, land } = fixture(['Hydra'], ['Ogre', 'Centaur'])
    ours[0].hex = 'C3'; theirs[0].hex = 'C4'; theirs[1].hex = 'D3'; theirs[0].hits = 5; theirs[1].hits = 2
    const raised = listStrikeRaiseOptions(state, battle, land, ours[0], theirs[0]).options
    expect(raised.some(option => option.need === 5)).toBe(true)
    const command: GameCommand = { type: 'battleStrike', attackerId: ours[0].id, defenderId: theirs[0].id, raisedStrikeNumber: 5 }
    const result = runBattleTrial(state, battle, command, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })
    expect(result.complete).toBe(true)
    expect(() => runBattleTrial(state, battle, { ...command, raisedStrikeNumber: 2 }, AI_PROFILES.balanced, 84, { ...HARD_BATTLE_ROLLOUT })).toThrow('Illegal rollout raised strike')
  })
  it('completes real two-cycle work on a seven-versus-seven deployed maneuver within explicit ceilings', () => {
    const types = ['Cyclops', 'Ogre', 'Ogre', 'Centaur', 'Centaur', 'Gargoyle', 'Gargoyle']
    const { state, battle, ours, theirs } = fixture(types, types)
    battle.phase = 'Move'
    const a = ['A3', 'B4', 'C5', 'D6', 'E5', 'F4', 'D5'], d = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'D2']
    ours.forEach((unit, index) => { unit.hex = a[index] }); theirs.forEach((unit, index) => { unit.hex = d[index] })
    deepFreeze(state)
    const before = JSON.stringify(state), start = performance.now()
    const result = planBattleManeuver(state, battle, AI_PROFILES.balanced, { maneuver: false })
    console.log('Hard 7v7 real rollout', JSON.stringify({ ...result, elapsedMs: performance.now() - start }))
    expect(result.rollout?.usedRollout).toBe(true)
    expect(result.rollout?.completedRollouts).toBe(24)
    const rootMovers = result.rollout!.decisions.map(choice => choice.command.type === 'battleMove' ? choice.command.unitId : 'hold')
    expect(rootMovers).toHaveLength(HARD_BATTLE_ROLLOUT.candidateLimit)
    expect(new Set(rootMovers).size).toBe(rootMovers.length)
    expect(result.rollout?.minCompletedCycles).toBe(2)
    expect(result.rollout!.transitionNodes).toBeGreaterThan(100)
    expect(result.rollout!.transitionNodes).toBeLessThanOrEqual(HARD_BATTLE_ROLLOUT.maxTransitionNodes)
    expect(result.rollout!.policyEvaluations).toBeLessThanOrEqual(HARD_BATTLE_ROLLOUT.maxPolicyEvaluations)
    expect(JSON.stringify(state)).toBe(before)
  })
  it('also completes the larger paired strike sample on a real seven-versus-seven contact battle', () => {
    const types = ['Cyclops', 'Ogre', 'Ogre', 'Centaur', 'Centaur', 'Gargoyle', 'Gargoyle']
    const { state, battle, ours, theirs } = fixture(types, types)
    const a = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'D2'], d = ['A2', 'B2', 'C2', 'D3', 'E2', 'F2', 'C3']
    ours.forEach((unit, index) => { unit.hex = a[index] }); theirs.forEach((unit, index) => { unit.hex = d[index] })
    deepFreeze(state)
    const start = performance.now(), result = planBattleStrike(state, battle, AI_PROFILES.balanced, () => 0)
    console.log('Hard 7v7 real strike rollout', JSON.stringify({ work: result.rollout, elapsedMs: performance.now() - start }))
    expect(result.rollout?.usedRollout).toBe(true)
    expect(result.rollout?.creditedRounds).toBe(16)
    expect(result.rollout!.completedRollouts).toBeGreaterThanOrEqual(32)
    expect(result.rollout!.transitionNodes).toBeLessThanOrEqual(HARD_BATTLE_ROLLOUT.maxTransitionNodes)
  })
})
