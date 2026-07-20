import { describe, expect, it } from 'vitest'
import { dispatch } from '../GameEngine'
import { turn1SplitChild, twoPlayerGame } from './helpers'

describe('physical dice mode', () => {
  it('defers movement roll until commitDice', () => {
    let g = twoPlayerGame(11, { diceMode: 'physical' })
    const parent = g.legions.find((l) => l.playerId === g.players[0]!.id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    expect(g.pendingDice?.context).toBe('movement')
    expect(g.movementRoll).toBeNull()
    g = dispatch(g, { type: 'commitDice', values: [4] })
    expect(g.pendingDice).toBeNull()
    expect(g.movementRoll).toBe(4)
    expect(g.diceRoll?.values).toEqual([4])
    expect(g.diceRoll?.playerId).toBe(g.players[0]!.id)
  })

  it('rng mode still rolls immediately', () => {
    let g = twoPlayerGame(11, { diceMode: 'rng' })
    const parent = g.legions.find((l) => l.playerId === g.players[0]!.id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    expect(g.pendingDice).toBeNull()
    expect(g.movementRoll).toBeGreaterThanOrEqual(1)
    expect(g.movementRoll).toBeLessThanOrEqual(6)
  })

  it('commitDice without values uses rng', () => {
    let g = twoPlayerGame(99, { diceMode: 'physical' })
    const parent = g.legions.find((l) => l.playerId === g.players[0]!.id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    g = dispatch(g, { type: 'commitDice' }, () => 0.99)
    expect(g.movementRoll).toBe(6)
  })
})
