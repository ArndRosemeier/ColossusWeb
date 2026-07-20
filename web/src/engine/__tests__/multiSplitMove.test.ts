import { describe, expect, it } from 'vitest'
import { dispatch, playerLegions } from '../GameEngine'
import { listAllMoves, listNormalMoveHexes } from '../movement'
import { twoPlayerGame } from './helpers'
import type { GameState, Legion } from '../types'

function cloneLegion(base: Legion, overrides: Partial<Legion>): Legion {
  return {
    ...base,
    creatures: base.creatures.map((c) => ({ ...c })),
    knownPublic: [...base.knownPublic],
    ...overrides,
  }
}

/** Two split pairs on different hexes, Move phase, fixed roll. */
function multiSplitState(roll: number): {
  g: GameState
  pairA: [Legion, Legion]
  pairB: [Legion, Legion]
} {
  const g = twoPlayerGame(7)
  const alice = g.players[0]!
  const template = g.legions.find((l) => l.playerId === alice.id)!
  const hexes = Object.keys(g.variant.board.hexByLabel).filter((h) => h !== template.hexLabel)
  const hexA = template.hexLabel
  const hexB = hexes[10]!

  // Replace Alice's opening stack with two pairs on hexA / hexB
  g.legions = g.legions.filter((l) => l.playerId !== alice.id)
  const mk = (id: string, marker: string, hex: string, split: boolean): Legion =>
    cloneLegion(template, {
      id,
      markerId: marker,
      hexLabel: hex,
      creatures: [
        { type: 'Ogre', hits: 0 },
        { type: 'Ogre', hits: 0 },
        { type: 'Centaur', hits: 0 },
        { type: 'Centaur', hits: 0 },
      ],
      moved: false,
      teleported: false,
      recruited: false,
      musteredThisTurn: null,
      splitThisTurn: split,
      enteredFrom: null,
      knownPublic: [],
    })

  const a1 = mk('a1', 'Rd01', hexA, true)
  const a2 = mk('a2', 'Rd02', hexA, false)
  const b1 = mk('b1', 'Rd03', hexB, true)
  const b2 = mk('b2', 'Rd04', hexB, false)
  g.legions.push(a1, a2, b1, b2)
  // Consume markers so pool stays consistent
  alice.markersAvailable = alice.markersAvailable.filter(
    (m) => !['Rd01', 'Rd02', 'Rd03', 'Rd04'].includes(m),
  )

  g.phase = 'Move'
  g.turnNumber = 3
  g.movementRoll = roll
  g.activePlayerIndex = 0
  g.splitSkipWarned = false
  for (const l of playerLegions(g, alice.id)) {
    l.splitThisTurn = false
    l.moved = false
  }

  return { g, pairA: [a1, a2], pairB: [b1, b2] }
}

describe('multi-split movement', () => {
  it('siblings on the same hex share identical destinations', () => {
    const { g, pairA, pairB } = multiSplitState(4)
    for (const [x, y] of [pairA, pairB]) {
      const mx = listNormalMoveHexes(g, x, 4)
      const my = listNormalMoveHexes(g, y, 4)
      expect([...mx.keys()].sort()).toEqual([...my.keys()].sort())
      expect(mx.size).toBeGreaterThan(0)
    }
  })

  it('moving one stack from pair A does not empty pair B destinations', () => {
    let { g, pairA, pairB } = multiSplitState(4)
    const before = listAllMoves(g, pairB[0], 4)
    expect(before.size).toBeGreaterThan(0)

    const dest = [...listAllMoves(g, pairA[0], 4).keys()][0]!
    g = dispatch(g, { type: 'move', legionId: pairA[0].id, toHex: dest })

    expect(listAllMoves(g, pairB[0], g.movementRoll!).size).toBeGreaterThan(0)
    expect(listAllMoves(g, pairB[1], g.movementRoll!).size).toBeGreaterThan(0)
    expect([...listAllMoves(g, pairB[0], g.movementRoll!).keys()].sort()).toEqual(
      [...listAllMoves(g, pairB[1], g.movementRoll!).keys()].sort(),
    )
  })

  it('after one sibling leaves, the remaining sibling still has moves (unless blocked)', () => {
    let { g, pairA } = multiSplitState(4)
    const before = listAllMoves(g, pairA[1], 4)
    expect(before.size).toBeGreaterThan(0)
    const dest = [...listAllMoves(g, pairA[0], 4).keys()][0]!
    g = dispatch(g, { type: 'move', legionId: pairA[0].id, toHex: dest })
    const after = listAllMoves(g, pairA[1], g.movementRoll!)
    // Remaining sibling must leave; dest taken by friend is excluded
    expect(after.has(dest)).toBe(false)
    // Usually still has other hexes on roll 4
    expect(after.size).toBeGreaterThan(0)
  })

  it('blocks Done while a second split pair is still stacked with conventional moves', () => {
    let { g, pairA, pairB } = multiSplitState(4)
    const dest = [...listAllMoves(g, pairA[0], 4).keys()][0]!
    g = dispatch(g, { type: 'move', legionId: pairA[0].id, toHex: dest })
    // Pair A is now unstacked (one left); pair B still stacked — Done must be refused
    const stuck = dispatch(g, { type: 'doneMove' })
    expect(stuck.phase).toBe('Move')
    expect(stuck.message).toMatch(/separate split/i)

    const destB = [...listAllMoves(stuck, pairB[0], stuck.movementRoll!).keys()].find(
      (h) => h !== dest,
    )!
    g = dispatch(stuck, { type: 'move', legionId: pairB[0].id, toHex: destB })
    // Both pairs now have a single legion remaining on their start hex — Done OK
    g = dispatch(g, { type: 'doneMove' })
    expect(g.phase).not.toBe('Move')
    expect(g.legions.filter((l) => l.playerId === g.players[0]!.id)).toHaveLength(4)
  })
})
