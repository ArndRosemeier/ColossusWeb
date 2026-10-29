import { describe, expect, it } from 'vitest'
import { dispatch } from '../../engine/GameEngine'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { startBattle, battleLand, legalBattleMovesFor } from '../../engine/battle'
import { legalStrikes, getUnitPower } from '../../engine/battleStrike'
import { hazardDamageToCreature } from '../../engine/battleland'
import { AI_PROFILES } from '../profiles'
import { evaluateBattleHex, evaluateBattleStrike, pickBestBattleMove, pickBestBattleStrike, planBattleManeuver } from '../evaluateBattle'
import { legalEnemyResponse, NORMAL_BATTLE_PLANNER } from '../battleResponse'
import { strikeExpectations } from '../battleProbability'
import { AI_DIFFICULTY_CHOICES } from '../difficulty'

function fixture(terrain = 'Plains', ownTypes = ['Titan'], enemyTypes = ['Ogre']) {
  const state = twoPlayerGame(42), attacker = state.legions[0], defender = state.legions[1]
  const hex = Object.values(state.variant.board.hexByLabel).find(candidate => candidate.terrain === terrain)!
  attacker.creatures = enemyTypes.map(type => ({ type, hits: 0 }))
  defender.creatures = ownTypes.map(type => ({ type, hits: 0 }))
  attacker.hexLabel = defender.hexLabel = hex.label; attacker.enteredFrom = 'Bottom'
  state.phase = 'Fight'
  const battle = startBattle(state, attacker, defender, () => 0.5)
  state.battle = battle; battle.turn = 7; battle.phase = 'Move'; battle.activeHalf = 'defender'
  battle.activePlayerId = defender.playerId; battle.firstManeuverDone = { attacker: true, defender: true }
  state.legions.push({ ...attacker, id: 'reserve-titan', markerId: 'Rd02',
    hexLabel: Object.values(state.variant.board.hexByLabel).find(candidate => candidate.terrain === 'Brush')!.label,
    creatures: [{ type: 'Titan', hits: 0 }] })
  return { state, battle, own: battle.units.filter(unit => unit.playerId === defender.playerId),
    enemy: battle.units.filter(unit => unit.playerId === attacker.playerId), land: battleLand(state, battle) }
}

describe('exact strike distributions', () => {
  it('uses probability mass for kills, capped damage and legally useful overflow', () => {
    expect(strikeExpectations(2, 4, 1, 1)).toEqual({ expectedHits: 1, expectedDamage: 0.75, killProbability: 0.75, expectedOverflow: 0.25 })
    expect(strikeExpectations(0, 4, 1)).toMatchObject({ expectedDamage: 0, killProbability: 0, expectedOverflow: 0 })
    expect(strikeExpectations(5, 1, 2, 1)).toMatchObject({ expectedDamage: 2, killProbability: 1, expectedOverflow: 1 })
    const large = strikeExpectations(2000, 4, 1000)
    expect(large.killProbability).toBeGreaterThan(0.5); expect(large.killProbability).toBeLessThan(0.52)
    expect(large.expectedDamage).toBeGreaterThan(980)
    expect(() => strikeExpectations(-1, 4, 2)).toThrow('Invalid')
  })
  it('chooses the valuable wounded Colossus over the old mean-threshold Centaur rangestrike', () => {
    const { state, battle, own, enemy, land } = fixture('Plains', ['Hydra'], ['Colossus', 'Centaur'])
    const hydra = own[0], colossus = enemy[0], centaur = enemy[1]
    hydra.hex = 'C3'; colossus.hex = 'C5'; centaur.hex = 'E3'; colossus.hits = 8; centaur.hits = 2
    battle.phase = 'Strike'; battle.turn = 4
    expect(legalStrikes(state, battle, land, hydra, true).sort()).toEqual([colossus.id, centaur.id].sort())
    expect(evaluateBattleStrike(state, battle, hydra, colossus, AI_PROFILES.balanced)).toBeGreaterThan(evaluateBattleStrike(state, battle, hydra, centaur, AI_PROFILES.balanced))
    expect(pickBestBattleStrike(state, battle, AI_PROFILES.balanced, () => 0)).toMatchObject({ type: 'battleStrike', defenderId: colossus.id })
  })
})

describe('bounded battle response planning', () => {
  it('uses the actual battle owner difficulty for measurable Easy/Normal/Hard planning work', () => {
    const { state, battle, own, enemy } = fixture('Plains', ['Titan', 'Ogre', 'Centaur'], ['Ogre', 'Lion'])
    battle.turn = 5; state.activePlayerIndex = 0; state.players[0].aiDifficultyId = 'easy'
    own[0].hex = 'A3'; own[1].hex = 'B3'; own[2].hex = 'C5'; enemy[0].hex = 'D1'; enemy[1].hex = 'E2'
    const work = AI_DIFFICULTY_CHOICES.map(level => {
      state.players[1].aiDifficultyId = level.id
      const before = structuredClone(state)
      const plan = planBattleManeuver(state, battle, AI_PROFILES.balanced)
      expect(state).toEqual(before)
      expect(plan.work.responseNodes).toBeLessThanOrEqual(level.battle.maxResponseNodes)
      expect(plan.work.candidatesEvaluated).toBeLessThanOrEqual(level.battle.candidateLimit + 1)
      return { level: level.id, ...plan.work }
    })
    console.log('Difficulty actual battle work', JSON.stringify(work))
    expect(work.map(level => level.candidatesEvaluated)).toEqual([3, 9, 17])
    expect(work[2].responseNodes).toBeGreaterThan(work[1].responseNodes)
    expect(work[1].responseNodes).toBeGreaterThan(work[0].responseNodes)
    expect(work.every(level => level.safetyNodes === work[0].safetyNodes)).toBe(true)
  })
  it('keeps exact strike, clock, lethal and delayed terrain safety at all three levels', () => {
    for (const level of AI_DIFFICULTY_CHOICES) {
      const { state, battle, own, enemy, land } = fixture('Tundra')
      state.players[1].aiDifficultyId = level.id
      own[0].hex = 'C4'; own[0].hits = 4; enemy[0].hex = 'A1'
      const command = pickBestBattleMove(state, battle, AI_PROFILES.balanced, () => 0)
      expect(command.type).toBe('battleMove')
      if (command.type === 'battleMove') expect(hazardDamageToCreature(land.hexByLabel[command.toHex].terrain, state.variant.creatures.Titan)).toBe(0)
      const safe = fixture()
      safe.state.players[1].aiDifficultyId = level.id
      safe.own[0].hex = 'A3'; safe.own[0].hits = 5; safe.enemy[0].hex = 'C1'
      expect(pickBestBattleMove(safe.state, safe.battle, AI_PROFILES.balanced, () => 0)).toEqual({ type: 'battleDonePhase' })
      const ranged = fixture('Plains', ['Hydra'], ['Colossus', 'Centaur'])
      ranged.state.players[1].aiDifficultyId = level.id
      ranged.own[0].hex = 'C3'; ranged.enemy[0].hex = 'C5'; ranged.enemy[0].hits = 8
      ranged.enemy[1].hex = 'E3'; ranged.enemy[1].hits = 2; ranged.battle.phase = 'Strike'; ranged.battle.turn = 4
      expect(pickBestBattleStrike(ranged.state, ranged.battle, AI_PROFILES.balanced, () => 0)).toMatchObject({ defenderId: ranged.enemy[0].id })
    }
  })
  it('never moves a one-HP Titan onto Drift, including with the smallest optional budget', () => {
    const { state, battle, own, enemy, land } = fixture('Tundra')
    own[0].hex = 'A3'; own[0].hits = 5; enemy[0].hex = 'C2'
    const before = structuredClone(state)
    expect(evaluateBattleHex(state, battle, own[0], 'C4', AI_PROFILES.balanced)).toBe(-Infinity)
    for (const options of [{}, { candidateLimit: 1, maxResponseNodes: 1 }]) {
      const command = pickBestBattleMove(state, battle, AI_PROFILES.balanced, () => 0, options)
      if (command.type === 'battleMove') {
        expect(legalBattleMovesFor(state, battle, own[0])).toContain(command.toHex)
        expect(hazardDamageToCreature(land.hexByLabel[command.toHex].terrain, state.variant.creatures.Titan)).toBe(0)
      }
      const moved = dispatch(state, command, () => 0)
      const next = command.type === 'battleMove' ? dispatch(moved, { type: 'battleDonePhase' }, () => 0) : moved
      expect(next.players[1].dead).toBe(false)
    }
    expect(state).toEqual(before)
  })
  it('escapes current lethal terrain rather than hiding a small-budget exhaustion behind Done', () => {
    const { state, battle, own, enemy, land } = fixture('Tundra')
    own[0].hex = 'C4'; own[0].hits = 5; enemy[0].hex = 'A1'
    const command = pickBestBattleMove(state, battle, AI_PROFILES.balanced, () => 0, { candidateLimit: 1, maxResponseNodes: 1 })
    expect(command.type).toBe('battleMove')
    if (command.type === 'battleMove') expect(hazardDamageToCreature(land.hexByLabel[command.toHex].terrain, state.variant.creatures.Titan)).toBe(0)
  })
  it('holds the unreachable defender Titan for a real turn-eight time win at every budget', () => {
    const { state, battle, own, enemy } = fixture()
    own[0].hex = 'A3'; own[0].hits = 5; enemy[0].hex = 'C1'
    for (const options of [{}, { candidateLimit: 1, maxResponseNodes: 1 }]) {
      const plan = planBattleManeuver(state, battle, AI_PROFILES.balanced, options)
      expect(plan.command).toEqual({ type: 'battleDonePhase' })
      expect(plan.work.safetyNodes).toBeGreaterThan(0)
      const held = dispatch(state, plan.command, () => 0)
      const won = dispatch(held, { type: 'battleDonePhase' }, () => 0)
      expect(won.players[1].dead).toBe(false)
      expect(won.log.some(line => line.includes('defender wins by time-loss'))).toBe(true)
    }
  })
  it('avoids delayed deterministic death on the second half pre-strike, even without an enemy strike', () => {
    const { state, battle, own, enemy, land } = fixture('Tundra')
    own[0].hex = 'C4'; own[0].hits = 4; enemy[0].hex = 'A1'
    const oneHalf = dispatch(state, { type: 'battleDonePhase' }, () => 0)
    expect(oneHalf.players[1].dead).toBe(false)
    const twoHalves = dispatch(oneHalf, { type: 'battleDonePhase' }, () => 0)
    expect(twoHalves.players[1].dead).toBe(true)
    const held = legalEnemyResponse(state, battle, { nodes: 0, limit: 2048 }, () => 1)
    expect(held.titanDoomed).toBe(true)
    for (const options of [{}, { candidateLimit: 1, maxResponseNodes: 1 }]) {
      const command = pickBestBattleMove(state, battle, AI_PROFILES.balanced, () => 0, options)
      expect(command.type).toBe('battleMove')
      if (command.type !== 'battleMove') return
      expect(hazardDamageToCreature(land.hexByLabel[command.toHex].terrain, state.variant.creatures.Titan)).toBe(0)
      const moved = dispatch(state, command, () => 0)
      const first = dispatch(moved, { type: 'battleDonePhase' }, () => 0)
      const second = dispatch(first, { type: 'battleDonePhase' }, () => 0)
      expect(second.players[1].dead).toBe(false)
    }
  })
  it('keeps a screen that prevents enemy movement onto the Titan before the clock expires', () => {
    const { state, battle, own, enemy } = fixture('Plains', ['Titan', 'Ogre'])
    own[0].hex = 'A3'; own[0].hits = 5; own[1].hex = 'B2'; enemy[0].hex = 'A1'
    const screened = legalEnemyResponse(state, battle, { nodes: 0, limit: 2048 }, () => 1)
    expect(screened.titanDamage).toBe(0)
    const copy = { ...battle, units: battle.units.map(unit => ({ ...unit })) }
    copy.units.find(unit => unit.id === own[1].id)!.hex = 'E3'
    expect(legalEnemyResponse(state, copy, { nodes: 0, limit: 2048 }, () => 1).titanDamage).toBeGreaterThan(0)
    expect(pickBestBattleMove(state, battle, AI_PROFILES.balanced, () => 0)).toEqual({ type: 'battleDonePhase' })
  })
  it('keeps next-pre-strike casualties blocking movement until the maneuver is finished', () => {
    const { state, battle, own, enemy, land } = fixture('Tundra', ['Titan', 'Ogre'])
    battle.turn = 5
    own[0].hex = 'F1'; own[1].hex = 'C4'; own[1].hits = 4
    enemy[0].hex = land.hexByLabel.C4.neighbors.find(label => label && land.hexByLabel[label].terrain === 'Plains')!
    expect(legalBattleMovesFor(state, battle, enemy[0])).toEqual([])
    const budget = { nodes: 0, limit: 2048 }
    expect(legalEnemyResponse(state, battle, budget, () => 1).complete).toBe(true)
    expect(budget.nodes).toBe(1) // Contact remains through Move; the Ogre dies at the following Strike.
  })
  it('still advances an attacker on open approach rather than treating a safe hold as an objective', () => {
    const { state, battle, own, enemy } = fixture('Plains', ['Cyclops'], ['Ogre'])
    own[0].hex = 'A1'; enemy[0].hex = 'F4'; battle.turn = 6
    const oldAttacker = battle.attackerLegionId
    battle.attackerLegionId = battle.defenderLegionId; battle.defenderLegionId = oldAttacker
    battle.activeHalf = 'attacker'
    expect(pickBestBattleMove(state, battle, AI_PROFILES.balanced, () => 0).type).toBe('battleMove')
  })
  it('uses actual enemy reach to choose a safe legal retreat rather than old C3', () => {
    const { state, battle, own, enemy } = fixture()
    own[0].hex = 'A3'; own[0].hits = 5; enemy[0].hex = 'A1'
    const command = pickBestBattleMove(state, battle, AI_PROFILES.balanced, () => 0)
    expect(command.type).toBe('battleMove')
    if (command.type !== 'battleMove') return
    expect(command.toHex).not.toBe('C3')
    expect(legalBattleMovesFor(state, battle, own[0])).toContain(command.toHex)
    const moved = dispatch(state, command, () => 0)
    const response = legalEnemyResponse(moved, moved.battle!, { nodes: 0, limit: 2048 }, () => 1)
    expect(response.complete).toBe(true); expect(response.titanDamage).toBe(0)
  })
  it('retains native immunity and prices deterministic damage for non-natives', () => {
    const { state, battle, own, enemy } = fixture('Tundra', ['Troll', 'Ogre'])
    own[0].hex = 'A3'; own[1].hex = 'A2'; enemy[0].hex = 'F1'
    const native = evaluateBattleHex(state, battle, own[0], 'C4', AI_PROFILES.balanced)
    const nonnative = evaluateBattleHex(state, battle, own[1], 'C4', AI_PROFILES.balanced)
    expect(Number.isFinite(native)).toBe(true)
    expect(native).toBeGreaterThan(nonnative)
    own[0].hits = getUnitPower(state, own[0]) - 1
    expect(Number.isFinite(evaluateBattleHex(state, battle, own[0], 'C4', AI_PROFILES.balanced))).toBe(true)
  })
  it('counts legal replies within explicit deterministic work bounds and never mutates input', () => {
    const { state, battle, own, enemy } = fixture('Plains', ['Titan', 'Ogre', 'Centaur'], ['Ogre', 'Lion'])
    battle.turn = 5
    own[0].hex = 'A3'; own[1].hex = 'B3'; own[2].hex = 'C5'; enemy[0].hex = 'D1'; enemy[1].hex = 'E2'
    const before = structuredClone(state)
    const started = performance.now()
    const small = planBattleManeuver(state, battle, AI_PROFILES.balanced, { candidateLimit: 1, maxResponseNodes: 1 })
    const normal = planBattleManeuver(state, battle, AI_PROFILES.balanced)
    const larger = planBattleManeuver(state, battle, AI_PROFILES.balanced, { candidateLimit: 16, maxResponseNodes: 4096 })
    console.log('Tactical bounded fixture', JSON.stringify({ small: small.work, normal: normal.work, larger: larger.work, elapsedMs: performance.now() - started }))
    expect(small.work.responseNodes).toBeLessThanOrEqual(1); expect(small.work.exhausted).toBe(true)
    expect(normal.work.responseNodes).toBeLessThanOrEqual(NORMAL_BATTLE_PLANNER.maxResponseNodes)
    expect(larger.work.candidatesEvaluated).toBeGreaterThan(normal.work.candidatesEvaluated)
    expect(planBattleManeuver(state, battle, AI_PROFILES.balanced)).toEqual(normal)
    expect(state).toEqual(before)
    expect(() => planBattleManeuver(state, battle, AI_PROFILES.balanced, { candidateLimit: 0 })).toThrow('Invalid')
  })
  it('bounds a real seven-versus-seven position without a permutation search', () => {
    const { state, battle, own, enemy } = fixture('Plains', ['Titan', 'Ogre', 'Ogre', 'Centaur', 'Centaur', 'Gargoyle', 'Gargoyle'], ['Titan', 'Ogre', 'Ogre', 'Centaur', 'Centaur', 'Gargoyle', 'Gargoyle'])
    battle.turn = 5
    const ownHexes = ['A3', 'B4', 'C5', 'D6', 'E5', 'F4', 'D5'], enemyHexes = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'D2']
    own.forEach((unit, index) => { unit.hex = ownHexes[index] })
    enemy.forEach((unit, index) => { unit.hex = enemyHexes[index] })
    const before = structuredClone(state), start = performance.now()
    const plan = planBattleManeuver(state, battle, AI_PROFILES.balanced)
    console.log('Tactical 7v7 normal', JSON.stringify({ ...plan.work, elapsedMs: performance.now() - start, command: plan.command }))
    expect(plan.work.responseNodes).toBeLessThanOrEqual(2048)
    expect(plan.work.safetyNodes).toBeLessThanOrEqual(8192)
    expect(plan.work.candidatesEvaluated).toBeLessThanOrEqual(9)
    if (plan.command.type === 'battleMove') expect(legalBattleMovesFor(state, battle, own.find(unit => unit.id === plan.command.unitId)!)).toContain(plan.command.toHex)
    expect(state).toEqual(before)
  })
})
