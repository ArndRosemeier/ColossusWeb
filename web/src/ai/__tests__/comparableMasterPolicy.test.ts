import { describe, expect, it } from 'vitest'
import { dispatch } from '../../engine/GameEngine'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { AI_PROFILES } from '../profiles'
import { rankMoves, pickBestMove } from '../evaluateMove'
import { searchMasterMoves } from '../masterLookahead'

function independentLegions() {
  const state = twoPlayerGame(71), reserve = state.legions[0], enemy = state.legions[1]
  state.phase = 'Move'; state.turnNumber = 3; state.movementRoll = 3
  state.players[0].kind = 'ai'; state.players[0].aiProfileId = 'balanced'; state.players[0].aiDifficultyId = 'hard'
  reserve.hexLabel = '1000'; reserve.moveOriginHex = '1000'; reserve.moved = false; reserve.creatures = [{ type: 'Titan', hits: 0 }]
  enemy.hexLabel = '6000'; enemy.creatures = [{ type: 'Titan', hits: 0 }]
  const ogres = { ...reserve, id: 'ogres', markerId: state.players[0].markersAvailable.shift()!, hexLabel: '200', moveOriginHex: '200',
    creatures: ['Ogre', 'Ogre'].map(type => ({ type, hits: 0 })) }
  const cyclops = { ...ogres, id: 'cyclops', markerId: state.players[0].markersAvailable.shift()!, hexLabel: '4000', moveOriginHex: '4000',
    creatures: ['Cyclops', 'Cyclops', 'Cyclops'].map(type => ({ type, hits: 0 })) }
  state.legions = [reserve, ogres, cyclops, enemy]; state.caretaker.Cyclops -= 3
  return { state, ogres, cyclops }
}

describe('comparable masterboard continuation policy', () => {
  it('gives an identical actual root state the same continuation value regardless of which legion labels HOLD', () => {
    const { state, ogres, cyclops } = independentLegions()
    const control = pickBestMove(state, AI_PROFILES.balanced, () => 0, false, new Set(), { masterLookahead: false })
    expect(control).toMatchObject({ type: 'move', legionId: cyclops.id, toHex: '24' })
    const ranked = rankMoves(state, AI_PROFILES.balanced)
    const b = ranked.find(m => m.legionId === cyclops.id && m.hex === '24')!
    const a = ranked.find(m => m.legionId === ogres.id && m.hex === '8')!
    const before = JSON.stringify(state)
    const start = performance.now()
    const result = searchMasterMoves(state, [b, a], AI_PROFILES.balanced,
      { depth: 2, candidateLimit: 2, destinationsPerRoll: 1, compareHold: true })
    expect(result.diagnostics.exhausted).toBe(false)
    expect(result.diagnostics.incomplete).toBe(false)
    expect(result.diagnostics.continuationLegionId).toBe(cyclops.id)
    expect(new Set(result.candidates.map(c => c.continuationLegionId))).toEqual(new Set([cyclops.id]))
    expect(result.bestHold!.continuationLegionId).toBe(cyclops.id)
    expect(result.diagnostics.combinedFutureRounds).toBeGreaterThan(0)
    expect(result.diagnostics.futureMustersByLegion[ogres.id]).toBeGreaterThan(0)
    expect(result.diagnostics.futureMustersByLegion[cyclops.id]).toBeGreaterThan(0)
    const moveB = result.candidates.find(c => c.move === b)!
    const holdA = result.candidates.find(c => c.move === a)!
    expect(holdA.holdCommand).toEqual(control) // both hypotheses execute EXACTLY B→24
    console.log('IDENTICAL-ROOT-CONTINUATION', JSON.stringify({ runtimeMs: performance.now() - start, moveB: moveB.expectedArmyQuality,
      holdA: holdA.holdArmyQuality, diagnostics: result.diagnostics }))
    expect(holdA.holdArmyQuality).toBeCloseTo(moveB.expectedArmyQuality, 10)
    expect(JSON.stringify(state)).toBe(before)
    expect(searchMasterMoves(state, [b, a], AI_PROFILES.balanced,
      { depth: 2, candidateLimit: 2, destinationsPerRoll: 1, compareHold: true })).toEqual(result)

    // Actual rules permit both independent moves before global muster: no lost opportunity.
    let game = dispatch(dispatch(state, { type: 'move', legionId: ogres.id, toHex: '8' }), control)
    game = dispatch(game, { type: 'doneMove' })
    game = dispatch(game, { type: 'recruit', legionId: ogres.id, creatureType: 'Troll' })
    game = dispatch(game, { type: 'recruit', legionId: cyclops.id, creatureType: 'Gorgon' })
    expect(game.caretaker.Troll).toBe(state.caretaker.Troll - 1)
    expect(game.caretaker.Gorgon).toBe(state.caretaker.Gorgon - 1)
    expect(game.legions.find(l => l.id === ogres.id)!.creatures.at(-1)!.type).toBe('Troll')
    expect(game.legions.find(l => l.id === cyclops.id)!.creatures.at(-1)!.type).toBe('Gorgon')
  })

  it('does not keep a dangerous changed root stack alive merely by focusing another legion', () => {
    const { state, ogres, cyclops } = independentLegions()
    state.movementRoll = 1
    ogres.hexLabel = '1'; ogres.moveOriginHex = '1'
    ogres.creatures = ['Centaur', 'Centaur'].map(type => ({ type, hits: 0 }))
    const enemy = state.legions.find(l => l.playerId !== ogres.playerId)!
    enemy.hexLabel = '1000'; enemy.creatures = ['Hydra', 'Hydra', 'Hydra'].map(type => ({ type, hits: 0 }))
    state.legions = [ogres, cyclops, enemy]
    const bad = rankMoves(state, AI_PROFILES.balanced).find(m => m.legionId === ogres.id && m.hex === '2')!
    expect(bad).toBeTruthy()
    const before = JSON.stringify(state)
    const result = searchMasterMoves(state, [bad], AI_PROFILES.balanced, { continuationLegionId: cyclops.id })
    expect(result.diagnostics.exhausted).toBe(false)
    expect(result.diagnostics.incomplete).toBe(true)
    expect(result.diagnostics.prunedUnsafeContinuations).toBe(1)
    expect(result.best).toBeNull()
    expect(result.bestHold).toBeNull()
    expect(JSON.stringify(state)).toBe(before)
  })
})
