import { describe, expect, it } from 'vitest'
import { createGame } from '../../engine/GameEngine'
import type { GameState, Legion } from '../../engine/types'
import { loadNamedVariant } from '../../engine/__tests__/helpers'
import { estimateBattleOutcome } from '../battleEstimate'
import { buildSpatialCache, incomingThreatScore } from '../boardSpatial'
import { ABYSS_DEFENSE_FACTOR, isAntiTowerTerrain, legionCombatValue } from '../legionStrength'

function abyssalGame(): GameState {
  return createGame(loadNamedVariant('Abyssal6'), {
    players: [
      { name: 'Alice', kind: 'human' },
      { name: 'Bob', kind: 'human' },
    ],
    seed: 1,
  })
}

function hexOf(g: GameState, terrain: string): string {
  return Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === terrain)!.label
}

function centaurs(g: GameState, playerIndex: number, n: number, hexLabel: string, titan = false): Legion {
  const base = g.legions.find((l) => l.playerId === g.players[playerIndex]!.id)!
  const creatures = Array.from({ length: n }, () => ({ type: 'Centaur', hits: 0 }))
  if (titan) creatures.unshift({ type: 'Titan', hits: 0 })
  return { ...base, id: `p${playerIndex}-${hexLabel}`, hexLabel, creatures, moved: false }
}

describe('AI treats the Abyss as a poor place to defend', () => {
  it('flags Abyss (start list, no tower) but not Tower or Plains', () => {
    const v = loadNamedVariant('Abyssal6')
    expect(isAntiTowerTerrain(v, 'Abyss')).toBe(true)
    expect(isAntiTowerTerrain(v, 'Tower')).toBe(false)
    expect(isAntiTowerTerrain(v, 'Plains')).toBe(false)
  })

  it('weakens a defender in the Abyss but not an attacker', () => {
    const g = abyssalGame()
    const abyss = hexOf(g, 'Abyss')
    const plains = hexOf(g, 'Plains')
    const leg = centaurs(g, 0, 4, abyss)
    g.legions = [leg]
    const onPlains = legionCombatValue(g, leg, plains, 'defend')
    expect(legionCombatValue(g, leg, abyss, 'defend')).toBeCloseTo(onPlains * ABYSS_DEFENSE_FACTOR)
    expect(legionCombatValue(g, leg, abyss, 'attack')).toBeCloseTo(onPlains)
  })

  it('an even fight becomes a likely attacker win in the Abyss', () => {
    const g = abyssalGame()
    const abyss = hexOf(g, 'Abyss')
    const attacker = centaurs(g, 1, 4, abyss)
    const defender = centaurs(g, 0, 4, abyss)
    g.legions = [attacker, defender]
    const { outcome, ratio } = estimateBattleOutcome(g, attacker, defender, abyss)
    expect(ratio).toBeCloseTo(1 / ABYSS_DEFENSE_FACTOR)
    expect(outcome).toBe('winMinimal')
  })

  it('a Titan stack in the Abyss feels threatened by a reachable, slightly bigger enemy', () => {
    const g = abyssalGame()
    const abyss = g.variant.board.hexByLabel[hexOf(g, 'Abyss')]!
    const titan = centaurs(g, 0, 3, abyss.label, true)
    // Six Centaurs (72) vs Titan + three Centaurs (86) is a draw on open ground,
    // but a likely win against a defender stuck in the Abyss pit.
    const reaching = abyss.neighbors.filter((n): n is string => !!n).find((n) => {
      const enemy = centaurs(g, 1, 6, n)
      g.legions = [titan, enemy]
      return (buildSpatialCache(g).reachCounts.get(enemy.id)?.get(abyss.label) ?? 0) > 0
    })!
    expect(reaching).toBeTruthy()
    const enemy = centaurs(g, 1, 6, reaching)
    g.legions = [titan, enemy]
    expect(incomingThreatScore(g, titan, abyss.label, buildSpatialCache(g))).toBeGreaterThan(0)
  })
})
