import { describe, expect, it } from 'vitest'
import { dispatch, getLegalRecruits } from '../GameEngine'
import { listAllMoves } from '../movement'
import { turn1SplitChild, twoPlayerGame } from './helpers'
import type { GameState } from '../types'

function musterReady(seed: number): { g: GameState; movedId: string; unmovedId: string } {
  let g = twoPlayerGame(seed)
  const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
  g = dispatch(g, {
    type: 'split',
    parentId: parent.id,
    childCreatures: turn1SplitChild(g, parent),
  })
  g = dispatch(g, { type: 'doneSplit' })
  const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
  const moves = listAllMoves(g, mover, g.movementRoll!)
  const dest = [...moves.keys()][0]
  g = dispatch(g, { type: 'move', legionId: mover.id, toHex: dest })
  g = dispatch(g, { type: 'doneMove' })
  expect(g.phase).toBe('Muster')
  const unmoved = g.legions.find(
    (l) => l.playerId === g.players[0].id && l.id !== mover.id,
  )!
  return { g, movedId: mover.id, unmovedId: unmoved.id }
}

describe('rules-muster', () => {
  it('Q1: only a legion that moved may recruit', () => {
    const { g, movedId, unmovedId } = musterReady(1)
    expect(getLegalRecruits(g, movedId).length).toBeGreaterThan(0)
    expect(getLegalRecruits(g, unmovedId)).toEqual([])
  })

  it('Q1: height > 6 cannot recruit', () => {
    const { g, movedId } = musterReady(1)
    const leg = g.legions.find((l) => l.id === movedId)!
    // Pad to 7 without going through recruit API
    while (leg.creatures.length < 7) {
      leg.creatures.push({ type: 'Centaur', hits: 0 })
    }
    expect(getLegalRecruits(g, movedId)).toEqual([])
  })

  it('Q2: at most one recruit per legion per turn', () => {
    let { g, movedId } = musterReady(1)
    const options = getLegalRecruits(g, movedId)
    expect(options.length).toBeGreaterThan(0)
    g = dispatch(g, { type: 'recruit', legionId: movedId, creatureType: options[0] })
    expect(getLegalRecruits(g, movedId)).toEqual([])
  })

  it('Q3: tower Warlock requires Titan; Guardian requires 3 identical non-lords', () => {
    // Stay in tower: move out and… better construct muster in tower by
    // moving a legion that returns — or test listRecruits directly after marking moved.
    let g = twoPlayerGame(9)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    // Titan stack still in tower
    const titanLeg = g.legions.find(
      (l) =>
        l.playerId === g.players[0].id &&
        l.creatures.some((c) => c.type === 'Titan'),
    )!
    titanLeg.moved = true
    g.phase = 'Muster'
    const withTitan = getLegalRecruits(g, titanLeg.id)
    expect(withTitan).toContain('Warlock')

    const child = g.legions.find(
      (l) => l.playerId === g.players[0].id && l.id !== titanLeg.id,
    )!
    child.moved = true
    child.creatures = [
      { type: 'Centaur', hits: 0 },
      { type: 'Centaur', hits: 0 },
      { type: 'Centaur', hits: 0 },
    ]
    const withThree = getLegalRecruits(g, child.id)
    expect(withThree).toContain('Guardian')
    expect(withThree).not.toContain('Warlock')
  })
})
