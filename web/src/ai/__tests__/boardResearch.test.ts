import { describe, expect, it } from 'vitest'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import type { Legion } from '../../engine/types'
import { nextUpgradeTerrainValues, pipelineScore, titanDelegationPenalty } from '../boardResearch'
import { legalFirstExits } from '../boardSpatial'

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

describe('board research forks', () => {
  it('pipeline: 1 Ogre (short of Troll) values Marsh more than a Woods pocket', () => {
    const g = twoPlayerGame(1)
    const marsh = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Marsh')
    const woods = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Woods')
    expect(marsh && woods).toBeTruthy()
    const ogres = stubLegion({
      id: 'ogres',
      playerId: g.players[0].id,
      hexLabel: woods!.label,
      creatures: [{ type: 'Ogre', hits: 0 }],
    })
    g.legions = [ogres]
    const wanted = nextUpgradeTerrainValues(g, ogres)
    expect(wanted.get('Marsh') ?? 0).toBeGreaterThan(0)
    const isolated = Object.values(g.variant.board.hexByLabel).find((h) => {
      if (wanted.has(h.terrain)) return false
      const seen = new Set<string>([h.label])
      let frontier = [h.label]
      for (let d = 0; d < 3; d++) {
        const next: string[] = []
        for (const cur of frontier) {
          const hex = g.variant.board.hexByLabel[cur]
          if (!hex) continue
          if (d > 0 && wanted.has(hex.terrain)) return false
          for (const n of legalFirstExits(hex)) {
            if (seen.has(n)) continue
            seen.add(n)
            next.push(n)
          }
        }
        frontier = next
      }
      return true
    })
    expect(isolated).toBeTruthy()
    expect(pipelineScore(g, ogres, marsh!.label)).toBeGreaterThan(
      pipelineScore(g, ogres, isolated!.label),
    )
  })

  it('delegate: Titan pays a penalty when a friend can also win the fight this roll', () => {
    const g = twoPlayerGame(1)
    const dest = Object.values(g.variant.board.hexByLabel).find((h) => legalFirstExits(h).length > 0)!
    const from = legalFirstExits(dest)[0]!
    const titan = stubLegion({
      id: 'titan',
      playerId: g.players[0].id,
      hexLabel: from,
      creatures: [
        { type: 'Titan', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
      ],
    })
    const friend = stubLegion({
      id: 'friend',
      playerId: g.players[0].id,
      markerId: 'Rd02',
      hexLabel: from,
      creatures: [
        { type: 'Hydra', hits: 0 },
        { type: 'Hydra', hits: 0 },
        { type: 'Hydra', hits: 0 },
      ],
    })
    const crumb = stubLegion({
      id: 'crumb',
      playerId: g.players[1].id,
      markerId: 'Bu01',
      hexLabel: dest.label,
      creatures: [{ type: 'Centaur', hits: 0 }],
    })
    g.legions = [titan, friend, crumb]
    const penalty = titanDelegationPenalty(g, titan, dest.label, 1)
    expect(penalty).toBeGreaterThan(0)
    expect(titanDelegationPenalty(g, friend, dest.label, 1)).toBe(0)
  })
})
