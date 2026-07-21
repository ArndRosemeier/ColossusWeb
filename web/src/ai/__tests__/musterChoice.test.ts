import { describe, expect, it } from 'vitest'
import { pickAiCommand } from '../simpleAi'
import {
  bestRecruitAt,
  compositionDevelopmentValue,
  listDevelopmentEdges,
  listRecruitOptionsAt,
  scoreRecruitOption,
} from '../../engine/recruit'
import { twoPlayerGame, turn1SplitChild } from '../../engine/__tests__/helpers'
import { dispatch } from '../../engine/GameEngine'
import type { Legion } from '../../engine/types'

function hexOfTerrain(state: ReturnType<typeof twoPlayerGame>, terrain: string): string {
  const hex = Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === terrain)
  if (!hex) throw new Error(`No ${terrain} hex`)
  return hex.label
}

function stubMovedLegion(
  g: ReturnType<typeof twoPlayerGame>,
  creatures: string[],
  terrain: string,
): Legion {
  const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
  parent.creatures = creatures.map((type) => ({ type, hits: 0 }))
  parent.hexLabel = hexOfTerrain(g, terrain)
  parent.moved = true
  parent.recruited = false
  parent.musteredThisTurn = null
  return parent
}

describe('development-aware muster ranking', () => {
  it('tracks Cyclops→Behemoth (3) and Troll→Wyvern (3) upgrade edges', () => {
    const g = twoPlayerGame(1)
    const edges = listDevelopmentEdges(g)
    expect(edges).toContainEqual({ recruiter: 'Cyclops', recruit: 'Behemoth', needed: 3 })
    expect(edges).toContainEqual({ recruiter: 'Troll', recruit: 'Wyvern', needed: 3 })
    // Down-tree regularRecruit edges must not appear
    expect(edges.some((e) => e.recruiter === 'Gorgon' && e.recruit === 'Cyclops')).toBe(false)
  })

  it('Brush: 2 Cyclops prefer a third Cyclops (unlocks Behemoth) over Gorgon', () => {
    const g = twoPlayerGame(1)
    const legion = stubMovedLegion(g, ['Cyclops', 'Cyclops'], 'Brush')
    const brush = legion.hexLabel
    const options = listRecruitOptionsAt(g, legion, brush)
    expect(options).toEqual(expect.arrayContaining(['Cyclops', 'Gorgon']))
    expect(bestRecruitAt(g, legion, brush)).toBe('Cyclops')
    expect(scoreRecruitOption(g, 'Cyclops', brush, legion)).toBeGreaterThan(
      scoreRecruitOption(g, 'Gorgon', brush, legion),
    )
    expect(compositionDevelopmentValue(g, { Cyclops: 3 })).toBeGreaterThan(
      compositionDevelopmentValue(g, { Cyclops: 2, Gorgon: 1 }),
    )
  })

  it('Marsh: 2 Trolls prefer a third Troll (unlocks Wyvern) over Ranger', () => {
    const g = twoPlayerGame(1)
    const legion = stubMovedLegion(g, ['Troll', 'Troll'], 'Marsh')
    const marsh = legion.hexLabel
    expect(listRecruitOptionsAt(g, legion, marsh)).toEqual(
      expect.arrayContaining(['Troll', 'Ranger']),
    )
    expect(bestRecruitAt(g, legion, marsh)).toBe('Troll')
  })

  it('Marsh: 3 Trolls prefer Ranger once the Wyvern unlock is complete', () => {
    const g = twoPlayerGame(1)
    const legion = stubMovedLegion(g, ['Troll', 'Troll', 'Troll'], 'Marsh')
    expect(bestRecruitAt(g, legion, legion.hexLabel)).toBe('Ranger')
  })

  it('Plains: 2 Lions prefer a third Lion (unlocks Griffon on Desert) over Ranger', () => {
    const g = twoPlayerGame(1)
    const legion = stubMovedLegion(g, ['Lion', 'Lion'], 'Plains')
    expect(bestRecruitAt(g, legion, legion.hexLabel)).toBe('Lion')
  })

  it('Desert: 3 Lions still prefer Griffon once the 3-count unlock is already held', () => {
    const g = twoPlayerGame(1)
    const legion = stubMovedLegion(g, ['Lion', 'Lion', 'Lion'], 'Desert')
    expect(bestRecruitAt(g, legion, legion.hexLabel)).toBe('Griffon')
  })

  it('balanced AI musters Cyclops with 2 Cyclops on Brush', () => {
    let g = twoPlayerGame(1)
    g.players[0].kind = 'ai'
    g.players[0].aiProfileId = 'balanced'
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
    mover.creatures = [
      { type: 'Cyclops', hits: 0 },
      { type: 'Cyclops', hits: 0 },
    ]
    mover.hexLabel = hexOfTerrain(g, 'Brush')
    mover.moved = true
    mover.recruited = false
    g.phase = 'Muster'
    g.activePlayerIndex = 0

    const cmd = pickAiCommand(g, () => 0)
    expect(cmd).toEqual({
      type: 'recruit',
      legionId: mover.id,
      creatureType: 'Cyclops',
    })
  })
})
