import { describe, expect, it } from 'vitest'
import { canEndMovePhase, dispatch, getLegalRecruits } from '../../engine/GameEngine'
import { listAllMoves } from '../../engine/movement'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import type { Legion } from '../../engine/types'
import { AI_PROFILES } from '../profiles'
import { searchMasterMoves } from '../masterLookahead'
import { pickBestMove, rankMoves } from '../evaluateMove'
import { pickAiCommand } from '../simpleAi'

const profile = AI_PROFILES.balanced
function trap(origin = '3', roll = 1) {
  const state = twoPlayerGame(71)
  state.phase = 'Move'; state.turnNumber = 3; state.movementRoll = roll
  state.players[0].kind = 'ai'; state.players[0].aiProfileId = 'balanced'; state.players[0].aiDifficultyId = 'hard'
  const own = state.legions[0], enemy = state.legions[1]
  own.hexLabel = origin; own.moveOriginHex = origin; own.moved = false
  own.creatures = ['Centaur', 'Centaur'].map((type) => ({ type, hits: 0 }))
  enemy.hexLabel = '103'; enemy.creatures = Array.from({ length: 7 }, () => ({ type: 'Hydra', hits: 0 }))
  return { state, own, enemy }
}
function helper(own: Legion, hexLabel = '4000'): Legion {
  return { ...own, id: 'companion', markerId: 'Rd02', hexLabel, moveOriginHex: hexLabel,
    creatures: ['Centaur', 'Centaur'].map((type) => ({ type, hits: 0 })), moved: false }
}

describe('legal masterboard HOLD alternatives', () => {
  it('models another legion actually moving instead of killing a mover with combat-only next exits', () => {
    const { state, own, enemy } = trap()
    own.creatures = ['Ogre', 'Ogre'].map((type) => ({ type, hits: 0 }))
    enemy.creatures = ['Centaur', 'Centaur'].map((type) => ({ type, hits: 0 }))
    const ally = helper(own)
    state.legions.push(ally)
    const before = JSON.stringify(state)
    const candidate = rankMoves(state, profile).find((m) => m.legionId === own.id && m.hex === '4')!
    expect(candidate).toBeTruthy()
    const landed = dispatch(state, { type: 'move', legionId: own.id, toHex: '4' })
    for (let roll = 1; roll <= 6; roll++) {
      const future = { ...landed, phase: 'Move' as const, movementRoll: roll,
        legions: landed.legions.map((l) => ({ ...l, moved: false, teleported: false, recruited: false })),
        players: landed.players.map((p) => ({ ...p, hasTeleported: false })) }
      expect([...listAllMoves(future, future.legions.find((l) => l.id === own.id)!, roll).keys()]).toEqual(['103'])
      const leave = [...listAllMoves(future, future.legions.find((l) => l.id === ally.id)!, roll).keys()]
        .find((hex) => !future.legions.some((l) => l.playerId !== own.playerId && l.hexLabel === hex))!
      expect(leave).toBeTruthy()
      const actual = dispatch(future, { type: 'move', legionId: ally.id, toHex: leave })
      expect(canEndMovePhase(actual)).toBe(true)
      const completed = dispatch(actual, { type: 'doneMove' })
      expect(completed.phase).toBe('Muster')
      expect(getLegalRecruits(completed, own.id)).toEqual([])
    }
    const projected = searchMasterMoves(state, [candidate], profile)
    expect(projected.diagnostics.exhausted).toBe(false)
    expect(projected.diagnostics.futureHolds).toBeGreaterThan(0)
    expect(projected.diagnostics.companionHoldMoves).toBeGreaterThan(6)
    expect(projected.diagnostics.futureMustersByLegion[own.id] ?? 0).toBe(0)
    const single = { ...state, legions: state.legions.filter((l) => l.id !== ally.id) }
    const forced = searchMasterMoves(single, [candidate], profile)
    expect(projected.best!.expectedArmyQuality).toBeGreaterThan(forced.best!.expectedArmyQuality + 24)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('certifies a legal companion command at root and never gives the stationary stack a muster', () => {
    const { state, own, enemy } = trap('4', 3)
    own.creatures = ['Ogre', 'Ogre'].map((type) => ({ type, hits: 0 }))
    enemy.creatures = ['Centaur', 'Centaur'].map((type) => ({ type, hits: 0 }))
    const ally = helper(own)
    ally.creatures = ['Cyclops', 'Cyclops', 'Cyclops'].map((type) => ({ type, hits: 0 }))
    state.legions.push(ally)
    expect(canEndMovePhase(state)).toBe(false)
    const result = searchMasterMoves(state, rankMoves(state, profile), profile, { compareHold: true, holdLegionId: own.id })
    console.log('MASTER-HOLD-CERTIFICATE', JSON.stringify({ bestHold: result.bestHold, diagnostics: result.diagnostics }))
    expect(result.bestHold?.command).toMatchObject({ type: 'move', legionId: ally.id })
    expect(result.bestHold!.currentMusters.some((m) => m.startsWith(`${own.id}:`))).toBe(false)
    const actual = dispatch(state, result.bestHold!.command)
    expect(canEndMovePhase(actual)).toBe(true)
    const complete = dispatch(actual, { type: 'doneMove' })
    expect(complete.legions.find((l) => l.id === own.id)!.hexLabel).toBe('4')
    expect(getLegalRecruits(complete, own.id)).toEqual([])
    expect(result.bestHold!.currentMusters).toContain('companion:Gorgon')
    const recruited = dispatch(complete, { type: 'recruit', legionId: ally.id, creatureType: 'Gorgon' })
    expect(recruited.caretaker.Gorgon).toBe(state.caretaker.Gorgon - 1)
    expect(recruited.legions.find((l) => l.id === own.id)!.creatures).toHaveLength(2)
  })

  it('can end movement legally when the ordinary move is worse than holding, at the actual root', () => {
    const { state, own, enemy } = trap('100', 3)
    own.creatures = ['Lion', 'Ogre'].map((type) => ({ type, hits: 0 }))
    enemy.hexLabel = '37'
    enemy.creatures = ['Hydra', 'Hydra', 'Hydra'].map((type) => ({ type, hits: 0 }))
    const ally = helper(own, '2')
    ally.creatures = ['Titan', 'Cyclops', 'Cyclops', 'Cyclops', 'Ogre'].map((type) => ({ type, hits: 0 }))
    state.legions.push(ally)
    const moved = dispatch(state, { type: 'move', legionId: ally.id, toHex: '5' })
    expect(moved.legions.find((l) => l.id === ally.id)!.moved).toBe(true)
    const control = pickBestMove(moved, profile, () => 0.5, true, new Set(), { masterLookahead: false })
    expect(control).toMatchObject({ type: 'move', legionId: own.id, toHex: '1' })
    const actual = pickAiCommand(moved, () => 0.5)!
    const start = performance.now()
    const diagnostic = searchMasterMoves(moved, rankMoves(moved, profile), profile, { compareHold: true, holdLegionId: own.id, stopAfterHoldImprovement: true })
    console.log('ROOT-HOLD-VERSUS-MOVE', JSON.stringify({ runtimeMs: performance.now() - start, actual, best: diagnostic.best?.expectedArmyQuality, hold: diagnostic.bestHold, diagnostics: diagnostic.diagnostics }))
    expect(diagnostic.diagnostics.exhausted).toBe(false)
    expect(diagnostic.diagnostics.certifiedHoldEarlyExit).toBe(true)
    expect(diagnostic.bestHold!.expectedArmyQuality).toBeGreaterThan(diagnostic.candidates[0].expectedArmyQuality + 0.5)
    expect(actual).toEqual({ type: 'doneMove' })
    expect(canEndMovePhase(moved)).toBe(true)
    const complete = dispatch(moved, actual)
    expect(complete.phase).not.toBe('Move')
    expect(complete.legions.find((l) => l.id === own.id)!.hexLabel).toBe('100')
    expect(getLegalRecruits(complete, own.id)).toEqual([])
    expect(pickAiCommand(complete, () => 0.5)).toEqual({ type: 'recruit', legionId: ally.id, creatureType: 'Behemoth' })
    const mustered = dispatch(complete, pickAiCommand(complete, () => 0.5)!)
    expect(mustered.caretaker.Behemoth).toBe(moved.caretaker.Behemoth - 1)
    for (const level of ['normal', 'easy'] as const) {
      const same = { ...moved, players: moved.players.map((p, index) => index === 0 ? { ...p, aiDifficultyId: level } : p) }
      let disabledCalls = 0, enabledCalls = 0
      const disabled = pickBestMove(same, profile, () => { disabledCalls++; return 0.5 }, true, new Set(), { masterLookahead: false })
      const enabled = pickBestMove(same, profile, () => { enabledCalls++; return 0.5 }, true)
      expect(enabled).toEqual(disabled)
      expect(enabledCalls).toBe(disabledCalls)
    }
  })

  it('prices a companion vacating an enemy blocker under the resulting occupancy', () => {
    const { state, own, enemy } = trap('2', 2)
    enemy.hexLabel = '1000'
    enemy.creatures = ['Hydra', 'Hydra', 'Hydra'].map((type) => ({ type, hits: 0 }))
    const ally = helper(own, '1')
    state.legions.push(ally)
    for (const type of Object.keys(state.caretaker)) state.caretaker[type] = 0
    const result = searchMasterMoves(state, rankMoves(state, profile), profile, { depth: 1, compareHold: true, holdLegionId: own.id, continuationLegionId: own.id })
    const heldOwn = result.candidates.find((c) => c.move.legionId === own.id)!
    expect(heldOwn.holdCommand).toMatchObject({ type: 'move', legionId: ally.id, toHex: '3' })
    expect(heldOwn.holdArmyQuality).toBeLessThan(40)
    const otherFocus = searchMasterMoves(state, rankMoves(state, profile), profile, { depth: 1, compareHold: true,
      holdLegionId: own.id, continuationLegionId: ally.id })
    expect(otherFocus.diagnostics.incomplete).toBe(true)
    expect(otherFocus.bestHold).toBeNull()
    const moved = dispatch(state, heldOwn.holdCommand!)
    expect(canEndMovePhase(moved)).toBe(true)
    expect([1, 2, 3, 4, 5, 6].filter((roll) =>
      listAllMoves({ ...moved, legions: moved.legions.map((l) => ({ ...l, moved: false })) }, enemy, roll).has('2'))).toHaveLength(5)
  })

  it('rejects free HOLD for a lone stack or mandatory unseparated split, even after another legion moved', () => {
    const { state, own } = trap('4', 3)
    expect(canEndMovePhase(state)).toBe(false)
    expect(dispatch(state, { type: 'doneMove' }).phase).toBe('Move')
    const alone = searchMasterMoves(state, rankMoves(state, profile), profile, { compareHold: true, holdLegionId: own.id })
    expect(alone.bestHold).toBeNull()
    expect(pickAiCommand(state, () => 0.5)).toMatchObject({ type: 'move', legionId: own.id, toHex: '103' })
    const sibling = helper(own, '4')
    const moved = { ...helper(own, '4000'), id: 'already-moved', moved: true }
    state.legions.push(sibling, moved)
    expect(canEndMovePhase(state)).toBe(false)
    expect(dispatch(state, { type: 'doneMove' }).phase).toBe('Move')
    const split = searchMasterMoves(state, rankMoves(state, profile), profile, { compareHold: true, holdLegionId: own.id })
    expect(split.bestHold).toBeNull()
    expect(pickBestMove(state, profile, () => 0.5, true).type).toBe('move')
  })

  it('falls back instead of inventing forced death when only unmodeled companion fights could permit HOLD', () => {
    const { state, own, enemy } = trap()
    enemy.creatures = ['Centaur', 'Centaur'].map((type) => ({ type, hits: 0 }))
    const ally = helper(own, '11')
    const otherEnemy = { ...enemy, id: 'second-enemy', hexLabel: '110', creatures: enemy.creatures.map((c) => ({ ...c })) }
    state.legions.push(ally, otherEnemy)
    const move = rankMoves(state, profile).find((m) => m.legionId === own.id && m.hex === '4')!
    const result = searchMasterMoves(state, [move], profile)
    expect(result.diagnostics.incomplete).toBe(true)
    expect(result.diagnostics.exhausted).toBe(false)
    expect(result.best).toBeNull()
    expect(result.bestHold).toBeNull()
    expect(result.candidates).toEqual([])
    const landed = dispatch(state, { type: 'move', legionId: own.id, toHex: '4' })
    const next = { ...landed, phase: 'Move' as const, movementRoll: 1,
      legions: landed.legions.map((l) => ({ ...l, moved: false, recruited: false })) }
    expect(canEndMovePhase(next)).toBe(false)
    expect([...listAllMoves(next, next.legions.find((l) => l.id === own.id)!, 1).keys()]).toEqual(['103'])
    expect([...listAllMoves(next, next.legions.find((l) => l.id === ally.id)!, 1).keys()]).toEqual(['110'])
    const realAlternative = dispatch(next, { type: 'move', legionId: ally.id, toHex: '110' })
    expect(canEndMovePhase(realAlternative)).toBe(true)
    expect(realAlternative.legions.find((l) => l.id === own.id)!.hexLabel).toBe('4')
    expect(pickBestMove(state, profile, () => 0.5, false)).toEqual(
      pickBestMove(state, profile, () => 0.5, false, new Set(), { masterLookahead: false }))
  })

  it('rejects companion certificates that leave blocked stacks for actual Done to recombine', () => {
    const { state, own } = trap('4', 1)
    state.legions = [own]
    own.creatures = ['Ogre', 'Ogre'].map((type) => ({ type, hits: 0 }))
    const sibling = { ...helper(own, '4'), id: 'blocked-sibling', creatures: own.creatures.map((c) => ({ ...c })) }
    const blocker = { ...helper(own, '103'), id: 'outlet-blocker' }
    const free = { ...helper(own), id: 'free-helper' }
    state.legions.push(sibling, blocker, free)
    expect(listAllMoves(state, own, 1).size).toBe(0)
    const leave = rankMoves(state, profile).find((m) => m.legionId === free.id && m.hex === '22')!
    expect(leave).toBeTruthy()
    const projected = dispatch(state, { type: 'move', legionId: free.id, toHex: '22' })
    expect(canEndMovePhase(projected)).toBe(true)
    const actual = dispatch(projected, { type: 'doneMove' })
    expect(actual.legions.filter((l) => l.playerId === own.playerId)).toHaveLength(3)
    expect(actual.legions.find((l) => l.hexLabel === '4')!.creatures).toHaveLength(4)
    const search = searchMasterMoves(state, [leave], profile, { depth: 1, destinationsPerRoll: 1,
      compareHold: true, holdLegionId: own.id })
    expect(search.bestHold).toBeNull()
    expect(search.diagnostics.incomplete).toBe(true)
  })

  it('keeps the actual control first but represents another legion inside the same root budget', () => {
    const { state, own } = trap('100', 2)
    state.legions = [own, helper(own, '200')]
    const ranked = rankMoves(state, profile)
    const first = ranked.filter((m) => m.legionId === own.id).slice(0, 3)
    const alternate = ranked.find((m) => m.legionId !== own.id)!
    expect(first).toHaveLength(3)
    const result = searchMasterMoves(state, [...first, alternate], profile, { depth: 1 })
    expect(result.candidates[0].move).toBe(first[0])
    expect(result.candidates).toHaveLength(3)
    expect(result.candidates.some((c) => c.move === alternate)).toBe(true)
  })
})
