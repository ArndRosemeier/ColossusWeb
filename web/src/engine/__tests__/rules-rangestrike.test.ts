/**
 * Titan rangestrike distance: count own hex + target + intervening (adjacent = 2).
 * Skill 3 (Gorgon) max = range 3; skill 4 (Ranger) max = 4 with −1 skill only at 4.
 */
import { describe, expect, it } from 'vitest'
import { startBattle, battleLand } from '../battle'
import {
  getAttackerSkill,
  getUnitPower,
  getUnitSkill,
  hexDistance,
  isUnitAlive,
  legalStrikes,
  titanRange,
} from '../battleStrike'
import { twoPlayerGame } from './helpers'
import type { BattleUnit, GameState, Legion } from '../types'

function hexOfMasterTerrain(state: GameState, terrain: string): string {
  const hex = Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === terrain)
  if (!hex) throw new Error(`No master ${terrain} hex`)
  return hex.label
}

function stubLegion(partial: Partial<Legion> & Pick<Legion, 'playerId' | 'creatures'>): Legion {
  return {
    id: 'test-leg',
    markerId: 'Rd01',
    hexLabel: '100',
    knownPublic: [],
    moved: false,
    teleported: false,
    recruited: false,
    musteredThisTurn: null,
    splitThisTurn: false,
    splitParentId: null,
    moveOriginHex: null,
    enteredFrom: null,
    ...partial,
  }
}

function unit(
  partial: Partial<BattleUnit> & Pick<BattleUnit, 'creatureType' | 'playerId'>,
): BattleUnit {
  return {
    id: partial.id ?? `${partial.creatureType}-${partial.playerId}`,
    legionId: partial.legionId ?? 'L',
    hits: partial.hits ?? 0,
    hex: partial.hex ?? null,
    struck: false,
    moved: false,
    ...partial,
  }
}

function battleOn(masterTerrain: string, atkTypes: string[], defTypes: string[]) {
  const g = twoPlayerGame(40 + masterTerrain.length)
  const label = hexOfMasterTerrain(g, masterTerrain)
  const atk = stubLegion({
    id: 'atk',
    playerId: g.players[0]!.id,
    markerId: 'Rd01',
    hexLabel: label,
    enteredFrom: 'Bottom',
    creatures: atkTypes.map((type) => ({ type, hits: 0 })),
  })
  const def = stubLegion({
    id: 'def',
    playerId: g.players[1]!.id,
    markerId: 'Bu01',
    hexLabel: label,
    enteredFrom: null,
    creatures: defTypes.map((type) => ({ type, hits: 0 })),
  })
  g.legions = [atk, def]
  const battle = startBattle(g, atk, def, () => 0.5)
  g.battle = battle
  return { g, battle, land: battleLand(g, battle) }
}

function findAtRange(
  land: ReturnType<typeof battleLand>,
  from: string,
  want: number,
): string {
  const label = land.labels.find((l) => titanRange(land, from, l) === want)
  if (!label) throw new Error(`No hex at Titan range ${want} from ${from}`)
  return label
}

describe('Titan rangestrike range counting', () => {
  it('titanRange = hexDistance + 1 (adjacent = 2, one between = 3)', () => {
    const { land } = battleOn('Plains', ['Ranger'], ['Ogre'])
    const a = land.labels[0]!
    const adj = land.hexByLabel[a]!.neighbors.find((n) => n != null)!
    expect(hexDistance(land, a, adj)).toBe(1)
    expect(titanRange(land, a, adj)).toBe(2)
    const oneBetween = findAtRange(land, a, 3)
    expect(hexDistance(land, a, oneBetween)).toBe(2)
    expect(titanRange(land, a, oneBetween)).toBe(3)
  })

  it('Gorgon (skill 3): legal at Titan range 3, not at 4', () => {
    const { g, land } = battleOn('Plains', ['Gorgon'], ['Ogre'])
    expect(g.variant.creatures.Gorgon!.skill).toBe(3)
    expect(g.variant.creatures.Gorgon!.rangestrikes).toBe(true)

    const origin = land.labels.find((l) => !l.startsWith('X')) ?? land.labels[0]!
    const at3 = findAtRange(land, origin, 3)
    const at4 = findAtRange(land, origin, 4)
    const gorgon = unit({ creatureType: 'Gorgon', playerId: 'a', hex: origin })
    const ogre3 = unit({ id: 'ogre3', creatureType: 'Ogre', playerId: 'b', hex: at3 })
    const ogre4 = unit({ id: 'ogre4', creatureType: 'Ogre', playerId: 'b', hex: at4 })
    const battle = { units: [gorgon, ogre3, ogre4] }

    const targets = legalStrikes(g, battle, land, gorgon, true)
    expect(targets).toContain(ogre3.id)
    expect(targets).not.toContain(ogre4.id)
  })

  it('Ranger (skill 4): legal at Titan range 3 and 4; malus only at 4', () => {
    const { g, land } = battleOn('Plains', ['Ranger'], ['Ogre'])
    expect(g.variant.creatures.Ranger!.skill).toBe(4)

    const origin = land.labels.find((l) => !l.startsWith('X')) ?? land.labels[0]!
    const at3 = findAtRange(land, origin, 3)
    const at4 = findAtRange(land, origin, 4)
    const ranger = unit({ creatureType: 'Ranger', playerId: 'a', hex: origin })
    const ogre3 = unit({ id: 'ogre3', creatureType: 'Ogre', playerId: 'b', hex: at3 })
    const ogre4 = unit({ id: 'ogre4', creatureType: 'Ogre', playerId: 'b', hex: at4 })
    const battle = { units: [ranger, ogre3, ogre4] }

    const targets = legalStrikes(g, battle, land, ranger, true)
    expect(targets).toContain(ogre3.id)
    expect(targets).toContain(ogre4.id)

    const base = getUnitSkill(g, ranger)
    expect(getAttackerSkill(g, land, ranger, ogre3, false)).toBe(base)
    expect(getAttackerSkill(g, land, ranger, ogre4, false)).toBe(base - 1)
  })

  it('cannot rangestrike when adjacent (must melee) or locked in contact', () => {
    const { g, land } = battleOn('Plains', ['Ranger'], ['Ogre', 'Lion'])
    const origin = land.labels.find((l) => !l.startsWith('X')) ?? land.labels[0]!
    const adj = land.hexByLabel[origin]!.neighbors.find((n) => n != null)!
    const at3 = findAtRange(land, origin, 3)
    const ranger = unit({ creatureType: 'Ranger', playerId: 'a', hex: origin })
    const contact = unit({ id: 'contact', creatureType: 'Ogre', playerId: 'b', hex: adj })
    const far = unit({ id: 'far', creatureType: 'Lion', playerId: 'b', hex: at3 })
    const battle = { units: [ranger, contact, far] }

    const targets = legalStrikes(g, battle, land, ranger, true)
    expect(targets).toContain(contact.id)
    expect(targets).not.toContain(far.id)
  })

  it('K6: dead adjacent enemy still blocks rangestrike until removed after Strikeback', () => {
    // Colossus findTargetHexes: adjacentEnemy=true even if target.isDead().
    // Killing the engager earlier in the same Strike phase does not unlock rangestrike.
    const { g, land } = battleOn('Plains', ['Ranger'], ['Ogre', 'Lion'])
    const origin = land.labels.find((l) => !l.startsWith('X')) ?? land.labels[0]!
    const adj = land.hexByLabel[origin]!.neighbors.find((n) => n != null)!
    const at3 = findAtRange(land, origin, 3)
    const ranger = unit({ creatureType: 'Ranger', playerId: 'a', hex: origin })
    const corpse = unit({ id: 'corpse', creatureType: 'Ogre', playerId: 'b', hex: adj })
    const far = unit({ id: 'far', creatureType: 'Lion', playerId: 'b', hex: at3 })
    corpse.hits = getUnitPower(g, corpse)
    expect(isUnitAlive(g, corpse)).toBe(false)

    const targets = legalStrikes(g, { units: [ranger, corpse, far] }, land, ranger, true)
    expect(targets).not.toContain(far.id)
    expect(targets).not.toContain(corpse.id)
  })

  it('only Warlock may rangestrike Lords; demilords are fair game', () => {
    const { g, land } = battleOn('Plains', ['Ranger', 'Warlock'], ['Angel', 'Guardian', 'Ogre'])
    expect(g.variant.creatures.Angel!.lord).toBe(true)
    expect(g.variant.creatures.Guardian!.demilord).toBe(true)
    expect(g.variant.creatures.Warlock!.magicMissile).toBe(true)

    const origin = land.labels.find((l) => !l.startsWith('X')) ?? land.labels[0]!
    const at3 = findAtRange(land, origin, 3)
    const ranger = unit({ creatureType: 'Ranger', playerId: 'a', hex: origin })
    const warlock = unit({
      id: 'warlock-a',
      creatureType: 'Warlock',
      playerId: 'a',
      hex: origin,
    })
    const angel = unit({ id: 'angel', creatureType: 'Angel', playerId: 'b', hex: at3 })
    const guardian = unit({
      id: 'guardian',
      creatureType: 'Guardian',
      playerId: 'b',
      hex: at3,
    })
    const ogre = unit({ id: 'ogre', creatureType: 'Ogre', playerId: 'b', hex: at3 })

    expect(legalStrikes(g, { units: [ranger, angel] }, land, ranger, true)).not.toContain(
      angel.id,
    )
    expect(legalStrikes(g, { units: [ranger, guardian] }, land, ranger, true)).toContain(
      guardian.id,
    )
    expect(legalStrikes(g, { units: [ranger, ogre] }, land, ranger, true)).toContain(ogre.id)
    expect(legalStrikes(g, { units: [warlock, angel] }, land, warlock, true)).toContain(
      angel.id,
    )
  })

  it('LOS: Tree on the only intervening hex blocks Ranger; Warlock ignores', () => {
    const nothing = Array(6).fill('nothing') as (
      | 'nothing'
      | 'dune'
      | 'cliff'
      | 'slope'
      | 'tower'
      | 'river'
    )[]
    // Linear A — B(Tree) — C
    const hexA = {
      label: 'A',
      x: 0,
      y: 0,
      terrain: 'Plains',
      elevation: 0,
      hexsides: [...nothing] as typeof nothing,
      neighbors: ['B', null, null, null, null, null] as (string | null)[],
    }
    const hexB = {
      label: 'B',
      x: 1,
      y: 0,
      terrain: 'Tree',
      elevation: 0,
      hexsides: [...nothing] as typeof nothing,
      neighbors: ['C', null, null, 'A', null, null] as (string | null)[],
    }
    const hexC = {
      label: 'C',
      x: 2,
      y: 0,
      terrain: 'Plains',
      elevation: 0,
      hexsides: [...nothing] as typeof nothing,
      neighbors: [null, null, null, 'B', null, null] as (string | null)[],
    }
    const land = {
      terrain: 'Test',
      tower: false,
      hexByLabel: { A: hexA, B: hexB, C: hexC },
      labels: ['A', 'B', 'C'],
      startlist: [],
      entrances: {
        Bottom: [],
        Left: [],
        Right: [],
        Top: [],
        LeftDefense: [],
        RightDefense: [],
      },
    } as ReturnType<typeof import('../battleland').buildBattleland>

    const g = twoPlayerGame(99)
    const ranger = unit({ creatureType: 'Ranger', playerId: 'a', hex: 'A' })
    const warlock = unit({ id: 'wl', creatureType: 'Warlock', playerId: 'a', hex: 'A' })
    const ogre = unit({ creatureType: 'Ogre', playerId: 'b', hex: 'C' })
    expect(titanRange(land, 'A', 'C')).toBe(3)
    expect(legalStrikes(g, { units: [ranger, ogre] }, land, ranger, true)).not.toContain(ogre.id)
    expect(legalStrikes(g, { units: [warlock, ogre] }, land, warlock, true)).toContain(ogre.id)
  })
})
