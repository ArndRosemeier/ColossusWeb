import { describe, expect, it } from 'vitest'
import { dispatch } from '../GameEngine'
import {
  clearPublicKnowledge,
  formatPublicContents,
  publicViewSlots,
  recruitersRevealedFor,
  revealAll,
  revealRecruit,
} from '../publicKnowledge'
import { turn1SplitChild, twoPlayerGame } from './helpers'

describe('publicKnowledge', () => {
  it('starts fully known, then split clears public knowledge', () => {
    let g = twoPlayerGame(5)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    expect(parent.knownPublic).toHaveLength(8)
    expect(parent.knownPublic).toEqual(parent.creatures.map((c) => c.type))

    g.players[0]!.kind = 'ai'
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    const mine = g.legions.filter((l) => l.playerId === g.players[0].id)
    expect(mine).toHaveLength(2)
    for (const leg of mine) {
      expect(leg.knownPublic).toEqual([])
      expect(publicViewSlots(g, leg).every((s) => s.kind === 'unknown')).toBe(true)
      expect(formatPublicContents(g, leg)).toBe('?, ?, ?, ?')
    }
  })

  it('Brush Cyclops muster reveals 2 Gargoyles + Cyclops', () => {
    const g = twoPlayerGame(8)
    const alice = g.players[0]!
    alice.kind = 'ai'
    const leg = g.legions.find((l) => l.playerId === alice.id)!
    clearPublicKnowledge(leg)
    leg.creatures = [
      { type: 'Gargoyle', hits: 0 },
      { type: 'Gargoyle', hits: 0 },
      { type: 'Ogre', hits: 0 },
      { type: 'Centaur', hits: 0 },
    ]
    const brush = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Brush')!
    leg.hexLabel = brush.label
    leg.moved = true
    expect(recruitersRevealedFor(g, leg, 'Cyclops')).toEqual(['Gargoyle', 'Gargoyle'])

    leg.creatures.push({ type: 'Cyclops', hits: 0 })
    revealRecruit(g, leg, 'Cyclops')
    expect(leg.knownPublic.sort()).toEqual(['Cyclops', 'Gargoyle', 'Gargoyle'].sort())
    const slots = publicViewSlots(g, leg)
    expect(slots.filter((s) => s.kind === 'known').map((s) => (s as { type: string }).type).sort()).toEqual(
      ['Cyclops', 'Gargoyle', 'Gargoyle'].sort(),
    )
    expect(slots.filter((s) => s.kind === 'unknown')).toHaveLength(2)
  })

  it('Tower Warlock muster reveals Titan + Warlock', () => {
    const g = twoPlayerGame(8)
    const alice = g.players[0]!
    alice.kind = 'ai'
    const leg = g.legions.find((l) => l.playerId === alice.id)!
    clearPublicKnowledge(leg)
    leg.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Ogre', hits: 0 },
      { type: 'Ogre', hits: 0 },
    ]
    const tower = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Tower')!
    leg.hexLabel = tower.label
    expect(recruitersRevealedFor(g, leg, 'Warlock')).toEqual(['Titan'])
    leg.creatures.push({ type: 'Warlock', hits: 0 })
    revealRecruit(g, leg, 'Warlock')
    expect(leg.knownPublic.sort()).toEqual(['Titan', 'Warlock'].sort())
  })

  it('battle reveal marks survivors fully known', () => {
    const g = twoPlayerGame(3)
    const bob = g.players[1]!
    bob.kind = 'ai'
    const leg = g.legions.find((l) => l.playerId === bob.id)!
    clearPublicKnowledge(leg)
    expect(publicViewSlots(g, leg).every((s) => s.kind === 'unknown')).toBe(true)
    revealAll(leg)
    expect(leg.knownPublic).toEqual(leg.creatures.map((c) => c.type))
    expect(publicViewSlots(g, leg).every((s) => s.kind === 'known')).toBe(true)
  })

  it('human-owned legions always show full contents in the UI view', () => {
    const g = twoPlayerGame(3)
    const alice = g.players[0]!
    alice.kind = 'human'
    const leg = g.legions.find((l) => l.playerId === alice.id)!
    clearPublicKnowledge(leg)
    expect(publicViewSlots(g, leg).every((s) => s.kind === 'known')).toBe(true)
  })
})
