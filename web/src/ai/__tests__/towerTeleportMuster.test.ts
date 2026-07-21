import { describe, expect, it } from 'vitest'
import { evaluateDestination, pickBestMove, rankMoves } from '../evaluateMove'
import { creatureCombatValue } from '../legionStrength'
import { AI_PROFILES } from '../profiles'
import { listAllMoves } from '../../engine/movement'
import { bestRecruitAt } from '../../engine/recruit'
import { twoPlayerGame, turn1SplitChild } from '../../engine/__tests__/helpers'
import { dispatch } from '../../engine/GameEngine'

function setupTitanSixInTower(alone: boolean) {
  let g = twoPlayerGame(1)
  const parent = g.legions.find((l) => l.playerId === g.players[0]!.id)!
  g = dispatch(g, {
    type: 'split',
    parentId: parent.id,
    childCreatures: turn1SplitChild(g, parent),
  })
  g = dispatch(g, { type: 'doneSplit' })
  g.phase = 'Move'
  g.movementRoll = 6
  g.players[0]!.kind = 'ai'
  g.players[0]!.aiProfileId = 'balanced'
  g.players[0]!.hasTeleported = false

  const titanLeg = g.legions.find(
    (l) => l.playerId === g.players[0]!.id && l.creatures.some((c) => c.type === 'Titan'),
  )!
  titanLeg.creatures = [
    { type: 'Titan', hits: 0 },
    { type: 'Angel', hits: 0 },
    { type: 'Ogre', hits: 0 },
    { type: 'Ogre', hits: 0 },
    { type: 'Centaur', hits: 0 },
    { type: 'Centaur', hits: 0 },
  ]
  titanLeg.moved = false
  titanLeg.teleported = false

  if (alone) {
    const sibling = g.legions.find(
      (l) => l.playerId === g.players[0]!.id && l.id !== titanLeg.id,
    )
    if (sibling) {
      const elsewhere = Object.keys(g.variant.board.hexByLabel).find(
        (h) => h !== titanLeg.hexLabel && !g.legions.some((l) => l.hexLabel === h),
      )
      sibling.hexLabel = elsewhere ?? sibling.hexLabel
      sibling.moved = true
    }
  }

  const emptyTowers = g.variant.board.towers.filter(
    (t) => t !== titanLeg.hexLabel && !g.legions.some((l) => l.hexLabel === t),
  )
  return { g, titanLeg, emptyTowers }
}

describe('tower teleport as normal move', () => {
  it('includes empty-tower teleports in listAllMoves with Warlock recruit', () => {
    const { g, titanLeg, emptyTowers } = setupTitanSixInTower(true)
    const moves = listAllMoves(g, titanLeg, 6)
    expect(emptyTowers.length).toBeGreaterThan(0)
    for (const t of emptyTowers) {
      expect(moves.get(t)?.teleport).toBe(true)
      expect(bestRecruitAt(g, titanLeg, t)).toBe('Warlock')
    }
  })

  it('scores a Warlock tower like any recruit destination (plus small location tiebreak)', () => {
    const { g, titanLeg, emptyTowers } = setupTitanSixInTower(true)
    const dest = emptyTowers[0]!
    const score = evaluateDestination(g, titanLeg, dest, AI_PROFILES.balanced)
    const warlock = Math.max(0, creatureCombatValue(g, 'Warlock', dest))
    const recruit = warlock * AI_PROFILES.balanced.recruitPreference
    // No teleport special — recruit dominates; location is only a small add-on.
    expect(score).toBeGreaterThan(recruit)
    expect(score - recruit).toBeLessThan(2)
  })

  it('alone on tower with a 6: tower teleports compete in rankMoves like walks', () => {
    const { g, titanLeg, emptyTowers } = setupTitanSixInTower(true)
    const ranked = rankMoves(g, AI_PROFILES.balanced)
    const towerTeleports = ranked.filter(
      (m) => m.legionId === titanLeg.id && m.teleport && emptyTowers.includes(m.hex),
    )
    expect(towerTeleports.length).toBe(emptyTowers.length)

    // Same scorer as walks: score equals evaluateDestination (no teleport bonus).
    for (const m of towerTeleports) {
      expect(m.score).toBeCloseTo(
        evaluateDestination(g, titanLeg, m.hex, AI_PROFILES.balanced),
        5,
      )
      expect(m.forcedSplit).toBe(false)
    }

    // pickBestMove takes the top-ranked option whether walk or teleport.
    const best = ranked[0]!
    const cmd = pickBestMove(g, AI_PROFILES.balanced, () => 0, false)
    expect(cmd).toEqual({
      type: 'move',
      legionId: best.legionId,
      toHex: best.hex,
      teleport: best.teleport,
    })
  })

  it('stacked on tower: teleports that leave the hex count as forced separation', () => {
    const { g, titanLeg, emptyTowers } = setupTitanSixInTower(false)
    const ranked = rankMoves(g, AI_PROFILES.balanced)
    const towerTeleports = ranked.filter(
      (m) => m.legionId === titanLeg.id && m.teleport && emptyTowers.includes(m.hex),
    )
    expect(towerTeleports.length).toBeGreaterThan(0)
    expect(towerTeleports.every((m) => m.forcedSplit)).toBe(true)
  })
})
