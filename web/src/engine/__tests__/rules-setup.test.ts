import { describe, expect, it } from 'vitest'
import { dispatch } from '../GameEngine'
import { turn1SplitChild, twoPlayerGame } from './helpers'

describe('rules-setup', () => {
  it('A2/S2: Colossus start — one 8-high legion with Titan+Angel+2×Centaur/Gargoyle/Ogre', () => {
    const g = twoPlayerGame(42)
    expect(g.legions).toHaveLength(2)
    for (const leg of g.legions) {
      const types = leg.creatures.map((c) => c.type)
      expect(types).toHaveLength(8)
      expect(types.filter((t) => t === 'Titan')).toHaveLength(1)
      expect(types.filter((t) => t === 'Angel')).toHaveLength(1)
      expect(types.filter((t) => t === 'Centaur')).toHaveLength(2)
      expect(types.filter((t) => t === 'Gargoyle')).toHaveLength(2)
      expect(types.filter((t) => t === 'Ogre')).toHaveLength(2)
    }
  })

  it('S1: each player gets a unique starting tower', () => {
    const g = twoPlayerGame(7)
    const towers = g.players.map((p) => p.startingTower)
    expect(new Set(towers).size).toBe(towers.length)
    for (const p of g.players) {
      expect(g.variant.board.towers).toContain(p.startingTower)
    }
  })

  it('A3: game starts in Split phase', () => {
    const g = twoPlayerGame()
    expect(g.phase).toBe('Split')
    expect(g.turnNumber).toBe(1)
  })

  it('A3: phase order Split → Move after doneSplit (when height ≤7)', () => {
    let g = twoPlayerGame(3)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    expect(g.phase).toBe('Move')
    expect(g.movementRoll).toBeGreaterThanOrEqual(1)
    expect(g.movementRoll).toBeLessThanOrEqual(6)
  })
})
