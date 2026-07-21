import { describe, expect, it } from 'vitest'
import { pickAiCommand } from '../simpleAi'
import { chooseCreaturesToSplitOut } from '../splitChoice'
import { dispatch } from '../../engine/GameEngine'
import { twoPlayerGame, turn1SplitChild } from '../../engine/__tests__/helpers'
import type { Legion } from '../../engine/types'

function makeHeight7(
  creatures: string[],
): ReturnType<typeof twoPlayerGame> & { legion: Legion } {
  let g = twoPlayerGame(21)
  const parent = g.legions.find((l) => l.playerId === g.players[0]!.id)!
  g = dispatch(g, {
    type: 'split',
    parentId: parent.id,
    childCreatures: turn1SplitChild(g, parent),
  })
  g = dispatch(g, { type: 'doneSplit' })
  // Fast-forward to Alice Split again with a crafted height-7 stack
  g.phase = 'Split'
  g.activePlayerIndex = 0
  g.turnNumber = 3
  g.splitSkipWarned = false
  const legion = g.legions.find((l) => l.playerId === g.players[0]!.id)!
  legion.creatures = creatures.map((type) => ({ type, hits: 0 }))
  legion.splitThisTurn = false
  // Drop sibling stacks so only this legion matters
  g.legions = g.legions.filter((l) => l.id === legion.id || l.playerId !== g.players[0]!.id)
  g.players[0]!.kind = 'ai'
  g.players[0]!.aiProfileId = 'balanced'
  return Object.assign(g, { legion })
}

describe('AI split choice', () => {
  it('splits off surplus weak units, keeping 3 Cyclops for Behemoth', () => {
    const g = makeHeight7([
      'Titan',
      'Cyclops',
      'Cyclops',
      'Cyclops',
      'Lion',
      'Ogre',
      'Ogre',
    ])
    const child = chooseCreaturesToSplitOut(g, g.legion)
    expect(child).toHaveLength(2)
    expect(child.sort()).toEqual(['Ogre', 'Ogre'])
    const left = [...g.legion.creatures.map((c) => c.type)]
    for (const t of child) {
      const i = left.indexOf(t)
      expect(i).toBeGreaterThanOrEqual(0)
      left.splice(i, 1)
    }
    expect(left.filter((t) => t === 'Cyclops')).toHaveLength(3)
    expect(left).toContain('Titan')
  })

  it('never splits the Titan', () => {
    const g = makeHeight7(['Titan', 'Angel', 'Lion', 'Lion', 'Ogre', 'Ogre', 'Centaur'])
    const child = chooseCreaturesToSplitOut(g, g.legion)
    expect(child).not.toContain('Titan')
    expect(child).toHaveLength(2)
  })

  it('AI always splits a height-7 legion when markers are free', () => {
    const g = makeHeight7([
      'Titan',
      'Cyclops',
      'Cyclops',
      'Cyclops',
      'Gargoyle',
      'Gargoyle',
      'Ogre',
    ])
    const cmd = pickAiCommand(g, () => 0.99)
    expect(cmd).toEqual({
      type: 'split',
      parentId: g.legion.id,
      childCreatures: expect.any(Array),
    })
    if (cmd?.type === 'split') {
      expect(cmd.childCreatures).toHaveLength(2)
      expect(cmd.childCreatures).not.toContain('Titan')
      // Prefer weak surplus over Cyclops
      expect(cmd.childCreatures.every((t) => t !== 'Cyclops')).toBe(true)
    }
  })
})
