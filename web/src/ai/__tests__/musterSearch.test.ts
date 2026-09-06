import { describe, expect, it } from 'vitest'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import type { Legion } from '../../engine/types'
import { legalFirstExits } from '../boardSpatial'
import { expectedFutureMuster, lookaheadMusterBonus } from '../musterSearch'
import { positiveFightValue } from '../evaluateMove'
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

describe('muster lookahead', () => {
  it('values a Desert more than an isolated Woods for 2 Lions (Griffon path)', () => {
    const g = twoPlayerGame(1)
    const desert = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Desert')!
    const woods = Object.values(g.variant.board.hexByLabel).find((h) => {
      if (h.terrain !== 'Woods') return false
      const seen = new Set<string>([h.label])
      let frontier = [h.label]
      for (let d = 0; d < 3; d++) {
        const next: string[] = []
        for (const cur of frontier) {
          const hex = g.variant.board.hexByLabel[cur]
          if (!hex) continue
          if (hex.terrain === 'Desert') return false
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
    expect(woods).toBeTruthy()
    const lions = stubLegion({
      id: 'lions',
      playerId: g.players[0].id,
      hexLabel: desert.label,
      creatures: [{ type: 'Lion', hits: 0 }, { type: 'Lion', hits: 0 }],
    })
    g.legions = [lions]
    const desertEv = lookaheadMusterBonus(g, lions, desert.label, AI_PROFILES.expander)
    const woodsEv = lookaheadMusterBonus(g, lions, woods!.label, AI_PROFILES.expander)
    expect(desertEv).toBeGreaterThan(woodsEv)
    expect(desertEv).toBeGreaterThan(0)
  })

  it('grows the stack: 3 Lions expect more next-muster than 2 Lions on Desert', () => {
    const g = twoPlayerGame(1)
    const desert = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Desert')!
    const two = stubLegion({
      id: 'two',
      playerId: g.players[0].id,
      hexLabel: desert.label,
      creatures: [{ type: 'Lion', hits: 0 }, { type: 'Lion', hits: 0 }],
    })
    const three = stubLegion({
      id: 'three',
      playerId: g.players[0].id,
      markerId: 'Rd02',
      hexLabel: desert.label,
      creatures: [
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
      ],
    })
    g.legions = [two]
    const twoEv = expectedFutureMuster(g, two, desert.label, AI_PROFILES.expander, 1)
    g.legions = [three]
    const threeEv = expectedFutureMuster(g, three, desert.label, AI_PROFILES.expander, 1)
    expect(threeEv).toBeGreaterThan(twoEv)
  })

  it('lookfight counts a winning fight that muster-only skips', () => {
    const g = twoPlayerGame(1)
    const dest = Object.values(g.variant.board.hexByLabel).find((h) => legalFirstExits(h).length > 0)!
    const from = legalFirstExits(dest)[0]!
    const lions = stubLegion({
      id: 'lions',
      playerId: g.players[0].id,
      hexLabel: from,
      creatures: [
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Ranger', hits: 0 },
      ],
    })
    const crumb = stubLegion({
      id: 'crumb',
      playerId: g.players[1].id,
      markerId: 'Bu01',
      hexLabel: dest.label,
      creatures: [{ type: 'Centaur', hits: 0 }],
    })
    g.legions = [lions, crumb]
    const musterOnly = expectedFutureMuster(g, lions, from, AI_PROFILES.aggressive, 1)
    const withFights = expectedFutureMuster(g, lions, from, AI_PROFILES.aggressive, 1, {
      fightValue: (st, lg, hex) => positiveFightValue(st, lg, hex, AI_PROFILES.aggressive),
    })
    expect(withFights).toBeGreaterThan(musterOnly)
  })
})
