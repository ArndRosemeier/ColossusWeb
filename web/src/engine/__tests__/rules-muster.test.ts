import { describe, expect, it } from 'vitest'
import { dispatch, getLegalRecruits } from '../GameEngine'
import { listAllMoves } from '../movement'
import { listRecruits } from '../recruit'
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
  // Prefer a legion+dest that can actually muster (not e.g. Desert without Lions)
  const movers = g.legions.filter((l) => l.playerId === g.players[0].id)
  let mover = movers[0]
  let dest: string | null = null
  for (const leg of movers) {
    const moves = listAllMoves(g, leg, g.movementRoll!)
    for (const label of moves.keys()) {
      const phantom = { ...leg, hexLabel: label, moved: true, recruited: false }
      if (listRecruits(g, phantom).length > 0) {
        mover = leg
        dest = label
        break
      }
    }
    if (dest) break
  }
  expect(dest).toBeTruthy()
  g = dispatch(g, { type: 'move', legionId: mover.id, toHex: dest! })
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
    g = dispatch(g, { type: 'recruit', legionId: movedId, creatureType: options[0]! })
    expect(getLegalRecruits(g, movedId)).toEqual([])
    expect(g.legions.find((l) => l.id === movedId)!.musteredThisTurn).toBe(options[0])
  })

  it('undoRecruit restores caretaker and clears recruit flags', () => {
    let { g, movedId } = musterReady(1)
    const options = getLegalRecruits(g, movedId)
    expect(options.length).toBeGreaterThan(0)
    const creature = options[0]!
    const beforeCount = g.caretaker[creature] ?? 0
    const beforeHeight = g.legions.find((l) => l.id === movedId)!.creatures.length
    g = dispatch(g, { type: 'recruit', legionId: movedId, creatureType: creature })
    expect(g.caretaker[creature]).toBe(beforeCount - 1)
    g = dispatch(g, { type: 'undoRecruit', legionId: movedId })
    const leg = g.legions.find((l) => l.id === movedId)!
    expect(leg.recruited).toBe(false)
    expect(leg.musteredThisTurn).toBeNull()
    expect(leg.creatures.length).toBe(beforeHeight)
    expect(g.caretaker[creature]).toBe(beforeCount)
    expect(getLegalRecruits(g, movedId)).toContain(creature)
  })

  it('warns when Done is pressed while a legion can still muster', () => {
    let { g, movedId } = musterReady(1)
    expect(getLegalRecruits(g, movedId).length).toBeGreaterThan(0)
    const warned = dispatch(g, { type: 'doneMuster' })
    expect(warned.phase).toBe('Muster')
    expect(warned.musterSkipWarned).toBe(true)
    expect(warned.message).toMatch(/can still muster/i)

    const skipped = dispatch(warned, { type: 'doneMuster' })
    expect(skipped.phase).toBe('Split')
    expect(skipped.activePlayerIndex).not.toBe(warned.activePlayerIndex)
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
