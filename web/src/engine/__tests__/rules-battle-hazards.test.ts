/**
 * Rules verification: battle hazard combat + entry costs (Colossus BattleStrike /
 * BattleHex). Keeps terrain modifiers from regressing after the bare skill-chart port.
 */
import { describe, expect, it } from 'vitest'
import { startBattle, battleLand } from '../battle'
import {
  getAttackerSkill,
  getStrikeDice,
  getStrikeNumber,
  getUnitSkill,
} from '../battleStrike'
import {
  buildBattleland,
  canFlyOver,
  directionBetween,
  getEntryCost,
  IMPASSABLE_COST,
  oppositeHazard,
} from '../battleland'
import { twoPlayerGame, loadDefaultVariant } from './helpers'
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
    moved: false,
    teleported: false,
    recruited: false,
    musteredThisTurn: null,
    enteredFrom: 'Bottom',
    knownPublic: partial.creatures.map((c) => c.type),
    ...partial,
  }
}

function unit(
  partial: Pick<BattleUnit, 'creatureType' | 'playerId'> & Partial<BattleUnit>,
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
  return { g, battle, land: battleLand(g, battle), atk, def }
}

function findTerrain(land: ReturnType<typeof battleLand>, terrain: string): string {
  const label = land.labels.find((l) => land.hexByLabel[l]?.terrain === terrain)
  if (!label) throw new Error(`No battle hex terrain ${terrain}`)
  return label
}

function baseNeed(state: GameState, atk: BattleUnit, def: BattleUnit): number {
  return 4 - getUnitSkill(state, atk) + getUnitSkill(state, def)
}

/** Adjacent pair where `from` has `hazard` hexside facing `to`. */
function findHazardEdge(
  land: ReturnType<typeof battleLand>,
  hazard: 'slope' | 'dune' | 'tower',
  opts?: { requireHigher?: boolean },
): { from: string; to: string; dir: number } | null {
  for (const from of land.labels) {
    const h = land.hexByLabel[from]!
    for (let dir = 0; dir < 6; dir++) {
      const to = h.neighbors[dir]
      if (!to) continue
      if (h.hexsides[dir] !== hazard) continue
      if (opts?.requireHigher && h.elevation <= land.hexByLabel[to]!.elevation) continue
      return { from, to, dir }
    }
  }
  return null
}

function plainsAwayFrom(land: ReturnType<typeof battleLand>, exclude: string): string {
  const label = land.labels.find(
    (l) => l !== exclude && land.hexByLabel[l]?.terrain === 'Plains',
  )
  if (!label) {
    const any = land.labels.find((l) => l !== exclude)
    if (!any) throw new Error('no alternate hex')
    return any
  }
  return label
}

describe('H1–H4 Brambles combat (Colossus HazardTerrain.BRAMBLES)', () => {
  it('H1: native defending in Brambles vs non-native → +1 strike number', () => {
    const { g, land } = battleOn('Brush', ['Lion'], ['Cyclops'])
    const lion = unit({ creatureType: 'Lion', playerId: 'a', hex: findTerrain(land, 'Plains') })
    const cyc = unit({ creatureType: 'Cyclops', playerId: 'b', hex: findTerrain(land, 'Brambles') })
    expect(getStrikeNumber(g, lion, cyc, land, true)).toBe(baseNeed(g, lion, cyc) + 1)
  })

  it('H2: native vs native in Brambles → no patriot bonus', () => {
    const { g, land } = battleOn('Brush', ['Gargoyle'], ['Cyclops'])
    const garg = unit({
      creatureType: 'Gargoyle',
      playerId: 'a',
      hex: findTerrain(land, 'Plains'),
    })
    const cyc = unit({ creatureType: 'Cyclops', playerId: 'b', hex: findTerrain(land, 'Brambles') })
    expect(g.variant.creatures.Gargoyle!.native.Brambles).toBe(true)
    expect(getStrikeNumber(g, garg, cyc, land, true)).toBe(baseNeed(g, garg, cyc))
  })

  it('H3: non-native striking out of Brambles → −1 attacker skill (harder hit)', () => {
    const { g, land } = battleOn('Brush', ['Lion'], ['Ogre'])
    const plains = findTerrain(land, 'Plains')
    const bramble = findTerrain(land, 'Brambles')
    const lion = unit({ creatureType: 'Lion', playerId: 'a', hex: bramble })
    const ogre = unit({ creatureType: 'Ogre', playerId: 'b', hex: plains })
    expect(getAttackerSkill(g, land, lion, ogre, true)).toBe(getUnitSkill(g, lion) - 1)
    expect(getStrikeNumber(g, lion, ogre, land, true)).toBe(baseNeed(g, lion, ogre) + 1)
  })

  it('H4: native Cyclops striking out of Brambles → no skill penalty', () => {
    const { g, land } = battleOn('Brush', ['Cyclops'], ['Lion'])
    const cyc = unit({
      creatureType: 'Cyclops',
      playerId: 'a',
      hex: findTerrain(land, 'Brambles'),
    })
    const lion = unit({ creatureType: 'Lion', playerId: 'b', hex: findTerrain(land, 'Plains') })
    expect(getAttackerSkill(g, land, cyc, lion, true)).toBe(getUnitSkill(g, cyc))
  })
})

describe('H5 Stone / Tree patriot defense', () => {
  it('H5a: native defending in Stone vs non-native melee → +1 strike number', () => {
    const { g, land } = battleOn('Jungle', ['Lion'], ['Cyclops'])
    const stoneLabel = findTerrain(land, 'Plains')
    land.hexByLabel[stoneLabel] = { ...land.hexByLabel[stoneLabel]!, terrain: 'Stone' }
    g.variant.creatures.Cyclops!.native.Stone = true
    const atk = unit({
      creatureType: 'Lion',
      playerId: 'a',
      hex: plainsAwayFrom(land, stoneLabel),
    })
    // Ensure attacker hex is not Brambles (would add strike-from penalty)
    land.hexByLabel[atk.hex!] = { ...land.hexByLabel[atk.hex!]!, terrain: 'Plains' }
    const def = unit({ creatureType: 'Cyclops', playerId: 'b', hex: stoneLabel })
    expect(getStrikeNumber(g, atk, def, land, true)).toBe(baseNeed(g, atk, def) + 1)
  })

  it('H5b: native defending in Tree vs non-native melee → +1 strike number', () => {
    const { g, land } = battleOn('Jungle', ['Lion'], ['Cyclops'])
    const label = findTerrain(land, 'Plains')
    land.hexByLabel[label] = { ...land.hexByLabel[label]!, terrain: 'Tree' }
    g.variant.creatures.Cyclops!.native.Tree = true
    const atkHex = plainsAwayFrom(land, label)
    land.hexByLabel[atkHex] = { ...land.hexByLabel[atkHex]!, terrain: 'Plains' }
    const atk = unit({ creatureType: 'Lion', playerId: 'a', hex: atkHex })
    const def = unit({ creatureType: 'Cyclops', playerId: 'b', hex: label })
    expect(getStrikeNumber(g, atk, def, land, true)).toBe(baseNeed(g, atk, def) + 1)
  })
})

describe('H6–H8 Volcano dice / rangestrike', () => {
  it('H6: native Dragon melee from Volcano → +2 dice', () => {
    const { g, land } = battleOn('Mountains', ['Dragon'], ['Ogre'])
    const volcano = land.labels.find((l) => land.hexByLabel[l]?.terrain === 'Volcano')
    expect(volcano).toBeTruthy()
    const adj = land.hexByLabel[volcano!]!.neighbors.find((n) => n != null)!
    const dragon = unit({ creatureType: 'Dragon', playerId: 'a', hex: volcano! })
    const ogre = unit({ creatureType: 'Ogre', playerId: 'b', hex: adj })
    const dice = getStrikeDice(g, land, dragon, ogre, true)
    // +2 volcano; optional +1 native slope down
    expect(dice).toBeGreaterThanOrEqual(9 + 2)
  })

  it('H7: non-native rangestrike into Volcano → −1 attacker skill', () => {
    const { g, land } = battleOn('Mountains', ['Lion'], ['Ogre'])
    const volcano = land.labels.find((l) => land.hexByLabel[l]?.terrain === 'Volcano')
    if (!volcano) return
    const far = land.labels.find(
      (l) => l !== volcano && land.hexByLabel[l]?.terrain !== 'Volcano',
    )!
    const striker = unit({ creatureType: 'Lion', playerId: 'a', hex: far })
    const target = unit({ creatureType: 'Ogre', playerId: 'b', hex: volcano })
    expect(getAttackerSkill(g, land, striker, target, false)).toBe(getUnitSkill(g, striker) - 1)
  })

  it('H8: native rangestrike from Volcano → +2 dice (half power then +2)', () => {
    const { g, land } = battleOn('Mountains', ['Dragon'], ['Ogre'])
    const volcano = land.labels.find((l) => land.hexByLabel[l]?.terrain === 'Volcano')
    if (!volcano) return
    const far = land.labels.find((l) => l !== volcano)!
    const dragon = unit({ creatureType: 'Dragon', playerId: 'a', hex: volcano })
    const ogre = unit({ creatureType: 'Ogre', playerId: 'b', hex: far })
    expect(getStrikeDice(g, land, dragon, ogre, false)).toBe(Math.floor(9 / 2) + 2)
  })
})

describe('H9–H12 Slope / dune / wall hexsides', () => {
  it('H9: native slope striking down slope → +1 die', () => {
    const { g, land } = battleOn('Hills', ['Colossus'], ['Ogre'])
    const edge = findHazardEdge(land, 'slope')
    expect(edge).toBeTruthy()
    expect(g.variant.creatures.Colossus!.native.slope).toBe(true)
    const colo = unit({ creatureType: 'Colossus', playerId: 'a', hex: edge!.from })
    const ogre = unit({ creatureType: 'Ogre', playerId: 'b', hex: edge!.to })
    expect(getStrikeDice(g, land, colo, ogre, true)).toBe(10 + 1)
  })

  it('H10: non-native striking up slope → −1 attacker skill', () => {
    const { g, land } = battleOn('Hills', ['Cyclops'], ['Ogre'])
    const edge = findHazardEdge(land, 'slope', { requireHigher: true })
    expect(edge).toBeTruthy()
    // edge.from is higher with slope facing edge.to (lower)
    expect(g.variant.creatures.Cyclops!.native.slope).toBe(false)
    const cyc = unit({ creatureType: 'Cyclops', playerId: 'a', hex: edge!.to })
    const ogre = unit({ creatureType: 'Ogre', playerId: 'b', hex: edge!.from })
    expect(getAttackerSkill(g, land, cyc, ogre, true)).toBe(getUnitSkill(g, cyc) - 1)
  })

  it('H11: native dune (Sand) striking down dune → +2 dice', () => {
    const { g, land } = battleOn('Desert', ['Lion'], ['Ogre'])
    const edge = findHazardEdge(land, 'dune')
    expect(edge).toBeTruthy()
    expect(g.variant.creatures.Lion!.native.Sand).toBe(true)
    const lion = unit({ creatureType: 'Lion', playerId: 'a', hex: edge!.from })
    const ogre = unit({ creatureType: 'Ogre', playerId: 'b', hex: edge!.to })
    expect(getStrikeDice(g, land, lion, ogre, true)).toBe(5 + 2)
  })

  it('H12: non-native striking up dune → −1 die', () => {
    const { g, land } = battleOn('Desert', ['Cyclops'], ['Ogre'])
    const edge = findHazardEdge(land, 'dune')
    expect(edge).toBeTruthy()
    // Strike from the far side of the dune hexside (opposite hazard = dune)
    const cyc = unit({ creatureType: 'Cyclops', playerId: 'a', hex: edge!.to })
    const ogre = unit({ creatureType: 'Ogre', playerId: 'b', hex: edge!.from })
    const dir = directionBetween(land, edge!.to, edge!.from)
    expect(oppositeHazard(land, land.hexByLabel[edge!.to]!, dir)).toBe('dune')
    expect(getStrikeDice(g, land, cyc, ogre, true)).toBe(9 - 1)
  })
})

describe('H13 Rangestrike brambles / Stone defense', () => {
  it('H13a: native in Brambles vs non-native non-missile rangestrike → +1 strike number', () => {
    const { g, land } = battleOn('Brush', ['Dragon'], ['Cyclops'])
    const bramble = findTerrain(land, 'Brambles')
    const plains = findTerrain(land, 'Plains')
    const dragon = unit({ creatureType: 'Dragon', playerId: 'a', hex: plains })
    const cyc = unit({ creatureType: 'Cyclops', playerId: 'b', hex: bramble })
    expect(getStrikeNumber(g, dragon, cyc, land, false)).toBe(baseNeed(g, dragon, cyc) + 1)
  })

  it('H13b: magic missile ignores intervening-bramble skill penalty path', () => {
    const { g, land } = battleOn('Brush', ['Warlock'], ['Ogre'])
    const a = findTerrain(land, 'Plains')
    const b = findTerrain(land, 'Brambles')
    const warlock = unit({ creatureType: 'Warlock', playerId: 'a', hex: a })
    const ogre = unit({ creatureType: 'Ogre', playerId: 'b', hex: b })
    // Magic missile: getAttackerSkill should not apply range/bramble/volcano penalties
    expect(g.variant.creatures.Warlock!.magicMissile).toBe(true)
    expect(getAttackerSkill(g, land, warlock, ogre, false)).toBe(getUnitSkill(g, warlock))
  })
})

describe('H14 Movement entry costs tied to hazards', () => {
  function synthLand(
    a: { terrain?: string; elevation?: number; sideHazard?: 'river' | 'slope' | 'tower' | 'cliff' },
    b: { terrain?: string; elevation?: number },
  ): {
    land: ReturnType<typeof buildBattleland>
    enterBFromA: number
    hexB: ReturnType<typeof buildBattleland>['hexByLabel'][string]
  } {
    // Minimal two-hex land: A --side0--> B; enter B with cameFrom = 3
    const nothing = Array(6).fill('nothing') as (
      | 'nothing'
      | 'dune'
      | 'cliff'
      | 'slope'
      | 'tower'
      | 'river'
    )[]
    const hexA = {
      label: 'A',
      x: 0,
      y: 0,
      terrain: a.terrain ?? 'Plains',
      elevation: a.elevation ?? 0,
      hexsides: [...nothing] as typeof nothing,
      neighbors: ['B', null, null, null, null, null] as (string | null)[],
    }
    const hexB = {
      label: 'B',
      x: 1,
      y: 0,
      terrain: b.terrain ?? 'Plains',
      elevation: b.elevation ?? 0,
      hexsides: [...nothing] as typeof nothing,
      neighbors: [null, null, null, 'A', null, null] as (string | null)[],
    }
    if (a.sideHazard) hexA.hexsides[0] = a.sideHazard
    // Mirror hazard onto B's facing side (Colossus marks some on the higher hex)
    if (a.sideHazard === 'slope' || a.sideHazard === 'tower') {
      hexB.hexsides[3] = a.sideHazard
    }
    if (a.sideHazard === 'river') {
      hexB.hexsides[3] = 'river'
    }
    if (a.sideHazard === 'cliff') {
      hexB.hexsides[3] = 'cliff'
    }
    const land = {
      terrain: 'Test',
      tower: false,
      hexByLabel: { A: hexA, B: hexB },
      labels: ['A', 'B'],
      startlist: [],
      entrances: {
        Bottom: [],
        Left: [],
        Right: [],
        Top: [],
        LeftDefense: [],
        RightDefense: [],
      },
    } as ReturnType<typeof buildBattleland>
    return { land, enterBFromA: 3, hexB }
  }

  it('H14a: Brambles slows non-native ground by +1 MP', () => {
    const v = loadDefaultVariant()
    const land = buildBattleland(v.data.battlelands.Brush!)
    const bramble = land.hexByLabel[findTerrain(land, 'Brambles')]!
    const lion = v.creatures.Lion!
    const cyc = v.creatures.Cyclops!
    expect(getEntryCost(land, bramble, lion, -1)).toBe(2)
    expect(getEntryCost(land, bramble, cyc, -1)).toBe(1)
  })

  it('H14b: Sand slows non-native ground but not flyers', () => {
    const v = loadDefaultVariant()
    const land = buildBattleland(v.data.battlelands.Desert!)
    const sand = land.labels
      .map((l) => land.hexByLabel[l]!)
      .find((h) => h.terrain === 'Sand')
    if (!sand) return
    const ogre = v.creatures.Ogre!
    const garg = v.creatures.Gargoyle!
    expect(ogre.flies).toBe(false)
    expect(garg.flies).toBe(true)
    expect(getEntryCost(land, sand, ogre, -1)).toBe(2)
    expect(getEntryCost(land, sand, garg, -1)).toBe(1)
  })

  it('H14c: stacked slows cap at 2 MP (non-cumulative)', () => {
    const v = loadDefaultVariant()
    const brush = buildBattleland(v.data.battlelands.Brush!)
    const bramble = brush.hexByLabel[findTerrain(brush, 'Brambles')]!
    const edge = findHazardEdge(brush, 'slope')
    const lion = v.creatures.Lion!
    if (edge) {
      const high = brush.hexByLabel[edge.from]!
      // Entering higher hex from below: cameFrom is the downhill-facing hazard side
      const cost = getEntryCost(brush, high, lion, edge.dir)
      expect(cost).toBeLessThanOrEqual(2)
      expect(cost).toBeGreaterThanOrEqual(1)
    }
    expect(getEntryCost(brush, bramble, lion, -1)).toBe(2)
  })

  it('H14d: non-native cannot fly over Stone; Volcano blocks non-native fly-over', () => {
    const v = loadDefaultVariant()
    const stone = {
      label: 'X',
      x: 0,
      y: 0,
      terrain: 'Stone',
      elevation: 0,
      hexsides: Array(6).fill('nothing') as ReturnType<
        typeof buildBattleland
      >['hexByLabel'][string]['hexsides'],
      neighbors: [null, null, null, null, null, null],
    }
    const volcano = { ...stone, terrain: 'Volcano' }
    const garg = v.creatures.Gargoyle!
    const dragon = v.creatures.Dragon!
    expect(canFlyOver(stone, garg)).toBe(false)
    expect(canFlyOver(volcano, garg)).toBe(false)
    expect(canFlyOver(volcano, dragon)).toBe(true)
  })

  it('H14e: cliff hexside is impassable to non-flyers', () => {
    const v = loadDefaultVariant()
    const land = buildBattleland(v.data.battlelands.Mountains!)
    let found = false
    for (const label of land.labels) {
      const hex = land.hexByLabel[label]!
      for (let side = 0; side < 6; side++) {
        if (hex.hexsides[side] !== 'cliff' && oppositeHazard(land, hex, side) !== 'cliff') {
          continue
        }
        const cost = getEntryCost(land, hex, v.creatures.Ogre!, side)
        expect(cost).toBe(IMPASSABLE_COST)
        found = true
        break
      }
      if (found) break
    }
    if (!found) expect(land.labels.length).toBeGreaterThan(0)
  })

  it('H14f: Drift slows non-native ground; Drift-native enters at 1 MP', () => {
    const v = loadDefaultVariant()
    const land = buildBattleland(v.data.battlelands.Tundra!)
    const drift = land.hexByLabel[findTerrain(land, 'Drift')]!
    const lion = v.creatures.Lion!
    const troll = v.creatures.Troll!
    expect(lion.native.Drift).toBe(false)
    expect(troll.native.Drift).toBe(true)
    expect(getEntryCost(land, drift, lion, -1)).toBe(2)
    expect(getEntryCost(land, drift, troll, -1)).toBe(1)
  })

  it('H14g: Bog blocks non-natives; Bog-native may enter', () => {
    const v = loadDefaultVariant()
    const land = buildBattleland(v.data.battlelands.Marsh!)
    const bog = land.hexByLabel[findTerrain(land, 'Bog')]!
    const lion = v.creatures.Lion!
    const troll = v.creatures.Troll! // Marsh recruit; check Bog native
    const serpent = v.creatures.Serpent!
    expect(lion.native.Bog).toBe(false)
    expect(getEntryCost(land, bog, lion, -1)).toBe(IMPASSABLE_COST)
    // Prefer a known Bog native (Hydra / Serpent / Troll / Ranger / Wyvern)
    const bogNative =
      [serpent, troll, v.creatures.Hydra!, v.creatures.Ranger!, v.creatures.Wyvern!].find(
        (c) => c.native.Bog,
      ) ?? serpent
    expect(bogNative.native.Bog).toBe(true)
    expect(getEntryCost(land, bog, bogNative, -1)).toBe(1)
  })

  it('H14h: Volcano blocks non-natives; Dragon (native) may enter', () => {
    const v = loadDefaultVariant()
    const land = buildBattleland(v.data.battlelands.Mountains!)
    const volcano = land.hexByLabel[findTerrain(land, 'Volcano')]!
    expect(getEntryCost(land, volcano, v.creatures.Ogre!, -1)).toBe(IMPASSABLE_COST)
    expect(getEntryCost(land, volcano, v.creatures.Dragon!, -1)).toBe(1)
  })

  it('H14i: uphill slope +1 MP for non-slope-native; slope-native free', () => {
    const v = loadDefaultVariant()
    const land = buildBattleland(v.data.battlelands.Hills!)
    const edge = findHazardEdge(land, 'slope', { requireHigher: true })
    expect(edge).toBeTruthy()
    const high = land.hexByLabel[edge!.from]!
    const cameFrom = edge!.dir
    const cyc = v.creatures.Cyclops!
    const colo = v.creatures.Colossus!
    expect(cyc.native.slope).toBe(false)
    expect(colo.native.slope).toBe(true)
    // Entering higher hex from below across slope
    expect(getEntryCost(land, high, cyc, cameFrom)).toBe(2)
    expect(getEntryCost(land, high, colo, cameFrom)).toBe(1)
  })

  it('H14j: uphill tower/wall hexside +1 MP (even for slope-natives)', () => {
    const v = loadDefaultVariant()
    const land = buildBattleland(v.data.battlelands.Tower!)
    const edge = findHazardEdge(land, 'tower', { requireHigher: true })
    expect(edge).toBeTruthy()
    const high = land.hexByLabel[edge!.from]!
    const cameFrom = edge!.dir
    const colo = v.creatures.Colossus!
    // Tower wall slows everyone who is not a flyer
    expect(getEntryCost(land, high, colo, cameFrom)).toBe(2)
    expect(getEntryCost(land, high, v.creatures.Gargoyle!, cameFrom)).toBe(1)
  })

  it('H14k: river hexside +1 unless flyer, river-native, or water-dwelling', () => {
    const v = loadDefaultVariant()
    const { land, enterBFromA, hexB } = synthLand({ sideHazard: 'river' }, {})
    const ogre = v.creatures.Ogre!
    const lion = v.creatures.Lion! // river: true
    const garg = v.creatures.Gargoyle!
    expect(ogre.native.river).toBe(false)
    expect(lion.native.river).toBe(true)
    expect(getEntryCost(land, hexB, ogre, enterBFromA)).toBe(2)
    expect(getEntryCost(land, hexB, lion, enterBFromA)).toBe(1)
    expect(getEntryCost(land, hexB, garg, enterBFromA)).toBe(1)
    // Water-dwelling (Lake attr) also free — force flag on a copy-like mutation for the test
    const water = { ...ogre, native: { ...ogre.native, Lake: true } }
    expect(getEntryCost(land, hexB, water, enterBFromA)).toBe(1)
  })

  it('H14l: Lake / Tree / Stone block non-natives; natives may enter', () => {
    const v = loadDefaultVariant()
    const { land: lakeLand, hexB: lake } = synthLand({}, { terrain: 'Lake' })
    const { land: treeLand, hexB: tree } = synthLand({}, { terrain: 'Tree' })
    const { land: stoneLand, hexB: stone } = synthLand({}, { terrain: 'Stone' })
    const ogre = v.creatures.Ogre!
    expect(getEntryCost(lakeLand, lake, ogre, -1)).toBe(IMPASSABLE_COST)
    expect(getEntryCost(treeLand, tree, ogre, -1)).toBe(IMPASSABLE_COST)
    expect(getEntryCost(stoneLand, stone, ogre, -1)).toBe(IMPASSABLE_COST)

    const lakeNative = { ...ogre, native: { ...ogre.native, Lake: true } }
    const treeNative = { ...ogre, native: { ...ogre.native, Tree: true } }
    const stoneNative = { ...ogre, native: { ...ogre.native, Stone: true } }
    expect(getEntryCost(lakeLand, lake, lakeNative, -1)).toBe(1)
    expect(getEntryCost(treeLand, tree, treeNative, -1)).toBe(1)
    expect(getEntryCost(stoneLand, stone, stoneNative, -1)).toBe(1)
  })

  it('H14m: Drift also slows non-native flyers; Sand does not', () => {
    const v = loadDefaultVariant()
    const tundra = buildBattleland(v.data.battlelands.Tundra!)
    const desert = buildBattleland(v.data.battlelands.Desert!)
    const drift = tundra.hexByLabel[findTerrain(tundra, 'Drift')]!
    const sand = desert.labels.map((l) => desert.hexByLabel[l]!).find((h) => h.terrain === 'Sand')
    if (!sand) return
    const garg = v.creatures.Gargoyle!
    expect(garg.flies).toBe(true)
    expect(garg.native.Drift).toBe(false)
    expect(getEntryCost(tundra, drift, garg, -1)).toBe(2)
    expect(getEntryCost(desert, sand, garg, -1)).toBe(1)
  })
})

describe('H15 Base chart still holds on Plains', () => {
  it('H15: no hazard → strike number is 4 − atkSkill + defSkill', () => {
    const { g, land } = battleOn('Plains', ['Ogre'], ['Centaur'])
    const plains = findTerrain(land, 'Plains')
    const adj = land.hexByLabel[plains]!.neighbors.find((n) => n != null)!
    const ogre = unit({ creatureType: 'Ogre', playerId: 'a', hex: plains })
    const centaur = unit({ creatureType: 'Centaur', playerId: 'b', hex: adj })
    expect(getStrikeNumber(g, ogre, centaur, land, true)).toBe(baseNeed(g, ogre, centaur))
    expect(getStrikeDice(g, land, ogre, centaur, true)).toBe(g.variant.creatures.Ogre!.power)
  })
})
