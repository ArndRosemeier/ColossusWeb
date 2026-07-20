import { describe, expect, it } from 'vitest'
import { bestRecruitAt, listRecruitOptionsAt, numberOfRecruiterNeeded } from '../recruit'
import { twoPlayerGame, turn1SplitChild } from './helpers'
import { dispatch } from '../GameEngine'

describe('recruit move previews', () => {
  it('Desert Lion requires a Lion recruiter — Ogre/Gargoyle cannot muster there', () => {
    let g = twoPlayerGame(3)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    const legion = g.legions.find((l) => l.playerId === g.players[0].id)!
    legion.creatures = [
      { type: 'Ogre', hits: 0 },
      { type: 'Gargoyle', hits: 0 },
      { type: 'Gargoyle', hits: 0 },
    ]
    const desert = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Desert')
    expect(desert).toBeTruthy()
    expect(listRecruitOptionsAt(g, legion, desert!.label)).toEqual([])
    expect(bestRecruitAt(g, legion, desert!.label)).toBeNull()
  })

  it('1 Lion in Desert can muster another Lion', () => {
    let g = twoPlayerGame(3)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    const legion = g.legions.find((l) => l.playerId === g.players[0].id)!
    legion.creatures = [{ type: 'Lion', hits: 0 }]
    const desert = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Desert')!
    expect(listRecruitOptionsAt(g, legion, desert.label)).toContain('Lion')
    expect(bestRecruitAt(g, legion, desert.label)).toBe('Lion')
  })

  it('3 Lions in Desert can muster Griffon (strongest)', () => {
    let g = twoPlayerGame(3)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    const legion = g.legions.find((l) => l.playerId === g.players[0].id)!
    legion.creatures = [
      { type: 'Lion', hits: 0 },
      { type: 'Lion', hits: 0 },
      { type: 'Lion', hits: 0 },
    ]
    const desert = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Desert')!
    const options = listRecruitOptionsAt(g, legion, desert.label)
    expect(options).toContain('Lion')
    expect(options).toContain('Griffon')
    expect(bestRecruitAt(g, legion, desert.label)).toBe('Griffon')
  })

  it('numberOfRecruiterNeeded matches Default Desert tree', () => {
    const g = twoPlayerGame(1)
    const desert = g.variant.terrains.Desert
    expect(numberOfRecruiterNeeded(desert, 'Lion', 'Lion')).toBe(1)
    expect(numberOfRecruiterNeeded(desert, 'Lion', 'Griffon')).toBe(3)
    expect(numberOfRecruiterNeeded(desert, 'Griffon', 'Hydra')).toBe(2)
    expect(numberOfRecruiterNeeded(desert, 'Griffon', 'Lion')).toBe(1)
    expect(numberOfRecruiterNeeded(desert, 'Ogre', 'Lion')).toBe(99)
  })
})
