import { describe, expect, it } from 'vitest'
import {
  HOME_TURF_BONUS,
  TOWER_DEFENSE_FACTOR,
  creatureCombatValue,
  findBestBattleReinforce,
  findBestSummonable,
  isHomeTerrainCreature,
  legionCombatValue,
} from '../legionStrength'
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

describe('legionStrength', () => {
  it('marks Cyclops home on Jungle/Brush, not Plains', () => {
    const g = twoPlayerGame(1)
    expect(isHomeTerrainCreature(g.variant, 'Cyclops', 'Jungle')).toBe(true)
    expect(isHomeTerrainCreature(g.variant, 'Cyclops', 'Brush')).toBe(true)
    expect(isHomeTerrainCreature(g.variant, 'Cyclops', 'Plains')).toBe(false)
    expect(isHomeTerrainCreature(g.variant, 'Cyclops', 'Desert')).toBe(false)
  })

  it('Cyclops scores higher on Jungle/Brush than Plains', () => {
    const g = twoPlayerGame(1)
    const jungle = hexOfTerrain(g, 'Jungle')
    const brush = hexOfTerrain(g, 'Brush')
    const plains = hexOfTerrain(g, 'Plains')
    const onJungle = creatureCombatValue(g, 'Cyclops', jungle)
    const onBrush = creatureCombatValue(g, 'Cyclops', brush)
    const onPlains = creatureCombatValue(g, 'Cyclops', plains)
    expect(onJungle).toBe(onBrush)
    expect(onJungle).toBeGreaterThan(onPlains)
    expect(onJungle - onPlains).toBe(HOME_TURF_BONUS)
  })

  it('Lion scores higher on Desert than Plains; Plains has no home bonus', () => {
    const g = twoPlayerGame(1)
    const desert = hexOfTerrain(g, 'Desert')
    const plains = hexOfTerrain(g, 'Plains')
    const woods = hexOfTerrain(g, 'Woods')
    const onDesert = creatureCombatValue(g, 'Lion', desert)
    const onPlains = creatureCombatValue(g, 'Lion', plains)
    const onWoods = creatureCombatValue(g, 'Lion', woods)
    expect(onDesert).toBeGreaterThan(onPlains)
    expect(onPlains).toBe(onWoods)
    expect(isHomeTerrainCreature(g.variant, 'Lion', 'Plains')).toBe(false)
  })

  it('Tower defense inflate applies only when defending', () => {
    const g = twoPlayerGame(1)
    const playerId = g.players[0].id
    const tower = hexOfTerrain(g, 'Tower')
    const plains = hexOfTerrain(g, 'Plains')
    const legion = stubLegion({
      playerId,
      creatures: [
        { type: 'Ogre', hits: 0 },
        { type: 'Gargoyle', hits: 0 },
      ],
    })
    const defendTower = legionCombatValue(g, legion, tower, 'defend')
    const attackTower = legionCombatValue(g, legion, tower, 'attack')
    const defendPlains = legionCombatValue(g, legion, plains, 'defend')
    expect(defendTower).toBeGreaterThan(defendPlains)
    expect(defendTower).toBeCloseTo(attackTower * TOWER_DEFENSE_FACTOR)
    expect(attackTower).toBe(defendPlains)
  })

  it('Titan uses titanPower for combat value', () => {
    const g = twoPlayerGame(1)
    const plains = hexOfTerrain(g, 'Plains')
    const skill = g.variant.creatures.Titan.skill
    expect(creatureCombatValue(g, 'Titan', plains, 6)).toBe(6 * skill)
    expect(creatureCombatValue(g, 'Titan', plains, 12)).toBe(12 * skill)
    expect(creatureCombatValue(g, 'Titan', plains, 12)).toBeGreaterThan(
      creatureCombatValue(g, 'Titan', plains, 6),
    )
  })

  it('engagementExtras: attacker gains summonable from another legion', () => {
    const g = twoPlayerGame(1)
    const plains = hexOfTerrain(g, 'Plains')
    const playerId = g.players[0].id
    const attacker = stubLegion({
      id: 'atk',
      playerId,
      hexLabel: plains,
      creatures: [
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
      ],
    })
    const donor = stubLegion({
      id: 'donor',
      playerId,
      markerId: 'Rd02',
      hexLabel: hexOfTerrain(g, 'Woods'),
      creatures: [
        { type: 'Angel', hits: 0 },
        { type: 'Centaur', hits: 0 },
      ],
    })
    g.legions = [attacker, donor, ...g.legions.filter((l) => l.playerId !== playerId)]

    expect(findBestSummonable(g, attacker)?.creatureType).toBe('Angel')
    const base = legionCombatValue(g, attacker, plains, 'attack')
    const withSummon = legionCombatValue(g, attacker, plains, 'attack', {
      engagementExtras: true,
    })
    expect(withSummon).toBe(base + creatureCombatValue(g, 'Angel', plains))
  })

  it('engagementExtras: defender gains best battle reinforce', () => {
    const g = twoPlayerGame(1)
    const desert = hexOfTerrain(g, 'Desert')
    const playerId = g.players[0].id
    const defender = stubLegion({
      id: 'def',
      playerId,
      hexLabel: desert,
      creatures: [
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
      ],
    })
    g.legions = [defender, ...g.legions.filter((l) => l.playerId !== playerId)]

    expect(findBestBattleReinforce(g, defender, desert)).toBe('Griffon')
    const base = legionCombatValue(g, defender, desert, 'defend')
    const withReinforce = legionCombatValue(g, defender, desert, 'defend', {
      engagementExtras: true,
    })
    expect(withReinforce).toBe(base + creatureCombatValue(g, 'Griffon', desert))
  })

  it('engagementExtras: no summon when attacker is full; no reinforce when full', () => {
    const g = twoPlayerGame(1)
    const plains = hexOfTerrain(g, 'Plains')
    const playerId = g.players[0].id
    const full = stubLegion({
      id: 'full',
      playerId,
      hexLabel: plains,
      creatures: Array.from({ length: 7 }, () => ({ type: 'Ogre' as const, hits: 0 })),
    })
    const donor = stubLegion({
      id: 'donor',
      playerId,
      markerId: 'Rd02',
      hexLabel: hexOfTerrain(g, 'Woods'),
      creatures: [{ type: 'Angel', hits: 0 }],
    })
    g.legions = [full, donor]
    expect(findBestSummonable(g, full)).toBeNull()
    expect(findBestBattleReinforce(g, full, plains)).toBeNull()
  })
})
