import { describe, expect, it, vi } from 'vitest'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { dispatch } from '../../engine/GameEngine'
import { battleLand, legalBattleMovesFor, legalStrikesFor, startBattle } from '../../engine/battle'
import { AI_PROFILES } from '../profiles'
import { pickBestBattleMove, planBattleManeuver } from '../evaluateBattle'
import { formationBeam } from '../battleFormation'
import { HARD_WHOLE_MANEUVER } from '../battleManeuver'
import { HARD_BATTLE_ROLLOUT, runBattleTrial } from '../battleRollout'

function fixture(ownTypes = ['Hydra', 'Ogre', 'Ogre', 'Ogre'], enemyTypes = ['Titan']) {
  const state = twoPlayerGame(71), own = state.legions[0], enemy = state.legions[1]
  own.hexLabel = enemy.hexLabel = Object.values(state.variant.board.hexByLabel).find(hex => hex.terrain === 'Plains')!.label
  own.creatures = ownTypes.map(type => ({ type, hits: 0 })); enemy.creatures = enemyTypes.map(type => ({ type, hits: 0 }))
  state.phase = 'Fight'; state.players[0].kind = 'ai'; state.players[0].aiDifficultyId = 'hard'
  const battle = startBattle(state, own, enemy, () => 0)
  state.battle = battle; battle.phase = 'Move'; battle.turn = 7; battle.activeHalf = 'attacker'; battle.activePlayerId = own.playerId
  battle.firstManeuverDone = { attacker: true, defender: true }
  state.legions.push({ ...structuredClone(own), id: 'titan-reserve', hexLabel: '100', creatures: [{ type: 'Titan', hits: 0 }, { type: 'Angel', hits: 0 }] })
  return { state, battle, ours: battle.units.filter(unit => unit.playerId === own.playerId),
    theirs: battle.units.filter(unit => unit.playerId === enemy.playerId), land: battleLand(state, battle) }
}
function freeze(value: unknown, seen = new Set<unknown>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value); Object.values(value).forEach(child => freeze(child, seen)); Object.freeze(value)
}
function blocked() {
  const result = fixture(), { land, ours, theirs } = result
  ours[0].hex = 'A1'
  const doors = land.hexByLabel.A1.neighbors.filter((hex): hex is string => hex !== null)
  expect(doors).toHaveLength(3)
  doors.forEach((hex, index) => { ours[index + 1].hex = hex })
  theirs[0].hex = 'C3'; theirs[0].hits = 2 // Four-HP Titan: combine actual attack dice before turn-eight loss.
  return result
}
describe('Hard whole non-entry maneuver planning', () => {
  it('inspects a real vacate-before-contact combination through completed combat outcomes', () => {
    const { state, battle, ours } = blocked()
    expect(legalBattleMovesFor(state, battle, ours[0])).toEqual([])
    expect(legalStrikesFor(state, battle, ours[0])).toEqual([])
    const normal = planBattleManeuver({ ...state, players: state.players.map(player => ({ ...player, aiDifficultyId: 'normal' as const })) }, battle, AI_PROFILES.balanced)
    const previous = planBattleManeuver(state, battle, AI_PROFILES.balanced, { maneuver: false })
    const start = performance.now(), result = planBattleManeuver(state, battle, AI_PROFILES.balanced)
    console.log('WHOLE-MANEUVER-BLOCKED', JSON.stringify({ normal: normal.command, previous: previous.command, result, elapsedMs: performance.now() - start }))
    expect(result.maneuver).toBeDefined()
    expect(result.maneuver!.work).toMatchObject({ usedPlan: true, changedDecision: true, exhausted: false })
    expect(result.command).not.toEqual(normal.command)
    const execute = (plan: NonNullable<typeof result.maneuver>['plan']) => {
      let next = state
      for (const command of plan) {
        expect(legalBattleMovesFor(next, next.battle!, next.battle!.units.find(unit => unit.id === command.unitId)!)).toContain(command.toHex)
        next = dispatch(next, command, () => 0)
      }
      return next
    }
    const improved = execute(result.maneuver!.plan), control = execute(result.maneuver!.baselinePlan)
    const hydraStep = result.maneuver!.plan.findIndex(command => command.unitId === ours[0].id)
    expect(hydraStep).toBeGreaterThan(0) // An actual blocker vacates before Hydra can move.
    expect(legalStrikesFor(improved, improved.battle!, improved.battle!.units.find(unit => unit.id === ours[0].id)!)).toContain('bu-4')
    expect(legalStrikesFor(control, control.battle!, control.battle!.units.find(unit => unit.id === ours[0].id)!)).not.toContain('bu-4')
    const paired = [11, 271, 1307, 4001, 7003, 11003, 21001, 51001].map(seed => {
      const a = runBattleTrial(control, control.battle!, { type: 'battleDonePhase' }, AI_PROFILES.balanced, seed, HARD_BATTLE_ROLLOUT)
      const b = runBattleTrial(improved, improved.battle!, { type: 'battleDonePhase' }, AI_PROFILES.balanced, seed, HARD_BATTLE_ROLLOUT)
      expect(a.complete && b.complete && a.battle.done && b.battle.done).toBe(true)
      return { seed, controlUtility: a.utility, improvedUtility: b.utility,
        controlWin: a.battle.winnerPlayerId === state.players[0].id,
        improvedWin: b.battle.winnerPlayerId === state.players[0].id }
    })
    console.log('WHOLE-MANEUVER-BLOCKED-ENGINE-PAIRS', JSON.stringify(paired))
    expect(paired.reduce((sum, trial) => sum + trial.improvedUtility - trial.controlUtility, 0)).toBeGreaterThan(0)
    expect(paired.filter(trial => trial.improvedWin).length).toBeGreaterThan(paired.filter(trial => trial.controlWin).length)
    expect(result.rollout).toMatchObject({ creditedRounds: 8, usedRollout: true })
    let live = state
    const livePlan = []
    for (let index = 0; index <= ours.length; index++) {
      const command = pickBestBattleMove(live, live.battle!, AI_PROFILES.balanced, () => 0)
      if (command.type === 'battleDonePhase') break
      expect(command.type).toBe('battleMove')
      livePlan.push(command)
      live = dispatch(live, command, () => 0)
    }
    expect(livePlan[0]).toEqual(result.command)
    expect(livePlan.length).toBeLessThanOrEqual(ours.length)
    expect(legalStrikesFor(live, live.battle!, live.battle!.units.find(unit => unit.id === ours[0].id)!)).toContain('bu-4')
  })
  it('keeps different undecided-unit continuations for the same held position', () => {
    const { state, battle, ours, theirs } = fixture(['Ogre', 'Ogre'], ['Ogre'])
    battle.turn = 5; ours[0].hex = 'C3'; ours[1].hex = 'C5'; theirs[0].hex = 'C4'
    expect(ours.every(unit => legalBattleMovesFor(state, battle, unit).length === 0)).toBe(true)
    const work = { nodes: 0, legalQueries: 0, destinationEvaluations: 0, reachedDepth: 0, exhausted: false }
    const plans = formationBeam(state, battle, ours.map(unit => unit.id), { beamWidth: 8, maxNodes: 20 },
      { allowHold: true, placementScore: () => 0, formationScore: () => 0 }, work)
    expect(work.nodes).toBe(4); expect(work.legalQueries).toBe(4)
    expect(plans).toHaveLength(1); expect(plans[0].held.sort()).toEqual(ours.map(unit => unit.id).sort())
    expect(plans[0].plan).toEqual([])
    expect(plans[0].battle.units.every(unit => !unit.moved)).toBe(true)
    expect(planBattleManeuver(state, battle, AI_PROFILES.balanced).command).toEqual({ type: 'battleDonePhase' })
  })
  it('retains actual Normal under tiny incomplete work and validates bounds', () => {
    const { state, battle } = blocked(), normalState = { ...state, players: state.players.map(player => ({ ...player, aiDifficultyId: 'normal' as const })) }
    const normal = planBattleManeuver(normalState, battle, AI_PROFILES.balanced)
    for (const maneuver of [{ maxNodes: 1 }, { maxDestinationEvaluations: 1 }]) {
      const result = planBattleManeuver(state, battle, AI_PROFILES.balanced, { maneuver })
      expect(result.command).toEqual(normal.command)
      expect(result.maneuver?.work).toMatchObject({ exhausted: true, usedPlan: false })
      if (maneuver.maxDestinationEvaluations) expect(result.maneuver!.work.destinationEvaluations).toBeLessThanOrEqual(maneuver.maxDestinationEvaluations)
    }
    // Final attacking turn needs no future-maneuver response nodes; use a real
    // earlier maneuver so this cap actually becomes incomplete.
    battle.turn = 5
    const earlierNormal = planBattleManeuver(normalState, battle, AI_PROFILES.balanced)
    const responseLimited = planBattleManeuver(state, battle, AI_PROFILES.balanced, { maneuver: { maxResponseNodes: 1 } })
    expect(responseLimited.command).toEqual(earlierNormal.command)
    expect(responseLimited.maneuver?.work).toMatchObject({ exhausted: true, usedPlan: false })
    battle.turn = 7
    const tiny = planBattleManeuver(state, battle, AI_PROFILES.balanced, { rollout: { maxTransitionNodes: 1 } })
    expect(tiny.command).toEqual(normal.command); expect(tiny.rollout?.usedRollout).toBe(false)
    expect(() => planBattleManeuver(state, battle, AI_PROFILES.balanced, { maneuver: { maxNodes: 0 } })).toThrow('Invalid whole maneuver')
  })
  it('fixes already-moved units and preserves Normal/Easy commands and their real RNG', () => {
    const { state, battle, ours, theirs } = fixture(['Cyclops', 'Ogre'], ['Ogre'])
    battle.turn = 5; ours[0].hex = 'A1'; ours[0].moved = true; ours[1].hex = 'A2'; theirs[0].hex = 'F4'
    const before = JSON.stringify(state), result = planBattleManeuver(state, battle, AI_PROFILES.balanced)
    expect(result.maneuver?.plan.every(command => command.unitId !== ours[0].id)).toBe(true)
    expect(result.maneuver?.baselinePlan.every(command => command.unitId !== ours[0].id)).toBe(true)
    expect(JSON.stringify(state)).toBe(before)
    for (const level of ['normal', 'easy'] as const) {
      state.players[0].aiDifficultyId = level
      const first = vi.fn(() => 0), second = vi.fn(() => 0)
      expect(pickBestBattleMove(state, battle, AI_PROFILES.balanced, first)).toEqual(pickBestBattleMove(state, battle, AI_PROFILES.balanced, second, { maneuver: false }))
      expect(first.mock.calls).toEqual(second.mock.calls); expect(first).not.toHaveBeenCalled()
    }
  })
  it('measures completed whole-side work on a real seven-versus-seven position with frozen inputs and no world RNG', () => {
    const types = ['Cyclops', 'Ogre', 'Ogre', 'Centaur', 'Centaur', 'Gargoyle', 'Gargoyle']
    const { state, battle, ours, theirs } = fixture(types, types)
    battle.turn = 5
    const a = ['A3', 'B4', 'C5', 'D6', 'E5', 'F4', 'D5'], d = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'D2']
    ours.forEach((unit, index) => { unit.hex = a[index] }); theirs.forEach((unit, index) => { unit.hex = d[index] })
    const before = JSON.stringify(state); freeze(state)
    const now = vi.spyOn(Date, 'now'), random = vi.spyOn(Math, 'random'), start = performance.now()
    let result
    try {
      result = planBattleManeuver(state, battle, AI_PROFILES.balanced)
      expect(now).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled()
    } finally { now.mockRestore(); random.mockRestore() }
    console.log('WHOLE-MANEUVER-7V7', JSON.stringify({ result, elapsedMs: performance.now() - start }))
    expect(JSON.stringify(state)).toBe(before)
    expect(result.maneuver?.work.nodes).toBeLessThanOrEqual(HARD_WHOLE_MANEUVER.maxNodes)
    expect(result.maneuver?.work.usedPlan).toBe(true)
    expect(result.rollout).toMatchObject({ creditedRounds: 8, usedRollout: true })
    expect(planBattleManeuver(state, battle, AI_PROFILES.balanced)).toEqual(result)
  })
})
