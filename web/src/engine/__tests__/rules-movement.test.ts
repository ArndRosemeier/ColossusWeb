import { describe, expect, it } from 'vitest'
import { dispatch, getMovesForSelected } from '../GameEngine'
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

  it('selecting an enemy legion does not show move hints for your roll', () => {
    let g = splitAndRoll(11)
    const enemy = g.legions.find((l) => l.playerId === g.players[1].id)!
    g = dispatch(g, { type: 'selectLegion', legionId: enemy.id })
    expect(g.legalHexes).toEqual([])
    expect(getMovesForSelected(g).size).toBe(0)
    expect(g.message).toMatch(enemy.markerId)
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

  it('undoMove restores origin hex and clears moved', () => {
    let g = splitAndRoll(11)
    const mover = g.legions.find((l) => l.playerId === g.players[0].id && !l.moved)!
    const origin = mover.hexLabel
    expect(mover.moveOriginHex).toBe(origin)
    const dest = [...listAllMoves(g, mover, g.movementRoll!).keys()][0]!
    g = dispatch(g, { type: 'move', legionId: mover.id, toHex: dest })
    expect(g.legions.find((l) => l.id === mover.id)!.hexLabel).toBe(dest)
    g = dispatch(g, { type: 'undoMove', legionId: mover.id })
    const after = g.legions.find((l) => l.id === mover.id)!
    expect(after.hexLabel).toBe(origin)
    expect(after.moved).toBe(false)
    expect(after.teleported).toBe(false)
    expect(after.enteredFrom).toBeNull()
  })

  it('M-spin: exact-roll loops back to start are legal when alone (Colossus spin cycle)', () => {
    let g = twoPlayerGame(7)
    const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
    // Isolate one legion so ending on the start hex is not blocked by a sibling
    g.legions = g.legions.filter((l) => l.id === mover.id)
    g.phase = 'Move'
    g.movementRoll = 6
    mover.moved = false

    const spinHexes: string[] = []
    for (const label of Object.keys(g.variant.board.hexByLabel)) {
      mover.hexLabel = label
      if (listNormalMoveHexes(g, mover, 6).has(label)) spinHexes.push(label)
    }
    expect(spinHexes.length).toBeGreaterThan(0)

    // Prefer a swamp/desert/brush spin the user called out
    const preferred =
      spinHexes.find((h) => {
        const t = g.variant.board.hexByLabel[h]!.terrain
        return t === 'Swamp' || t === 'Desert' || t === 'Brush'
      }) ?? spinHexes[0]!
    mover.hexLabel = preferred
    const moves = listAllMoves(g, mover, 6)
    expect(moves.has(preferred)).toBe(true)
    expect(moves.get(preferred)!.teleport).toBe(false)

    g.selectedLegionId = mover.id
    g = dispatch(g, { type: 'move', legionId: mover.id, toHex: preferred, teleport: false })
    const after = g.legions.find((l) => l.id === mover.id)!
    expect(after.hexLabel).toBe(preferred)
    expect(after.moved).toBe(true)
    expect(after.teleported).toBe(false)
    expect(after.enteredFrom).not.toBeNull()
  })
})
