import { describe, expect, it } from 'vitest'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { dispatch } from '../../engine/GameEngine'
import { listMovePreview } from '../../engine/movement'
import { bestRecruitAt } from '../../engine/recruit'
import type { GameState } from '../../engine/types'
import { AI_PROFILES } from '../profiles'
import { pickBestMove, rankMoves } from '../evaluateMove'
import { combineWinningRolls, searchMasterMoves } from '../masterLookahead'
import { pickAiCommand } from '../simpleAi'
import { buildSpatialCache, candidateReachRollMasks } from '../boardSpatial'
import { estimateBattleOutcome } from '../battleEstimate'

function position(types = ['Lion', 'Lion'], origin = '100', roll = 2) {
  const state = twoPlayerGame(71)
  const own = state.legions[0]
  own.hexLabel = origin
  own.creatures = types.map((type) => ({ type, hits: 0 }))
  own.moved = false
  state.legions = [own]
  state.phase = 'Move'
  state.turnNumber = 3
  state.movementRoll = roll
  state.players[0].kind = 'ai'
  state.players[0].aiProfileId = 'balanced'
  state.players[0].aiDifficultyId = 'hard'
  return { state, own }
}
function nextRound(state: GameState, roll: number): GameState {
  return { ...state, phase: 'Move', activePlayerIndex: 0, turnNumber: state.turnNumber + 1,
    movementRoll: roll, selectedLegionId: null, legalHexes: [],
    players: state.players.map((p) => ({ ...p, hasTeleported: false })),
    legions: state.legions.map((l) => ({ ...l, moved: false, recruited: false, teleported: false,
      moveOriginHex: l.hexLabel, musteredThisTurn: null })) }
}
const profile = AI_PROFILES.balanced

describe('bounded Hard masterboard expectimax', () => {
  it('uses a genuine second future turn to choose the Griffon route over the one-turn bait', () => {
    const { state, own } = position()
    const before = JSON.stringify(state)
    const ranked = rankMoves(state, profile)
    const one = searchMasterMoves(state, ranked, profile, { depth: 1 })
    const start = performance.now()
    const two = searchMasterMoves(state, ranked, profile)
    const runtimeMs = performance.now() - start
    expect(one.best!.move.hex).toBe('142')
    expect(pickBestMove(state, profile, () => 0, false, new Set(), { masterLookahead: false })).toMatchObject({ type: 'move', toHex: '142' })
    expect(pickBestMove(state, profile, () => 0, false, new Set(), { masterLookahead: { depth: 1 } })).toMatchObject({ type: 'move', toHex: '142' })
    expect(pickAiCommand(state, () => 0)).toMatchObject({ type: 'move', toHex: '42' })
    expect(two.best!.move.hex).toBe('42')
    expect(two.best!.expectedArmyQuality).toBeGreaterThan(two.candidates.find((c) => c.move.hex === '142')!.expectedArmyQuality + 3)
    expect(two.diagnostics.reachedDepth).toBe(2)
    expect(two.diagnostics.nodes).toBeGreaterThan(one.diagnostics.nodes)
    expect(two.diagnostics.futureRecruitCounts.Griffon).toBeGreaterThan(0)
    expect(two.diagnostics.expandedFutureMusters).toBeGreaterThan(one.diagnostics.expandedFutureMusters)
    expect(two.diagnostics.exhausted).toBe(false)
    expect(searchMasterMoves(state, ranked, profile)).toEqual(two)
    expect(JSON.stringify(state)).toBe(before)
    console.log('HARD-MASTER-MEASURE', JSON.stringify({ runtimeMs, ...two.diagnostics }))

    // Execute the actual selected command, then two controlled future own rolls.
    // Opponents remain fixed, exactly as the bounded board model documents.
    let game = dispatch(state, pickAiCommand(state, () => 0.5)!)
    expect(game.legions[0].hexLabel).toBe('42')
    game = dispatch(game, { type: 'doneMove' })
    game = nextRound(game, 1)
    const firstFuture = pickAiCommand(game, () => 0.5)!
    expect(firstFuture).toMatchObject({ type: 'move', toHex: '1' })
    game = dispatch(dispatch(game, firstFuture), { type: 'doneMove' })
    const firstMuster = pickAiCommand(game, () => 0.5)!
    expect(firstMuster).toEqual({ type: 'recruit', legionId: own.id, creatureType: 'Lion' })
    game = dispatch(game, firstMuster)
    game = nextRound(game, 6)
    const secondFuture = pickAiCommand(game, () => 0.5)!
    expect(secondFuture).toMatchObject({ type: 'move', toHex: '7' })
    game = dispatch(dispatch(game, secondFuture), { type: 'doneMove' })
    const secondMuster = pickAiCommand(game, () => 0.5)!
    expect(secondMuster).toEqual({ type: 'recruit', legionId: own.id, creatureType: 'Griffon' })
    game = dispatch(game, secondMuster)
    expect(game.legions[0].creatures.map((c) => c.type)).toEqual(['Lion', 'Lion', 'Lion', 'Griffon'])
    expect(game.caretaker.Lion).toBe(state.caretaker.Lion - 1)
    expect(game.caretaker.Griffon).toBe(state.caretaker.Griffon - 1)

    // The one-turn destination cannot reach a Griffon on the same next rolls1,6.
    const bait = dispatch(state, { type: 'move', legionId: own.id, toHex: '142' })
    for (const [firstHex] of listMovePreview(bait, bait.legions[0], 1)) {
      const future = nextRound(bait, 1)
      const moved = dispatch(future, { type: 'move', legionId: own.id, toHex: firstHex })
      const recruit = bestRecruitAt(moved, moved.legions[0], firstHex)
      let grown = dispatch(moved, { type: 'doneMove' })
      if (recruit) grown = dispatch(grown, { type: 'recruit', legionId: own.id, creatureType: recruit })
      for (const [secondHex] of listMovePreview(grown, grown.legions[0], 6)) {
        expect(bestRecruitAt(grown, grown.legions[0], secondHex)).not.toBe('Griffon')
      }
    }
  })

  it.each(['easy', 'normal'] as const)('preserves %s commands and RNG consumption with search explicitly disabled or enabled', (level) => {
    for (const moved of [false, true]) {
      const { state, own } = position(['Centaur', 'Centaur'])
      state.players[0].aiDifficultyId = level
      if (moved) state.legions.push({ ...own, id: 'friend', hexLabel: '200', moved: true })
      const varied = { ...profile, strongMoveThreshold: 10000 }
      let oldCalls = 0
      let newCalls = 0
      const disabled = pickBestMove(state, varied, () => { oldCalls++; return 0.4 }, moved, new Set(), { masterLookahead: false })
      const enabled = pickBestMove(state, varied, () => { newCalls++; return 0.4 }, moved)
      expect(enabled).toEqual(disabled)
      expect(newCalls).toBe(oldCalls)
      if (!moved) expect(oldCalls).toBeGreaterThan(0)
    }
  })

  it('exhaustion discards partial positive values and falls back with identical ordinary RNG behavior', () => {
    const { state } = position()
    const ranked = rankMoves(state, profile)
    const search = searchMasterMoves(state, ranked, profile, { maxNodes: 1 })
    expect(search.diagnostics.exhausted).toBe(true)
    expect(search.best).toBeNull()
    expect(search.candidates).toEqual([])
    let baselineCalls = 0
    let limitedCalls = 0
    const baseline = pickBestMove(state, profile, () => { baselineCalls++; return 0.4 }, false, new Set(), { masterLookahead: false })
    const limited = pickBestMove(state, profile, () => { limitedCalls++; return 0.4 }, false, new Set(), { masterLookahead: { maxNodes: 1 } })
    expect(limited).toEqual(baseline)
    expect(limitedCalls).toBe(baselineCalls)
    expect(searchMasterMoves(state, ranked, profile, { maxGeneratedMoves: 1 }).best).toBeNull()
    const queries = searchMasterMoves(state, ranked, profile, { maxMovementQueries: 1 })
    expect(queries.diagnostics.exhausted).toBe(true)
    expect(queries.best).toBeNull()
    const rootOnly = searchMasterMoves(state, ranked.slice(0, 1), profile)
    const partial = searchMasterMoves(state, ranked, profile, { maxNodes: rootOnly.diagnostics.nodes + 1 })
    expect(partial.diagnostics.completeCandidates).toBe(1)
    expect(partial.diagnostics.exhausted).toBe(true)
    expect(partial.candidates).toHaveLength(1)
    expect(partial.control).toMatchObject({ expectedArmyQuality: rootOnly.candidates[0].expectedArmyQuality })
    expect(partial.diagnostics.controlComplete).toBe(true)
    expect(() => searchMasterMoves(state, ranked, profile, { maxNodes: 0 })).toThrow('budget')
  })

  it('keeps complete control and a better independent move when a later optional root exhausts, without publishing that partial root', () => {
    const { state, own } = position(), ranked = rankMoves(state, profile)
    expect(ranked.length).toBeGreaterThanOrEqual(3)
    const control = pickBestMove(state, profile, () => 0, false, new Set(), { masterLookahead: false })
    expect(control).toMatchObject({ type: 'move', toHex: ranked[0].hex })
    const two = searchMasterMoves(state, ranked.slice(0, 2), profile, { candidateLimit: 2, controlCommand: control as Extract<typeof control, { type: 'move' | 'doneMove' }> })
    expect(two.diagnostics.exhausted).toBe(false)
    expect(two.best!.expectedArmyQuality).toBeGreaterThan(two.control!.expectedArmyQuality + .5)
    const maxNodes = two.diagnostics.nodes + 1, before = JSON.stringify(state)
    const limited = searchMasterMoves(state, ranked, profile, { maxNodes, compareHold: true, controlCommand: control as Extract<typeof control, { type: 'move' | 'doneMove' }> })
    console.log('COMPLETE-ACTIONS-LATE-EXHAUSTION', JSON.stringify({ maxNodes, two: two.diagnostics, limited }))
    expect(limited.diagnostics).toMatchObject({ exhausted: true, controlComplete: true, completeCandidates: 2 })
    expect(limited.candidates.map(candidate => candidate.move)).toEqual(ranked.slice(0, 2))
    expect(limited.control).toEqual(two.control)
    expect(limited.best!.move).toBe(two.best!.move)
    expect(limited.best!.expectedArmyQuality).toBe(two.best!.expectedArmyQuality)
    expect(limited.candidates.some(candidate => candidate.move === ranked[2])).toBe(false)
    const actual = pickBestMove(state, profile, () => 0, false, new Set(), { masterLookahead: { maxNodes } })
    expect(actual).toMatchObject({ type: 'move', toHex: two.best!.move.hex })
    const moved = dispatch(state, actual)
    expect(moved.legions.find(legion => legion.id === own.id)!.hexLabel).toBe(two.best!.move.hex)
    expect(JSON.stringify(state)).toBe(before)
    expect(searchMasterMoves(state, ranked, profile, { maxNodes, compareHold: true, controlCommand: control as Extract<typeof control, { type: 'move' | 'doneMove' }> })).toEqual(limited)
  })

  it('publishes a completed Move before its optional root HOLD can exhaust and never publishes the incomplete HOLD', () => {
    const { state, own } = position()
    state.legions.push({ ...own, id: 'already-moved', hexLabel: '200', moved: true,
      creatures: own.creatures.map(creature => ({ ...creature })) })
    const ranked = rankMoves(state, profile), moveOnly = searchMasterMoves(state, ranked.slice(0, 1), profile)
    expect(moveOnly.diagnostics.exhausted).toBe(false)
    const limited = searchMasterMoves(state, ranked.slice(0, 1), profile, { maxNodes: moveOnly.diagnostics.nodes, compareHold: true })
    expect(limited.diagnostics).toMatchObject({ exhausted: true, controlComplete: true, completeCandidates: 1 })
    expect(limited.candidates[0].expectedArmyQuality).toBe(moveOnly.candidates[0].expectedArmyQuality)
    expect(limited.candidates[0].holdArmyQuality).toBeNull(); expect(limited.candidates[0].holdCommand).toBeNull()
    expect(limited.bestHold).toBeNull(); expect(limited.completedHolds).toEqual([])
    expect(limited.control).toEqual(moveOnly.control)
  })

  it('evaluates exact legal Done as its own completed control before optional moves and retains it when that control is incomplete', () => {
    const { state, own } = position(['Centaur', 'Centaur'])
    state.legions.push({ ...own, id: 'already-moved', hexLabel: '200', moved: true,
      creatures: own.creatures.map(creature => ({ ...creature })) })
    const varied = { ...profile, strongMoveThreshold: 10000 }, control = pickBestMove(state, varied, () => .99, true, new Set(), { masterLookahead: false })
    expect(control).toEqual({ type: 'doneMove' })
    const complete = searchMasterMoves(state, rankMoves(state, varied), varied, { controlCommand: { type: 'doneMove' }, compareHold: true })
    expect(complete.control?.command).toEqual({ type: 'doneMove' }); expect(complete.diagnostics.controlComplete).toBe(true)
    const actual = dispatch(state, { type: 'doneMove' })
    expect(actual.phase).toBe('Muster')
    expect(complete.control!.currentMusters.every(muster => muster.startsWith('already-moved:'))).toBe(true)
    const partial = searchMasterMoves(state, rankMoves(state, varied), varied, { controlCommand: { type: 'doneMove' }, compareHold: true, maxNodes: 1 })
    expect(partial.control).toBeNull(); expect(partial.candidates).toEqual([]); expect(partial.completedHolds).toEqual([])
    expect(partial.diagnostics).toMatchObject({ exhausted: true, controlComplete: false })
    let oldCalls = 0, newCalls = 0
    const baseline = pickBestMove(state, varied, () => { oldCalls++; return .99 }, true, new Set(), { masterLookahead: false })
    const limited = pickBestMove(state, varied, () => { newCalls++; return .99 }, true, new Set(), { masterLookahead: { maxNodes: 1 } })
    expect(limited).toEqual(baseline); expect(newCalls).toBe(oldCalls)
  })

  it('keeps the ordinary control when deeper work finds no genuine improvement, including Done', () => {
    const { state, own } = position()
    for (const type of Object.keys(state.caretaker)) state.caretaker[type] = 0
    for (const moved of [false, true]) {
      if (moved) state.legions.push({ ...own, id: 'already-moved', hexLabel: '200', moved: true })
      const disabled = pickBestMove(state, profile, () => 0.99, moved, new Set(), { masterLookahead: false })
      const enabled = pickBestMove(state, profile, () => 0.99, moved)
      expect(enabled).toEqual(disabled)
      if (moved) expect(enabled).toEqual({ type: 'doneMove' })
    }
  })

  it('prices incoming enemy survival before crediting grown armies, and observes changed occupancy', () => {
    const { state, own } = position(['Centaur', 'Centaur'], '1', 1)
    const enemy = { ...own, id: 'hunter', playerId: state.players[1].id, hexLabel: '1000',
      creatures: ['Hydra', 'Hydra', 'Hydra'].map((type) => ({ type, hits: 0 })) }
    state.legions.push(enemy)
    const before = JSON.stringify(state)
    const start = performance.now()
    const hot = searchMasterMoves(state, rankMoves(state, profile), profile)
    console.log('HARD-MASTER-THREAT-MEASURE', JSON.stringify({ runtimeMs: performance.now() - start, ...hot.diagnostics }))
    expect(hot.best).not.toBeNull()
    expect(hot.best!.utility).toBeLessThan(0)
    expect(JSON.stringify(state)).toBe(before)
    enemy.hexLabel = '2000'
    const cold = searchMasterMoves(state, rankMoves(state, profile), profile)
    expect(cold.best!.expectedArmyQuality).toBeGreaterThan(hot.best!.expectedArmyQuality)
  })

  it('unions disjoint same-player roll events, overlaps once, and combines independent players', () => {
    expect(combineWinningRolls([{ playerId: 'a', mask: 1 }, { playerId: 'a', mask: 2 }])).toBeCloseTo(4 / 6)
    expect(combineWinningRolls([{ playerId: 'a', mask: 3 }, { playerId: 'a', mask: 2 }])).toBeCloseTo(4 / 6)
    expect(combineWinningRolls([{ playerId: 'a', mask: 1 }, { playerId: 'b', mask: 1 }])).toBeCloseTo((5 / 6) ** 2)
    expect(() => combineWinningRolls([{ playerId: 'a', mask: 64 }])).toThrow('mask')
  })

  it('keeps real occupied-target masks separate from caretaker-sensitive combat outcomes', () => {
    const { state, own } = position(['Ogre', 'Ogre'], '100', 1)
    const enemy = { ...own, id: 'hunter', playerId: state.players[1].id, hexLabel: '1',
      creatures: ['Centaur', 'Centaur', 'Centaur'].map((type) => ({ type, hits: 0 })) }
    state.legions.push(enemy)
    let reachable = false
    for (const hex of Object.keys(state.variant.board.hexByLabel)) {
      if (hex === own.hexLabel) continue
      enemy.hexLabel = hex
      if ([1, 2, 3, 4, 5, 6].some((roll) => listMovePreview(state, enemy, roll).has('100'))) { reachable = true; break }
    }
    expect(reachable).toBe(true)
    const cache = buildSpatialCache(state)
    const mask = candidateReachRollMasks(state, enemy, cache).get('100')!
    expect(mask).toBeGreaterThan(0)
    // Stop-on-enemy makes current Default masks suffixes; no invented disjoint fixture.
    expect([63, 62, 60, 56, 48, 32]).toContain(mask)
    for (const type of Object.keys(state.caretaker)) state.caretaker[type] = 0
    expect(estimateBattleOutcome(state, enemy, own, '100').ratio).toBeGreaterThanOrEqual(1.15)
    const exposed = combineWinningRolls([{ playerId: enemy.playerId, mask }])
    state.caretaker.Gargoyle = 1
    expect(estimateBattleOutcome(state, enemy, own, '100').ratio).toBeLessThan(1.15)
    expect(candidateReachRollMasks(state, enemy, cache).get('100')).toBe(mask)
    expect(combineWinningRolls([])).toBeGreaterThan(exposed)
  })

  it('shares the last Hydra among actual current muster stacks and never reuses consumed stock in future branches', () => {
    const { state, own } = position(['Wyvern', 'Wyvern'], '1', 1)
    const swamps = Object.values(state.variant.board.hexByLabel).filter((h) => h.terrain === 'Swamp')
    let target = ''
    outer: for (const hex of Object.keys(state.variant.board.hexByLabel)) {
      own.hexLabel = hex
      for (let roll = 1; roll <= 6; roll++) {
        const swamp = [...listMovePreview(state, own, roll).keys()].find((h) => swamps.some((s) => s.label === h))
        if (swamp) { target = swamp; state.movementRoll = roll; break outer }
      }
    }
    expect(target).not.toBe('')
    const friend = { ...own, id: 'friend', hexLabel: swamps.find((h) => h.label !== target)!.label,
      moved: true, recruited: false, creatures: own.creatures.map((c) => ({ ...c })) }
    state.legions = [friend, own]
    state.caretaker.Hydra = 1
    const move = rankMoves(state, profile).find((m) => m.legionId === own.id && m.hex === target)!
    const before = JSON.stringify(state)
    const result = searchMasterMoves(state, [move], profile)
    expect(result.best!.currentMusters.filter((m) => m.endsWith(':Hydra'))).toEqual(['friend:Hydra'])
    expect(result.diagnostics.futureRecruitCounts.Hydra ?? 0).toBe(0)
    expect(JSON.stringify(state)).toBe(before)
    state.caretaker.Hydra = 2
    expect(searchMasterMoves(state, [move], profile).best!.currentMusters.filter((m) => m.endsWith(':Hydra'))).toHaveLength(2)
  })
})
