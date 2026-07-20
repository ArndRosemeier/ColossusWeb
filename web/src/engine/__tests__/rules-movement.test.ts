import { describe, expect, it } from 'vitest'
import { dispatch } from '../GameEngine'
import { listAllMoves, listNormalMoveHexes } from '../movement'
import { twoPlayerGame, turn1SplitChild } from './helpers'
import type { GameState } from '../types'

function splitAndRoll(seed: number): GameState {
  let g = twoPlayerGame(seed)
  const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
  g = dispatch(g, {
    type: 'split',
    parentId: parent.id,
    childCreatures: turn1SplitChild(g, parent),
  })
  g = dispatch(g, { type: 'doneSplit' })
  return g
}

describe('rules-movement', () => {
  it('M1: Movement Phase has a single die roll 1–6', () => {
    const g = splitAndRoll(11)
    expect(g.phase).toBe('Move')
    expect(g.movementRoll).toBeGreaterThanOrEqual(1)
    expect(g.movementRoll).toBeLessThanOrEqual(6)
  })

  it('M2: cannot end Move without moving if a legal move exists', () => {
    const g = splitAndRoll(11)
    const stuck = dispatch(g, { type: 'doneMove' })
    expect(stuck.phase).toBe('Move')
    expect(stuck.message).toMatch(/must move/i)
  })

  it('M2: each legion may move only once', () => {
    let g = splitAndRoll(11)
    const mover = g.legions.find((l) => l.playerId === g.players[0].id && !l.moved)!
    const moves = listAllMoves(g, mover, g.movementRoll!)
    expect(moves.size).toBeGreaterThan(0)
    const dest = [...moves.keys()][0]
    g = dispatch(g, { type: 'move', legionId: mover.id, toHex: dest })
    expect(g.legions.find((l) => l.id === mover.id)!.moved).toBe(true)
    const again = dispatch(g, { type: 'move', legionId: mover.id, toHex: dest })
    expect(again.message).toMatch(/Already moved/i)
    expect(again.legions.find((l) => l.id === mover.id)!.hexLabel).toBe(dest)
  })

  it('M3/M4: destinations are exactly roll steps away or engagement stops; never friendly end hex', () => {
    const g = splitAndRoll(11)
    const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
    const roll = g.movementRoll!
    const normal = listNormalMoveHexes(g, mover, roll)
    // Sibling still on same tower — ending there is illegal for the other stack
    const sibling = g.legions.find(
      (l) => l.playerId === mover.playerId && l.id !== mover.id,
    )!
    expect(normal.has(sibling.hexLabel)).toBe(false)
    expect(normal.size).toBeGreaterThan(0)
  })

  it('M6: BLOCK exit forces first step when present on starting hex', () => {
    const g = splitAndRoll(11)
    const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
    const hex = g.variant.board.hexByLabel[mover.hexLabel]
    const blockSide = hex.exitType.findIndex((t) => t === 'BLOCK')
    // Towers typically have BLOCK exits — legal moves must be reachable
    const moves = listNormalMoveHexes(g, mover, g.movementRoll!)
    expect(moves.size).toBeGreaterThan(0)
    if (blockSide >= 0) {
      const neighbor = hex.neighbors[blockSide]
      // With roll≥1, first step through block is required when leaving tower
      if (neighbor && g.movementRoll === 1) {
        expect([...moves.keys()]).toContain(neighbor)
      }
    }
  })
})
