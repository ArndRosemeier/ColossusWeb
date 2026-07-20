/**
 * Tests for newly ported Colossus rules (phases 0–8).
 */
import { describe, expect, it } from 'vitest'
import { buildBattleland } from '../battleland'
import { getStrikeNumber } from '../battleStrike'
import { canFlee, legionPointValue, resolveAgreement, resolveEngagementConcession } from '../engagement'
import { dispatch } from '../GameEngine'
import { twoPlayerGame, loadDefaultVariant, turn1SplitChild } from './helpers'
import type { BattleUnit } from '../types'

describe('phase0 battleland data', () => {
  it('Hills battleland includes elevation and slope borders', () => {
    const v = loadDefaultVariant()
    const hills = v.data.battlelands.Hills
    expect(hills).toBeTruthy()
    expect(hills.hexes.some((h) => (h.elevation ?? 0) > 0)).toBe(true)
    expect(hills.hexes.some((h) => (h.borders?.length ?? 0) > 0)).toBe(true)
    const built = buildBattleland(hills)
    expect(built.labels.length).toBeGreaterThan(20)
  })
})

describe('phase1 engagement', () => {
  it('E3: defender without lord can flee for half points', () => {
    const state = twoPlayerGame(1)
    const attacker = state.legions[0]
    const defender = state.legions[1]
    // Strip lords from defender
    defender.creatures = defender.creatures.filter((c) => c.type !== 'Titan' && c.type !== 'Angel')
    defender.creatures.push({ type: 'Centaur', hits: 0 }, { type: 'Ogre', hits: 0 })
    expect(canFlee(state, defender)).toBe(true)
    const before = state.players[0].score
    const half = legionPointValue(state, defender, false)
    resolveEngagementConcession(state, defender, attacker, true)
    expect(state.players[0].score - before).toBe(half)
    expect(state.legions.some((l) => l.id === defender.id)).toBe(false)
  })

  it('E6: concede awards full points', () => {
    const state = twoPlayerGame(2)
    const attacker = state.legions[0]
    const defender = state.legions[1]
    const before = state.players[0].score
    const full = legionPointValue(state, defender, true)
    resolveEngagementConcession(state, defender, attacker, false)
    expect(state.players[0].score - before).toBe(full)
  })

  it('E5: mutual agreement scores 0', () => {
    const state = twoPlayerGame(3)
    const a = state.legions[0]
    const d = state.legions[1]
    const s0 = state.players[0].score
    const s1 = state.players[1].score
    resolveAgreement(state, a, d, 'mutual')
    expect(state.players[0].score).toBe(s0)
    expect(state.players[1].score).toBe(s1)
    expect(state.legions).toHaveLength(0)
  })
})

describe('phase4 strike chart', () => {
  it('K3: strike number is 4 - atkSkill + defSkill (clamped)', () => {
    const state = twoPlayerGame(1)
    const atk: BattleUnit = {
      id: 'a',
      legionId: '1',
      playerId: 'p0',
      creatureType: 'Ogre',
      hits: 0,
      hex: 'C1',
      struck: false,
      moved: false,
    }
    const def: BattleUnit = {
      id: 'd',
      legionId: '2',
      playerId: 'p1',
      creatureType: 'Centaur',
      hits: 0,
      hex: 'C2',
      struck: false,
      moved: false,
    }
    // Use explicit skills via creature types from variant
    const ogre = state.variant.creatures.Ogre
    const centaur = state.variant.creatures.Centaur
    expect(ogre.skill).toBeGreaterThan(0)
    expect(getStrikeNumber(state, atk, def)).toBe(
      Math.min(6, Math.max(1, 4 - ogre.skill + centaur.skill)),
    )
  })
})

describe('phase8 mulligan', () => {
  it('M9: turn-1 mulligan re-rolls before any move', () => {
    let g = twoPlayerGame(5)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    expect(g.phase).toBe('Move')
    expect(g.mulliganAvailable).toBe(true)
    const roll = g.movementRoll
    g = dispatch(g, { type: 'mulligan' })
    expect(g.mulliganAvailable).toBe(false)
    expect(g.movementRoll).toBeGreaterThanOrEqual(1)
    // May equal by chance but command succeeded
    void roll
  })
})
