import { describe, expect, it } from 'vitest'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import type { Legion } from '../../engine/types'
import {
  gateAwareSupportScore,
  incomingThreatScore,
  legalFirstExits,
  nextTurnOptionValue,
} from '../boardSpatial'
import { evaluateDestination, immediateHexValue, startExitCount } from '../evaluateMove'
import { AI_PROFILES } from '../profiles'

function stubLegion(partial: Partial<Legion> & Pick<Legion, 'playerId' | 'creatures'>): Legion {
  return {
    id: 'test-leg',
    markerId: 'Rd01',
    hexLabel: '100',
    moved: false,
    teleported: false,
    recruited: false,
    musteredThisTurn: null,
    splitThisTurn: false,
    splitParentId: null,
    moveOriginHex: null,
    enteredFrom: null,
    knownPublic: partial.creatures.map((c) => c.type),
    ...partial,
  }
}

describe('board spatial heuristics', () => {
  it('counts only legal first exits, not raw neighbors', () => {
    const g = twoPlayerGame(1)
    const hex = Object.values(g.variant.board.hexByLabel).find((h) => {
      const raw = h.neighbors.filter((n) => n != null).length
      return raw > legalFirstExits(h).length && legalFirstExits(h).length >= 1
    })
    expect(hex).toBeTruthy()
    expect(startExitCount(hex!)).toBe(legalFirstExits(hex!).length)
    expect(startExitCount(hex!)).toBeLessThan(hex!.neighbors.filter((n) => n != null).length)
  })

  it('scores support through a legal exit, not a blocked geometric neighbor', () => {
    const g = twoPlayerGame(1)
    const hex = Object.values(g.variant.board.hexByLabel).find((h) => {
      const legal = new Set(legalFirstExits(h))
      return h.neighbors.some((n) => n != null && !legal.has(n)) && legal.size > 0
    })
    expect(hex).toBeTruthy()
    const legalAdj = legalFirstExits(hex!)[0]!
    const blockedAdj = hex!.neighbors.find(
      (n) => n != null && !legalFirstExits(hex!).includes(n),
    )!
    const mover = stubLegion({
      id: 'mover',
      playerId: g.players[0].id,
      hexLabel: hex!.label,
      creatures: [{ type: 'Titan', hits: 0 }, { type: 'Centaur', hits: 0 }],
    })
    const ally = stubLegion({
      id: 'ally',
      playerId: g.players[0].id,
      markerId: 'Rd02',
      hexLabel: legalAdj,
      creatures: [{ type: 'Lion', hits: 0 }, { type: 'Lion', hits: 0 }, { type: 'Lion', hits: 0 }],
    })
    g.legions = [mover, ally]
    const viaGate = gateAwareSupportScore(g, mover, hex!.label)

    ally.hexLabel = blockedAdj
    const viaWall = gateAwareSupportScore(g, mover, hex!.label)
    expect(viaGate).toBeGreaterThan(0)
    expect(viaWall).toBe(0)
  })

  it('penalizes a hex a stronger enemy can reach, and more so for a Titan', () => {
    const g = twoPlayerGame(1)
    const dest = Object.values(g.variant.board.hexByLabel).find((h) => legalFirstExits(h).length > 0)!
    const from = legalFirstExits(dest)[0]!
    const prey = stubLegion({
      id: 'prey',
      playerId: g.players[0].id,
      hexLabel: dest.label,
      creatures: [{ type: 'Centaur', hits: 0 }, { type: 'Ogre', hits: 0 }],
    })
    const hunter = stubLegion({
      id: 'hunter',
      playerId: g.players[1].id,
      markerId: 'Bu01',
      hexLabel: from,
      creatures: [
        { type: 'Hydra', hits: 0 },
        { type: 'Hydra', hits: 0 },
        { type: 'Hydra', hits: 0 },
      ],
    })
    g.legions = [prey, hunter]
    const regular = incomingThreatScore(g, prey, dest.label)
    expect(regular).toBeGreaterThan(0)

    prey.creatures = [{ type: 'Titan', hits: 0 }, { type: 'Centaur', hits: 0 }]
    const titan = incomingThreatScore(g, prey, dest.label)
    expect(titan).toBeGreaterThan(regular)
  })

  it('prefers a hex with better next-turn musters over a one-exit pocket', () => {
    const g = twoPlayerGame(1)
    const tower = g.variant.board.towers[0]!
    const oneExit = Object.values(g.variant.board.hexByLabel).find(
      (h) => h.terrain !== 'Tower' && startExitCount(h) === 1,
    )
    expect(oneExit).toBeTruthy()
    const legion = stubLegion({
      id: 'mover',
      playerId: g.players[0].id,
      hexLabel: oneExit!.label,
      creatures: [{ type: 'Centaur', hits: 0 }, { type: 'Centaur', hits: 0 }],
    })
    g.legions = [legion]
    const leaf = (hex: string) => immediateHexValue(g, legion, hex, AI_PROFILES.balanced)
    const towerOpt = nextTurnOptionValue(g, legion, tower, leaf)
    const pocketOpt = nextTurnOptionValue(g, legion, oneExit!.label, leaf)
    expect(towerOpt).toBeGreaterThan(pocketOpt)
  })

  it('will skip a threatened muster hex when a safer one exists', () => {
    const g = twoPlayerGame(1)
    const deserts = Object.values(g.variant.board.hexByLabel).filter((h) => h.terrain === 'Desert')
    expect(deserts.length).toBeGreaterThanOrEqual(2)
    const safe = deserts[0]!
    const hot = deserts[1]!
    const exitIntoHot = legalFirstExits(hot)[0]
    expect(exitIntoHot).toBeTruthy()

    const lions = stubLegion({
      id: 'lions',
      playerId: g.players[0].id,
      hexLabel: safe.label,
      creatures: [{ type: 'Lion', hits: 0 }, { type: 'Lion', hits: 0 }],
    })
    const hydra = stubLegion({
      id: 'hydra',
      playerId: g.players[1].id,
      markerId: 'Bu01',
      hexLabel: exitIntoHot!,
      creatures: [
        { type: 'Hydra', hits: 0 },
        { type: 'Hydra', hits: 0 },
        { type: 'Hydra', hits: 0 },
      ],
    })
    g.legions = [lions, hydra]
    const safeScore = evaluateDestination(g, lions, safe.label, AI_PROFILES.balanced)
    const hotScore = evaluateDestination(g, lions, hot.label, AI_PROFILES.balanced)
    expect(safeScore).toBeGreaterThan(hotScore)
  })
})
