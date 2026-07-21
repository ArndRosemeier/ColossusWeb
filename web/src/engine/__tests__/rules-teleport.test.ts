import { describe, expect, it } from 'vitest'
import { dispatch } from '../GameEngine'
import { listTeleportMoves } from '../movement'
import { turn1SplitChild, twoPlayerGame } from './helpers'
import type { GameState } from '../types'

function toMovePhase(seed: number): GameState {
  let g = twoPlayerGame(seed)
  const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
  g = dispatch(g, {
    type: 'split',
    parentId: parent.id,
    childCreatures: turn1SplitChild(g, parent),
  })
  return dispatch(g, { type: 'doneSplit' })
}

describe('rules-teleport', () => {
  it('T2: tower teleport available on roll 6 for a legion with a lord in a tower', () => {
    // Search a few seeds until movement roll is 6
    let found = false
    for (let seed = 1; seed < 80; seed++) {
      const g = toMovePhase(seed)
      if (g.movementRoll !== 6) continue
      const titanLeg = g.legions.find(
        (l) =>
          l.playerId === g.players[0].id &&
          l.creatures.some((c) => c.type === 'Titan'),
      )!
      const teles = listTeleportMoves(g, titanLeg, 6)
      expect(teles.size).toBeGreaterThan(0)
      found = true
      break
    }
    expect(found).toBe(true)
  })

  it('T2: no tower teleport without a lord', () => {
    let g = toMovePhase(1)
    // Force roll 6 by cloning path: find legion without lord after split
    const child = g.legions.find(
      (l) =>
        l.playerId === g.players[0].id &&
        !l.creatures.some((c) => g.variant.creatures[c.type]?.lord),
    )
    if (!child) return
    const teles = listTeleportMoves(g, child, 6)
    expect(teles.size).toBe(0)
  })

  it('T2: Guardian (demilord) alone does not grant tower teleport', () => {
    let g = toMovePhase(1)
    expect(g.variant.creatures.Guardian?.demilord).toBe(true)
    expect(g.variant.creatures.Guardian?.lord).toBeFalsy()
    const leg = g.legions.find((l) => l.playerId === g.players[0].id)!
    const elsewhere =
      Object.keys(g.variant.board.hexByLabel).find(
        (h) => !g.variant.board.towers.includes(h) && !g.legions.some((x) => x.hexLabel === h),
      ) ?? '1'
    for (const l of g.legions) {
      if (l.id !== leg.id) l.hexLabel = elsewhere
    }
    leg.creatures = [
      { type: 'Guardian', hits: 0 },
      { type: 'Ogre', hits: 0 },
      { type: 'Centaur', hits: 0 },
    ]
    leg.hexLabel = g.variant.board.towers[0]!
    expect(listTeleportMoves(g, leg, 6).size).toBe(0)
  })

  it('T2: Warlock (demilord) alone does not grant tower teleport', () => {
    let g = toMovePhase(1)
    expect(g.variant.creatures.Warlock?.demilord).toBe(true)
    expect(g.variant.creatures.Warlock?.lord).toBeFalsy()
    const leg = g.legions.find((l) => l.playerId === g.players[0].id)!
    const elsewhere =
      Object.keys(g.variant.board.hexByLabel).find(
        (h) => !g.variant.board.towers.includes(h) && !g.legions.some((x) => x.hexLabel === h),
      ) ?? '1'
    for (const l of g.legions) {
      if (l.id !== leg.id) l.hexLabel = elsewhere
    }
    leg.creatures = [
      { type: 'Warlock', hits: 0 },
      { type: 'Ogre', hits: 0 },
      { type: 'Centaur', hits: 0 },
    ]
    leg.hexLabel = g.variant.board.towers[0]!
    expect(listTeleportMoves(g, leg, 6).size).toBe(0)
  })

  it('T4: titan teleport requires score ≥ titanTeleport (Default 400)', () => {
    let g = toMovePhase(2)
    const titanLeg = g.legions.find(
      (l) =>
        l.playerId === g.players[0].id &&
        l.creatures.some((c) => c.type === 'Titan'),
    )!
    const player = g.players[0]
    expect(g.variant.data.titanTeleport).toBe(400)
    expect(player.score).toBe(0)
    expect(listTeleportMoves(g, titanLeg, 6).has(
      g.legions.find((l) => l.playerId !== player.id)!.hexLabel,
    )).toBe(false)

    player.score = 400
    player.titanPower = 6 + Math.floor(400 / (g.variant.data.titanImprove ?? 100))
    expect(player.titanPower).toBe(10)
    const enemyHex = g.legions.find((l) => l.playerId !== player.id)!.hexLabel
    expect(listTeleportMoves(g, titanLeg, 6).has(enemyHex)).toBe(true)
  })

  it('T1: only one teleport per player Movement Phase', () => {
    let found = false
    for (let seed = 1; seed < 100; seed++) {
      let g = toMovePhase(seed)
      if (g.movementRoll !== 6) continue
      const titanLeg = g.legions.find(
        (l) =>
          l.playerId === g.players[0].id &&
          l.creatures.some((c) => c.type === 'Titan'),
      )!
      const teles = [...listTeleportMoves(g, titanLeg, 6)]
      if (teles.length === 0) continue
      g = dispatch(g, {
        type: 'move',
        legionId: titanLeg.id,
        toHex: teles[0],
        teleport: true,
      })
      expect(g.players[0].hasTeleported).toBe(true)
      const other = g.legions.find(
        (l) => l.playerId === g.players[0].id && l.id !== titanLeg.id,
      )
      if (other) {
        expect(listTeleportMoves(g, other, 6).size).toBe(0)
      }
      g = dispatch(g, { type: 'undoMove', legionId: titanLeg.id })
      expect(g.players[0].hasTeleported).toBe(false)
      expect(g.legions.find((l) => l.id === titanLeg.id)!.teleported).toBe(false)
      found = true
      break
    }
    expect(found).toBe(true)
  })
})
