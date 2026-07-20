import { describe, expect, it } from 'vitest'
import { dispatch } from '../GameEngine'
import { turn1SplitChild, twoPlayerGame } from './helpers'

describe('rules-split', () => {
  it('P1: cannot split outside Split phase', () => {
    let g = twoPlayerGame(5)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    expect(g.phase).toBe('Move')
    const still = g.legions.find((l) => l.playerId === g.players[0].id)!
    const bad = dispatch(g, {
      type: 'split',
      parentId: still.id,
      childCreatures: ['Ogre', 'Ogre'],
    })
    expect(bad.message).toMatch(/Not split phase/i)
    expect(bad.legions.filter((l) => l.playerId === g.players[0].id)).toHaveLength(
      g.legions.filter((l) => l.playerId === g.players[0].id).length,
    )
  })

  it('P3: child and parent must each keep at least 2 creatures', () => {
    const g = twoPlayerGame(5)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    const tooSmall = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: ['Centaur'],
    })
    expect(tooSmall.message).toMatch(/Turn 1 split must be 4 and 4|at least 2/i)
    expect(tooSmall.legions).toHaveLength(g.legions.length)

    const tooBig = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: [
        'Centaur',
        'Centaur',
        'Ogre',
        'Ogre',
        'Gargoyle',
        'Gargoyle',
        'Angel',
      ],
    })
    expect(tooBig.message).toMatch(/Turn 1 split must be 4 and 4|at least 2/i)
  })

  it('P3: cannot leave Split with a legion taller than 7', () => {
    const g = twoPlayerGame(5)
    const stuck = dispatch(g, { type: 'doneSplit' })
    expect(stuck.phase).toBe('Split')
    expect(stuck.message).toMatch(/taller than 7/i)
  })

  it('P2: turn 1 requires a single 4:4 split with one Lord each', () => {
    let g = twoPlayerGame(5)
    expect(g.turnNumber).toBe(1)
    expect(g.phase).toBe('Split')
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    expect(parent.creatures.length).toBe(8)

    const uneven = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: ['Centaur', 'Ogre'],
    })
    expect(uneven.message).toMatch(/4 and 4/i)
    expect(uneven.legions).toHaveLength(g.legions.length)

    const noLord = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: ['Centaur', 'Centaur', 'Ogre', 'Ogre'],
    })
    expect(noLord.message).toMatch(/one Lord/i)

    const twoLords = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: ['Titan', 'Angel', 'Centaur', 'Ogre'],
    })
    expect(twoLords.message).toMatch(/one Lord/i)

    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    const mine = g.legions.filter((l) => l.playerId === g.players[0].id)
    expect(mine).toHaveLength(2)
    expect(mine.every((l) => l.creatures.length === 4)).toBe(true)
    expect(
      mine.every(
        (l) => l.creatures.filter((c) => g.variant.creatures[c.type]?.lord).length === 1,
      ),
    ).toBe(true)

    const second = dispatch(g, {
      type: 'split',
      parentId: mine[0].id,
      childCreatures: ['Centaur', 'Ogre'],
    })
    expect(second.message).toMatch(/Cannot split twice on turn 1/i)
  })
})
