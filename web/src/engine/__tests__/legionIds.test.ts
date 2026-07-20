import { describe, expect, it } from 'vitest'
import {
  dispatch,
  ensureUniqueLegionIds,
  getMovesForSelected,
  syncLegionSeqFromState,
} from '../GameEngine'
import { twoPlayerGame, turn1SplitChild } from './helpers'

describe('legion id uniqueness', () => {
  it('repairs duplicate ids so sibling selection uses the clicked stack', () => {
    let g = twoPlayerGame(3)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })

    // Simulate the post-load bug: a later split reused an existing id
    const alice = g.players[0]!
    const [a, b] = g.legions.filter((l) => l.playerId === alice.id)
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()

    // Place a second "pair" that falsely shares b's id with a different hex
    const otherHex = Object.keys(g.variant.board.hexByLabel).find((h) => h !== a!.hexLabel)!
    const impostor = {
      ...structuredClone(b!),
      id: a!.id, // duplicate of a
      markerId: 'Rd99'.replace('99', '03'),
      hexLabel: otherHex,
    }
    // Use a real free marker
    impostor.markerId = alice.markersAvailable[0] ?? 'Rd05'
    g.legions.push(impostor)

    // Before repair: selecting by impostor's intended click id hits the first match (a)
    g.movementRoll = 4
    g.phase = 'Move'
    let broken = dispatch(g, { type: 'selectLegion', legionId: a!.id })
    expect(broken.legions.find((l) => l.id === a!.id)!.hexLabel).toBe(a!.hexLabel)

    ensureUniqueLegionIds(g)
    const ids = g.legions.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)

    const fixedImpostor = g.legions.find((l) => l.markerId === impostor.markerId)!
    expect(fixedImpostor.id).not.toBe(a!.id)

    broken = dispatch(g, { type: 'selectLegion', legionId: a!.id })
    const movesA = [...getMovesForSelected(broken).keys()].sort()
    const sibling = broken.legions.find((l) => l.id === b!.id)!
    broken = dispatch(broken, { type: 'selectLegion', legionId: sibling.id })
    const movesB = [...getMovesForSelected(broken).keys()].sort()
    expect(movesA).toEqual(movesB)

    broken = dispatch(broken, { type: 'selectLegion', legionId: fixedImpostor.id })
    const movesOther = [...getMovesForSelected(broken).keys()].sort()
    expect(movesOther).not.toEqual(movesA)
  })

  it('syncLegionSeqFromState prevents new splits from colliding after high ids', () => {
    const g = twoPlayerGame(1)
    g.legions[0]!.id = 'leg-50'
    syncLegionSeqFromState(g)
    const parent = g.legions[0]!
    parent.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Angel', hits: 0 },
      { type: 'Ogre', hits: 0 },
      { type: 'Ogre', hits: 0 },
      { type: 'Centaur', hits: 0 },
      { type: 'Centaur', hits: 0 },
      { type: 'Gargoyle', hits: 0 },
      { type: 'Gargoyle', hits: 0 },
    ]
    g.phase = 'Split'
    g.turnNumber = 1
    const after = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    const ids = after.legions.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.some((id) => id === 'leg-51')).toBe(true)
  })
})
