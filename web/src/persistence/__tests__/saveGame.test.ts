import { describe, expect, it } from 'vitest'
import { dispatch } from '../../engine/GameEngine'
import { listAllMoves } from '../../engine/movement'
import { turn1SplitChild, twoPlayerGame } from '../../engine/__tests__/helpers'
import { deserializeGame, serializeGame } from '../saveGame'

describe('saveGame', () => {
  it('round-trips game state without the variant payload', () => {
    let g = twoPlayerGame(42)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
    const dest = [...listAllMoves(g, mover, g.movementRoll!).keys()][0]
    g = dispatch(g, { type: 'move', legionId: mover.id, toHex: dest })

    const blob = serializeGame(g)
    expect(blob.version).toBe(1)
    expect(blob.variantName).toBe('Default')
    expect(blob.state).not.toHaveProperty('variant')
    expect(blob.state.legions).toHaveLength(g.legions.length)
    expect(blob.state.phase).toBe(g.phase)

    const restored = deserializeGame(blob, g.variant)
    expect(restored.phase).toBe(g.phase)
    expect(restored.turnNumber).toBe(g.turnNumber)
    expect(restored.movementRoll).toBe(g.movementRoll)
    expect(restored.legions).toEqual(g.legions)
    expect(restored.players.map((p) => p.name)).toEqual(g.players.map((p) => p.name))
    expect(restored.caretaker).toEqual(g.caretaker)
    expect(restored.variant).toBe(g.variant)
  })
})
