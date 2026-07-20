/**
 * Hazard combat modifiers — Colossus BattleStrike terrain / hexside rules.
 */
import { describe, expect, it } from 'vitest'
import { startBattle, battleLand } from '../battle'
import { getStrikeDice, getStrikeNumber } from '../battleStrike'
import { twoPlayerGame } from './helpers'
import type { Legion } from '../types'
import { evaluateBattleHex, expectedHits } from '../../ai/evaluateBattle'
import { AI_PROFILES } from '../../ai/profiles'

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
    splitParentId: null,
    moveOriginHex: null,
    enteredFrom: 'Bottom',
    knownPublic: partial.creatures.map((c) => c.type),
    ...partial,
  }
}

function findTerrainHex(land: ReturnType<typeof battleLand>, terrain: string): string {
  const label = land.labels.find((l) => land.hexByLabel[l]?.terrain === terrain)
  if (!label) throw new Error(`No ${terrain} hex on battleland`)
  return label
}

describe('hazard strike modifiers', () => {
  it('native Cyclops in Brambles is harder for a non-native to hit (+1 strike number)', () => {
    const g = twoPlayerGame(31)
    const brush = hexOfTerrain(g, 'Brush')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0]!.id,
      markerId: 'Rd01',
      hexLabel: brush,
      enteredFrom: 'Bottom',
      creatures: [{ type: 'Lion', hits: 0 }],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1]!.id,
      markerId: 'Bu01',
      hexLabel: brush,
      enteredFrom: null,
      creatures: [{ type: 'Cyclops', hits: 0 }],
    })
    g.legions = [atk, def]
    const battle = startBattle(g, atk, def, () => 0.5)
    g.battle = battle
    const land = battleLand(g, battle)
    const bramble = findTerrainHex(land, 'Brambles')
    const plains = findTerrainHex(land, 'Plains')

    const lion = battle.units.find((u) => u.creatureType === 'Lion')!
    const cyclops = battle.units.find((u) => u.creatureType === 'Cyclops')!

    // Keep attacker off Brambles so only defender terrain differs
    const plainsAdj = land.hexByLabel[plains]!.neighbors.find(
      (n) => n && land.hexByLabel[n]?.terrain === 'Plains',
    )
    const attackHex = plainsAdj ?? plains
    lion.hex = attackHex

    cyclops.hex = bramble
    const needVsNative = getStrikeNumber(g, lion, cyclops, land, true)

    cyclops.hex = plains
    const needVsPlains = getStrikeNumber(g, lion, cyclops, land, true)

    // Lion skill 3, Cyclops skill 2 → base need 3; bramble patriot +1 → 4
    expect(g.variant.creatures.Lion!.skill).toBe(3)
    expect(needVsPlains).toBe(3)
    expect(needVsNative).toBe(4)
  })

  it('non-native striking out of Brambles loses 1 attacker skill', () => {
    const g = twoPlayerGame(32)
    const brush = hexOfTerrain(g, 'Brush')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0]!.id,
      markerId: 'Rd01',
      hexLabel: brush,
      enteredFrom: 'Bottom',
      creatures: [{ type: 'Lion', hits: 0 }],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1]!.id,
      markerId: 'Bu01',
      hexLabel: brush,
      enteredFrom: null,
      creatures: [{ type: 'Ogre', hits: 0 }],
    })
    g.legions = [atk, def]
    const battle = startBattle(g, atk, def, () => 0.5)
    g.battle = battle
    const land = battleLand(g, battle)
    const bramble = findTerrainHex(land, 'Brambles')
    const plains = findTerrainHex(land, 'Plains')
    const lion = battle.units.find((u) => u.creatureType === 'Lion')!
    const ogre = battle.units.find((u) => u.creatureType === 'Ogre')!

    // Defender on plains so only attacker-hex hazard differs
    ogre.hex = plains

    lion.hex = bramble
    const fromBramble = getStrikeNumber(g, lion, ogre, land, true)

    lion.hex = plains
    const fromPlains = getStrikeNumber(g, lion, ogre, land, true)

    // Lion3 vs Ogre2 → plains need 3; from bramble atk skill -1 → need 4
    expect(fromPlains).toBe(3)
    expect(fromBramble).toBe(4)
  })

  it('AI prefers Brambles for Cyclops because expected enemy hits drop', () => {
    const g = twoPlayerGame(33)
    const brush = hexOfTerrain(g, 'Brush')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0]!.id,
      markerId: 'Rd01',
      hexLabel: brush,
      enteredFrom: 'Bottom',
      creatures: [{ type: 'Cyclops', hits: 0 }],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1]!.id,
      markerId: 'Bu01',
      hexLabel: brush,
      enteredFrom: null,
      creatures: [{ type: 'Lion', hits: 0 }],
    })
    g.legions = [atk, def]
    const battle = startBattle(g, atk, def, () => 0.5)
    g.battle = battle
    const land = battleLand(g, battle)
    const bramble = findTerrainHex(land, 'Brambles')
    const plains = findTerrainHex(land, 'Plains')
    const cyclops = battle.units.find((u) => u.creatureType === 'Cyclops')!
    const lion = battle.units.find((u) => u.creatureType === 'Lion')!

    // Attacker (Lion) stays on plains so strike-from penalty does not mask defense bonus
    lion.hex = plains
    lion.moved = true
    cyclops.moved = false

    cyclops.hex = plains
    const ehPlains = expectedHits(g, battle, lion, cyclops, true)
    cyclops.hex = bramble
    const ehBramble = expectedHits(g, battle, lion, cyclops, true)
    expect(ehBramble).toBeLessThan(ehPlains)

    // Same threat geometry for hex scoring: put Lion adjacent to both candidates
    const sharedEnemy = land.labels.find((l) => {
      const n = land.hexByLabel[l]?.neighbors ?? []
      return n.includes(bramble) && n.includes(plains)
    })
    if (sharedEnemy) {
      lion.hex = sharedEnemy
      const profile = AI_PROFILES.balanced
      const onBramble = evaluateBattleHex(g, battle, cyclops, bramble, profile)
      const onPlains = evaluateBattleHex(g, battle, cyclops, plains, profile)
      expect(onBramble).toBeGreaterThan(onPlains)
    }
  })
})

describe('hazard dice (volcano)', () => {
  it('native Dragon in Volcano gets +2 dice', () => {
    const g = twoPlayerGame(34)
    const mountains = hexOfTerrain(g, 'Mountains')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0]!.id,
      markerId: 'Rd01',
      hexLabel: mountains,
      enteredFrom: 'Bottom',
      creatures: [{ type: 'Dragon', hits: 0 }],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1]!.id,
      markerId: 'Bu01',
      hexLabel: mountains,
      enteredFrom: null,
      creatures: [{ type: 'Ogre', hits: 0 }],
    })
    g.legions = [atk, def]
    const battle = startBattle(g, atk, def, () => 0.5)
    g.battle = battle
    const land = battleLand(g, battle)
    const volcano = land.labels.find((l) => land.hexByLabel[l]?.terrain === 'Volcano')
    if (!volcano) {
      expect(land.labels.length).toBeGreaterThan(0) // map loaded; no volcano to assert
      return
    }
    const adj = land.hexByLabel[volcano]!.neighbors.find((n) => n != null)
    if (!adj) return
    const dragon = battle.units.find((u) => u.creatureType === 'Dragon')!
    const ogre = battle.units.find((u) => u.creatureType === 'Ogre')!
    dragon.hex = volcano
    ogre.hex = adj
    const dice = getStrikeDice(g, land, dragon, ogre, true)
    // +2 volcano native; may also get +1 for native slope down
    expect(dice).toBeGreaterThanOrEqual(9 + 2)
    expect(dice).toBeLessThanOrEqual(9 + 2 + 1)
  })
})
