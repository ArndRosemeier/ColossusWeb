import { describe, expect, it } from 'vitest'
import { estimateBattleOutcome } from '../battleEstimate'
import { evaluateDestination, rankMoves } from '../evaluateMove'
import { AI_PROFILES } from '../profiles'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import type { Legion } from '../../engine/types'

function hexOfTerrain(state: ReturnType<typeof twoPlayerGame>, terrain: string): string {
  const hex = Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === terrain)
  if (!hex) throw new Error(`No ${terrain} hex`)
  return hex.label
}

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
    enteredFrom: null,
    knownPublic: partial.creatures.map((c) => c.type),
    ...partial,
  }
}

describe('battleEstimate', () => {
  it('strong stack vs weak is winMinimal', () => {
    const g = twoPlayerGame(1)
    const desert = hexOfTerrain(g, 'Desert')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0].id,
      hexLabel: desert,
      creatures: [
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Griffon', hits: 0 },
      ],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1].id,
      markerId: 'Bu01',
      hexLabel: desert,
      creatures: [{ type: 'Centaur', hits: 0 }],
    })
    g.legions = [atk, def]
    expect(estimateBattleOutcome(g, atk, def, desert).outcome).toBe('winMinimal')
  })

  it('weak vs strong is lose', () => {
    const g = twoPlayerGame(1)
    const plains = hexOfTerrain(g, 'Plains')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0].id,
      hexLabel: plains,
      creatures: [{ type: 'Centaur', hits: 0 }],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1].id,
      markerId: 'Bu01',
      hexLabel: plains,
      creatures: [
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Ranger', hits: 0 },
      ],
    })
    g.legions = [atk, def]
    expect(estimateBattleOutcome(g, atk, def, plains).outcome).toBe('lose')
  })
})

describe('evaluateDestination', () => {
  it('scores easy win much higher than suicidal attack', () => {
    const g = twoPlayerGame(1)
    const plains = hexOfTerrain(g, 'Plains')
    const strong = stubLegion({
      id: 'strong',
      playerId: g.players[0].id,
      hexLabel: plains,
      creatures: [
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Ranger', hits: 0 },
      ],
    })
    const weakEnemy = stubLegion({
      id: 'weak',
      playerId: g.players[1].id,
      markerId: 'Bu01',
      hexLabel: plains,
      creatures: [{ type: 'Ogre', hits: 0 }],
    })
    const weak = stubLegion({
      id: 'weakAtk',
      playerId: g.players[0].id,
      markerId: 'Rd02',
      hexLabel: plains,
      creatures: [{ type: 'Centaur', hits: 0 }],
    })
    const strongEnemy = stubLegion({
      id: 'strongDef',
      playerId: g.players[1].id,
      markerId: 'Bu02',
      hexLabel: plains,
      creatures: [
        { type: 'Hydra', hits: 0 },
        { type: 'Hydra', hits: 0 },
      ],
    })

    g.legions = [strong, weakEnemy]
    const winScore = evaluateDestination(g, strong, plains, AI_PROFILES.balanced)

    g.legions = [weak, strongEnemy]
    const loseScore = evaluateDestination(g, weak, plains, AI_PROFILES.balanced)

    expect(winScore).toBeGreaterThan(0)
    expect(loseScore).toBeLessThan(-1000)
    expect(winScore).toBeGreaterThan(loseScore)
  })

  it('prefers a Desert hex with Lion recruit over empty Plains when both empty', () => {
    const g = twoPlayerGame(1)
    const desert = hexOfTerrain(g, 'Desert')
    const plains = hexOfTerrain(g, 'Plains')
    const legion = stubLegion({
      id: 'lions',
      playerId: g.players[0].id,
      hexLabel: plains,
      creatures: [
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
      ],
    })
    g.legions = [legion, ...g.legions.filter((l) => l.playerId !== g.players[0].id)]
    const desertScore = evaluateDestination(g, legion, desert, AI_PROFILES.expander)
    const plainsScore = evaluateDestination(g, legion, plains, AI_PROFILES.expander)
    expect(desertScore).toBeGreaterThan(plainsScore)
  })

  it('rankMoves returns descending scores', () => {
    const g = twoPlayerGame(3)
    g.phase = 'Move'
    g.movementRoll = 3
    g.players[0].kind = 'ai'
    g.players[0].aiProfileId = 'balanced'
    const ranked = rankMoves(g, AI_PROFILES.balanced)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
    }
  })

  it('balanced prefers recruiting Lions over mopping a tiny enemy', () => {
    const g = twoPlayerGame(1)
    const desert = hexOfTerrain(g, 'Desert')
    const woods = hexOfTerrain(g, 'Woods')
    const playerId = g.players[0].id
    const legion = stubLegion({
      id: 'lions',
      playerId,
      hexLabel: desert,
      creatures: [
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
      ],
    })
    // Woods: no Lion muster, so attack score is pure fight EV
    const crumb = stubLegion({
      id: 'crumb',
      playerId: g.players[1].id,
      markerId: 'Bu01',
      hexLabel: woods,
      creatures: [{ type: 'Centaur', hits: 0 }],
    })
    g.legions = [legion, crumb]
    const recruitScore = evaluateDestination(g, legion, desert, AI_PROFILES.balanced)
    const attackScore = evaluateDestination(g, legion, woods, AI_PROFILES.balanced)
    expect(recruitScore).toBeGreaterThan(attackScore)

    const aggAttack = evaluateDestination(g, legion, woods, AI_PROFILES.aggressive)
    const balAttack = evaluateDestination(g, legion, woods, AI_PROFILES.balanced)
    expect(aggAttack).toBeGreaterThan(balAttack)
  })
})
