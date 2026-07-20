import { describe, expect, it } from 'vitest'
import { startBattle } from '../../engine/battle'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import type { BattleState, Legion } from '../../engine/types'
import {
  battleClockHeat,
  evaluateBattleHex,
  evaluateBattleStrike,
  expectedHits,
  turnsLeftOnClock,
} from '../evaluateBattle'
import { AI_PROFILES } from '../profiles'

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
    enteredFrom: 'Bottom',
    ...partial,
  }
}

function placeUnits(battle: BattleState, placements: { id: string; hex: string; hits?: number }[]) {
  for (const p of placements) {
    const u = battle.units.find((x) => x.id === p.id)
    if (!u) throw new Error(`Missing unit ${p.id}`)
    u.hex = p.hex
    if (p.hits != null) u.hits = p.hits
    u.moved = true
    u.struck = false
  }
}

function makeBrushBattle() {
  const g = twoPlayerGame(42)
  const brush = hexOfTerrain(g, 'Brush')
  const atk = stubLegion({
    id: 'atk',
    playerId: g.players[0]!.id,
    markerId: 'Rd01',
    hexLabel: brush,
    enteredFrom: 'Bottom',
    creatures: [
      { type: 'Cyclops', hits: 0 },
      { type: 'Gargoyle', hits: 0 },
    ],
  })
  const def = stubLegion({
    id: 'def',
    playerId: g.players[1]!.id,
    markerId: 'Bu01',
    hexLabel: brush,
    enteredFrom: null,
    creatures: [
      { type: 'Gargoyle', hits: 0 },
      { type: 'Gargoyle', hits: 0 },
    ],
  })
  g.legions = [atk, def]
  const battle = startBattle(g, atk, def, () => 0.5)
  g.battle = battle
  return { g, battle, atk, def }
}

describe('expectedHits', () => {
  it('scales with dice and strike number', () => {
    const { g, battle } = makeBrushBattle()
    placeUnits(battle, [
      { id: battle.units[0]!.id, hex: 'D3' },
      { id: battle.units[2]!.id, hex: 'D4' },
    ])
    const atk = battle.units[0]!
    const def = battle.units[2]!
    // Cyclops skill 2 vs Gargoyle skill 3 → need 5, p=2/6, dice=9 → 3
    const eh = expectedHits(g, atk, def, true)
    expect(eh).toBeCloseTo(9 * (2 / 6), 5)
  })
})

describe('evaluateBattleStrike', () => {
  it('prefers a nearly dead target over a full-health equal', () => {
    const { g, battle } = makeBrushBattle()
    // Attacker Cyclops at C3; two enemy Gargoyles adjacent at B3 and D3
    const cyclops = battle.units.find((u) => u.creatureType === 'Cyclops')!
    const gargs = battle.units.filter((u) => u.playerId !== cyclops.playerId)
    placeUnits(battle, [
      { id: cyclops.id, hex: 'C3' },
      { id: gargs[0]!.id, hex: 'B3', hits: 3 }, // Gargoyle power 4 → 1 HP left
      { id: gargs[1]!.id, hex: 'D3', hits: 0 },
    ])
    battle.phase = 'Strike'
    battle.activePlayerId = cyclops.playerId
    const profile = AI_PROFILES.balanced
    const scoreWounded = evaluateBattleStrike(g, battle, cyclops, gargs[0]!, profile)
    const scoreFull = evaluateBattleStrike(g, battle, cyclops, gargs[1]!, profile)
    expect(scoreWounded).toBeGreaterThan(scoreFull)
  })
})

describe('evaluateBattleHex', () => {
  it('prefers a hex that enables a melee strike over a distant empty hex', () => {
    const { g, battle } = makeBrushBattle()
    const cyclops = battle.units.find((u) => u.creatureType === 'Cyclops')!
    const enemy = battle.units.find((u) => u.playerId !== cyclops.playerId)!
    placeUnits(battle, [
      { id: cyclops.id, hex: 'A1' },
      { id: enemy.id, hex: 'C3' },
    ])
    // Leave other units off-board so they do not clutter
    for (const u of battle.units) {
      if (u.id !== cyclops.id && u.id !== enemy.id) u.hex = null
    }
    cyclops.moved = false
    const profile = AI_PROFILES.balanced
    const contact = evaluateBattleHex(g, battle, cyclops, 'B3', profile) // nearer / can threaten C3
    const far = evaluateBattleHex(g, battle, cyclops, 'F1', profile)
    expect(contact).toBeGreaterThan(far)
  })

  it('penalizes parking a Titan next to many enemy dice', () => {
    const g = twoPlayerGame(7)
    const plains = hexOfTerrain(g, 'Plains')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0]!.id,
      markerId: 'Rd01',
      hexLabel: plains,
      enteredFrom: 'Bottom',
      creatures: [{ type: 'Titan', hits: 0 }],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1]!.id,
      markerId: 'Bu01',
      hexLabel: plains,
      enteredFrom: null,
      creatures: [
        { type: 'Cyclops', hits: 0 },
        { type: 'Cyclops', hits: 0 },
        { type: 'Cyclops', hits: 0 },
      ],
    })
    g.legions = [atk, def]
    g.players[0]!.titanPower = 6
    const battle = startBattle(g, atk, def, () => 0.5)
    g.battle = battle
    const titan = battle.units.find((u) => u.creatureType === 'Titan')!
    const foes = battle.units.filter((u) => u.playerId !== titan.playerId)
    placeUnits(battle, [
      { id: titan.id, hex: 'D3' },
      { id: foes[0]!.id, hex: 'C3' },
      { id: foes[1]!.id, hex: 'D4' },
      { id: foes[2]!.id, hex: 'E3' },
    ])
    titan.moved = false
    const profile = AI_PROFILES.cautious
    const surrounded = evaluateBattleHex(g, battle, titan, 'D3', profile)
    // Move titan off contact toward empty bottom
    const safer = evaluateBattleHex(g, battle, titan, 'A1', profile)
    expect(safer).toBeGreaterThan(surrounded)
  })

  it('aggressive closes harder than cautious on open approach', () => {
    const { g, battle } = makeBrushBattle()
    const cyclops = battle.units.find((u) => u.creatureType === 'Cyclops')!
    const enemy = battle.units.find((u) => u.playerId !== cyclops.playerId)!
    placeUnits(battle, [
      { id: cyclops.id, hex: 'A1' },
      { id: enemy.id, hex: 'F4' },
    ])
    for (const u of battle.units) {
      if (u.id !== cyclops.id && u.id !== enemy.id) u.hex = null
    }
    cyclops.moved = false
    const near = 'B2'
    const far = 'A2'
    const aggDelta =
      evaluateBattleHex(g, battle, cyclops, near, AI_PROFILES.aggressive) -
      evaluateBattleHex(g, battle, cyclops, far, AI_PROFILES.aggressive)
    const cauDelta =
      evaluateBattleHex(g, battle, cyclops, near, AI_PROFILES.cautious) -
      evaluateBattleHex(g, battle, cyclops, far, AI_PROFILES.cautious)
    expect(aggDelta).toBeGreaterThan(cauDelta)
  })
})

describe('battle clock (time-loss)', () => {
  it('heat rises toward turn 7', () => {
    const { battle } = makeBrushBattle()
    battle.turn = 1
    expect(battleClockHeat(battle)).toBe(0)
    expect(turnsLeftOnClock(battle)).toBe(7)
    battle.turn = 7
    expect(battleClockHeat(battle)).toBe(1)
    expect(turnsLeftOnClock(battle)).toBe(1)
  })

  it('late-turn attacker values closing more than on turn 1', () => {
    const { g, battle, atk } = makeBrushBattle()
    const cyclops = battle.units.find((u) => u.legionId === atk.id && u.creatureType === 'Cyclops')!
    const enemy = battle.units.find((u) => u.legionId !== atk.id)!
    placeUnits(battle, [
      { id: cyclops.id, hex: 'A1' },
      { id: enemy.id, hex: 'D4' },
    ])
    for (const u of battle.units) {
      if (u.id !== cyclops.id && u.id !== enemy.id) u.hex = null
    }
    cyclops.moved = false
    battle.activePlayerId = atk.playerId
    battle.activeHalf = 'attacker'
    const profile = AI_PROFILES.balanced
    const near = 'C3'
    const far = 'A2'

    battle.turn = 1
    const earlyDelta =
      evaluateBattleHex(g, battle, cyclops, near, profile) -
      evaluateBattleHex(g, battle, cyclops, far, profile)

    battle.turn = 7
    const lateDelta =
      evaluateBattleHex(g, battle, cyclops, near, profile) -
      evaluateBattleHex(g, battle, cyclops, far, profile)

    expect(lateDelta).toBeGreaterThan(earlyDelta)
  })

  it('late-turn defender prefers a safe hex over rushing into contact', () => {
    const { g, battle, def } = makeBrushBattle()
    const garg = battle.units.find((u) => u.legionId === def.id)!
    const enemy = battle.units.find((u) => u.legionId !== def.id && u.creatureType === 'Cyclops')!
    placeUnits(battle, [
      { id: garg.id, hex: 'F1' },
      { id: enemy.id, hex: 'C3' },
    ])
    for (const u of battle.units) {
      if (u.id !== garg.id && u.id !== enemy.id) u.hex = null
    }
    garg.moved = false
    battle.activePlayerId = def.playerId
    battle.activeHalf = 'defender'
    battle.turn = 7
    const profile = AI_PROFILES.balanced
    // Adjacent to Cyclops is hot; stay on the rim
    const intoContact = evaluateBattleHex(g, battle, garg, 'C4', profile)
    const stayAway = evaluateBattleHex(g, battle, garg, 'F1', profile)
    expect(stayAway).toBeGreaterThan(intoContact)
  })
})
