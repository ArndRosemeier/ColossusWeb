import { describe, expect, it } from 'vitest'
import { dispatch } from '../../engine/GameEngine'
import { startBattle } from '../../engine/battle'
import { listMovePreview } from '../../engine/movement'
import { bestRecruitAt, compositionDevelopmentValue, listAvailableDevelopmentEdges, listRecruitOptionsAt } from '../../engine/recruit'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import type { GameState, Legion } from '../../engine/types'
import { pickAiCommand } from '../simpleAi'
import { AI_PROFILES } from '../profiles'
import { jointSplitGrowth, planOptionalSplit } from '../splitPlanning'
import { chooseCreaturesToSplitOut } from '../splitChoice'
import { buildSpatialCache, incomingThreatScore } from '../boardSpatial'
import { creatureCombatValue, findBestBattleReinforce, findBestSummonable, legionCombatValue } from '../legionStrength'

function position(types: string[], hex = '4') {
  const state = twoPlayerGame(71)
  state.turnNumber = 3
  state.phase = 'Split'
  const own = state.legions[0]
  own.creatures = types.map((type) => ({ type, hits: 0 }))
  own.hexLabel = hex
  own.splitThisTurn = false
  state.players[0].kind = 'ai'
  state.players[0].aiProfileId = 'balanced'
  return { state, own, enemy: state.legions[1] }
}
function copyLegion(original: Legion, id: string, types: string[], hexLabel: string): Legion {
  return { ...original, id, markerId: 'Rd02', hexLabel,
    creatures: types.map((type) => ({ type, hits: 0 })) }
}
function terrainHex(state: GameState, terrain: string) {
  return Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === terrain)!.label
}

const protectedArmy = ['Titan', 'Hydra', 'Wyvern', 'Wyvern', 'Ogre', 'Ogre', 'Centaur']

describe('joint optional split planning', () => {
  it.each(Object.keys(AI_PROFILES))('holds the one-exit forced-loss Hydra position for %s', (id) => {
    const { state, own, enemy } = position(protectedArmy)
    enemy.hexLabel = '103'
    enemy.creatures = Array.from({ length: 7 }, () => ({ type: 'Hydra', hits: 0 }))
    state.legions.push(copyLegion(own, 'escort', ['Centaur', 'Centaur'], '4000'))
    state.players[0].aiProfileId = id as keyof typeof AI_PROFILES
    const before = JSON.stringify(state)
    expect(pickAiCommand(state, () => 0.5)).toEqual({ type: 'doneSplit' })
    expect(JSON.stringify(state)).toBe(before)
    // Prove the trap with engine legality, rather than reproducing gate rules.
    const split = dispatch(state, { type: 'split', parentId: own.id, childCreatures: ['Ogre', 'Ogre'] })
    for (const piece of split.legions.filter((l) => l.id === own.id || l.splitParentId === own.id)) {
      for (let roll = 1; roll <= 6; roll++) expect([...listMovePreview(split, piece, roll).keys()]).toEqual(['103'])
    }
    let held = dispatch(state, { type: 'doneSplit' }, () => 0.5)
    held = dispatch(held, { type: 'doneSplit' }, () => 0.5)
    expect(held.phase).toBe('Move')
    expect(held.legions.find((l) => l.id === own.id)!.creatures).toHaveLength(7)
  })

  it.each(Object.values(AI_PROFILES))('still splits safe productive stacks for $id', (profile) => {
    const { state, own } = position(['Titan', 'Cyclops', 'Cyclops', 'Cyclops', 'Lion', 'Ogre', 'Ogre'], '100')
    state.legions = [own]
    const before = JSON.stringify(state)
    const plan = planOptionalSplit(state, own, profile)
    expect(plan.childCreatures).not.toBeNull()
    expect(plan.childCreatures).not.toContain('Titan')
    expect(plan.childCreatures).not.toContain('Cyclops')
    const next = dispatch(state, { type: 'split', parentId: own.id, childCreatures: plan.childCreatures! })
    expect(next.legions.map((l) => l.creatures.length).sort()).toEqual([2, 5])
    expect(planOptionalSplit(state, own, profile)).toEqual(plan)
    expect(plan.plans).toBeLessThanOrEqual(1024)
    expect(JSON.stringify(state)).toBe(before)
  })

  it.each(Object.keys(AI_PROFILES))('holds instead of buying five productive rolls with one forced losing separation for %s', (id) => {
    const { state, own, enemy } = position(protectedArmy, '4')
    state.players[0].aiProfileId = id as keyof typeof AI_PROFILES
    enemy.hexLabel = '140'
    enemy.creatures = Array.from({ length: 7 }, () => ({ type: 'Hydra', hits: 0 }))
    state.legions.push(copyLegion(own, 'escort', ['Centaur', 'Centaur'], '4000'))
    const split = dispatch(state, { type: 'split', parentId: own.id, childCreatures: ['Ogre', 'Ogre'] })
    const titanPart = split.legions.find((l) => l.id === own.id)!
    for (let roll = 1; roll <= 5; roll++) expect([...listMovePreview(split, titanPart, roll).keys()]).not.toContain('140')
    expect([...listMovePreview(split, titanPart, 6).keys()]).toEqual(['140'])
    expect(incomingThreatScore(state, own, '4')).toBe(0)
    expect(pickAiCommand(state, () => 0.5)).toEqual({ type: 'doneSplit' })
  })

  it('holds a developed seven when empty destinations expose a child to incoming overwhelming attack', () => {
    const { state, own, enemy } = position(['Titan', 'Cyclops', 'Cyclops', 'Cyclops', 'Ogre', 'Ogre', 'Centaur'], '1')
    enemy.hexLabel = '1000'
    enemy.creatures = Array.from({ length: 7 }, () => ({ type: 'Hydra', hits: 0 }))
    expect([...listMovePreview(state, own, 1).keys()]).toContain('2')
    expect(state.legions.some((l) => l.hexLabel === '2')).toBe(false)
    expect(planOptionalSplit(state, own, AI_PROFILES.balanced).childCreatures).toBeNull()
  })

  it('preserves terminal combat investments even with no outgoing development edge', () => {
    const { state, own } = position(['Titan', 'Hydra', 'Cyclops', 'Cyclops', 'Cyclops', 'Ogre', 'Ogre'])
    expect(chooseCreaturesToSplitOut(state, own)).toEqual(['Ogre', 'Ogre'])
    own.hexLabel = '100'
    state.legions = [own]
    const plan = planOptionalSplit(state, own, AI_PROFILES.balanced)
    expect(plan.childCreatures).not.toBeNull()
    expect(plan.childCreatures).not.toContain('Hydra')
    expect(plan.childCreatures).not.toContain('Cyclops')
  })

  it('never promises two Hydras from the last shared caretaker copy', () => {
    const { state, own } = position(['Wyvern', 'Wyvern'])
    const child = copyLegion(own, 'child', ['Wyvern', 'Wyvern'], own.hexLabel)
    const swamps = Object.values(state.variant.board.hexByLabel).filter((h) => h.terrain === 'Swamp')
    expect(listRecruitOptionsAt(state, own, swamps[0].label)).toContain('Hydra')
    state.caretaker.Hydra = 1
    const one = jointSplitGrowth(state, own, swamps[0].label, child, swamps[1].label)
    expect(one).toBeGreaterThan(0)
    state.caretaker.Hydra = 2
    expect(jointSplitGrowth(state, own, swamps[0].label, child, swamps[1].label)).toBe(one * 2)
    state.caretaker.Hydra = 0
    expect(jointSplitGrowth(state, own, swamps[0].label, child, swamps[1].label)).toBe(0)
  })

  it('holds seven when there is no available useful growth, and refuses unproven budget-limited plans', () => {
    const { state, own } = position(protectedArmy, '100')
    state.legions = [own]
    const limited = planOptionalSplit(state, own, AI_PROFILES.balanced, { maxPlans: 1 })
    expect(limited.exhausted).toBe(true)
    expect(limited.childCreatures).toBeNull()
    for (const type of Object.keys(state.caretaker)) state.caretaker[type] = 0
    expect(pickAiCommand(state)).toEqual({ type: 'doneSplit' })
    expect(() => planOptionalSplit(state, own, AI_PROFILES.balanced, { maxPlans: 0 })).toThrow('budget')
  })

  it('keeps mandatory initial 4:4 and later height-eight splits legal', () => {
    const initial = twoPlayerGame(3)
    initial.players[0].kind = 'ai'
    const opening = pickAiCommand(initial, () => 0.5)!
    expect(opening.type).toBe('split')
    expect(dispatch(initial, opening).legions.filter((l) => l.playerId === initial.players[0].id)
      .map((l) => l.creatures.length)).toEqual([4, 4])
    const parts = dispatch(initial, opening).legions.filter((l) => l.playerId === initial.players[0].id)
    for (const part of parts) {
      expect(part.creatures.filter((c) => initial.variant.creatures[c.type].lord)).toHaveLength(1)
      expect(part.creatures.some((c) => part.creatures.filter((other) => other.type === c.type).length >= 2)).toBe(true)
    }
    const { state, own } = position([...protectedArmy, 'Centaur'])
    const forced = pickAiCommand(state, () => 0.5)!
    expect(forced.type).toBe('split')
    expect(dispatch(state, forced).legions.find((l) => l.id === own.id)!.creatures).toHaveLength(6)
  })
})

describe('candidate occupancy and available development', () => {
  it('sees the five-roll incoming Hydra route opened by vacating the source hex', () => {
    const { state, own, enemy } = position(['Centaur', 'Centaur'], '1')
    enemy.hexLabel = '1000'
    enemy.creatures = ['Hydra', 'Hydra', 'Hydra'].map((type) => ({ type, hits: 0 }))
    const cache = buildSpatialCache(state)
    expect(listMovePreview(state, own, 1).has('2')).toBe(true)
    expect(cache.reachCounts.get(enemy.id)!.get('2') ?? 0).toBe(0)
    const projected = { ...state, legions: [{ ...own, hexLabel: '2' }, enemy] }
    expect([1, 2, 3, 4, 5, 6].filter((roll) => listMovePreview(projected, enemy, roll).has('2'))).toHaveLength(5)
    expect(incomingThreatScore(state, own, '2', cache)).toBeCloseTo(28)
    expect(incomingThreatScore(projected, projected.legions[0], '2', cache)).toBeCloseTo(28)
    enemy.hexLabel = '103'
    expect(incomingThreatScore(state, own, '2', cache)).toBe(incomingThreatScore(state, own, '2'))
  })

  it('uses healthy stock but removes exhausted direct and downstream development in the same state', () => {
    const { state, own } = position(['Cyclops', 'Cyclops'], '3')
    expect(state.variant.board.hexByLabel['3'].terrain).toBe('Brush')
    const legalBefore = listRecruitOptionsAt(state, own, '3')
    expect(bestRecruitAt(state, own, '3')).toBe('Cyclops')
    expect(compositionDevelopmentValue(state, { Behemoth: 1 })).toBeGreaterThan(0)
    state.caretaker.Behemoth = 0
    state.caretaker.Serpent = 0
    expect(bestRecruitAt(state, own, '3')).toBe('Gorgon')
    expect(compositionDevelopmentValue(state, { Behemoth: 1 })).toBe(0)
    expect(listAvailableDevelopmentEdges(state).some((e) => e.recruit === 'Behemoth' || e.recruit === 'Serpent')).toBe(false)
    expect(listRecruitOptionsAt(state, own, '3')).toEqual(legalBefore)
    state.caretaker.Behemoth = 10
    state.caretaker.Serpent = 10
    expect(bestRecruitAt(state, own, '3')).toBe('Cyclops')
    state.caretaker.Cyclops = 0
    expect(compositionDevelopmentValue(state, { Cyclops: 2 }, 20)).toBe(0)
    expect(compositionDevelopmentValue(state, { Cyclops: 3 }, 20)).toBeGreaterThan(0)
  })
})

describe('executable battle support policy', () => {
  it.each(Object.keys(AI_PROFILES))('reinforces and post-reinforces with the estimated strongest option for %s', (id) => {
    const { state, own, enemy } = position(['Lion', 'Lion', 'Lion'])
    state.players[0].aiProfileId = id as keyof typeof AI_PROFILES
    own.hexLabel = enemy.hexLabel = terrainHex(state, 'Desert')
    state.phase = 'Battle'
    state.battle = startBattle(state, enemy, own, () => 0.5)
    state.battle.phase = 'Recruit'
    state.battle.turn = 4
    state.battle.activePlayerId = own.playerId
    state.battle.activeHalf = 'defender'
    expect(findBestBattleReinforce(state, own, own.hexLabel)).toBe('Griffon')
    const command = pickAiCommand(state, () => 0)!
    expect(command).toEqual({ type: 'battleReinforce', creatureType: 'Griffon' })
    expect(dispatch(state, command).battle!.units.at(-1)!.creatureType).toBe('Griffon')
    state.battle.done = true
    state.pendingPostBattleReinforce = { legionId: own.id }
    expect(pickAiCommand(state, () => 0)).toEqual({ type: 'postBattleReinforce', creatureType: 'Griffon' })
  })

  it.each(Object.keys(AI_PROFILES))('values and summons the actual first eligible donor creature for %s', (id) => {
    const { state, own, enemy } = position(['Lion', 'Lion'])
    state.players[0].aiProfileId = id as keyof typeof AI_PROFILES
    own.hexLabel = enemy.hexLabel = terrainHex(state, 'Plains')
    const donor = copyLegion(own, 'donor', ['Angel', 'Archangel', 'Centaur'], terrainHex(state, 'Woods'))
    state.legions.push(donor)
    state.phase = 'Battle'
    state.battle = startBattle(state, own, enemy, () => 0.5)
    state.battle.phase = 'Summon'
    state.battle.activePlayerId = own.playerId
    state.battle.activeHalf = 'attacker'
    state.battle.summonState = 'firstBlood'
    state.battle.pendingSummon = true
    expect(findBestSummonable(state, own)).toEqual({ fromLegionId: donor.id, creatureType: 'Angel' })
    expect(legionCombatValue(state, own, own.hexLabel, 'attack', { engagementExtras: true }))
      .toBe(legionCombatValue(state, own, own.hexLabel, 'attack') + creatureCombatValue(state, 'Angel', own.hexLabel))
    const before = JSON.stringify(state)
    const command = pickAiCommand(state, () => 0)!
    expect(command).toEqual({ type: 'battleSummon', fromLegionId: donor.id })
    expect(dispatch(state, command).battle!.units.at(-1)!.creatureType).toBe('Angel')
    expect(JSON.stringify(state)).toBe(before)
    state.battle.attackerSummoned = true
    expect(findBestSummonable(state, own)).toBeNull()
    state.battle.attackerSummoned = false
    donor.creatures = ['Angel', 'Titan'].map((type) => ({ type, hits: 0 }))
    expect(findBestSummonable(state, own)).toBeNull()
    expect(pickAiCommand(state)).toEqual({ type: 'battleSkipSummon' })
  })
})
