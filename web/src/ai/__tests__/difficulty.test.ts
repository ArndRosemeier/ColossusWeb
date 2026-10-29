import { describe, expect, it, vi } from 'vitest'
import * as gameEngine from '../../engine/GameEngine'
import { AI_DIFFICULTIES, difficultyForPlayer, normalizeAiDifficulty, type AiDifficultyId } from '../difficulty'
import { createGame } from '../../engine/GameEngine'
import { loadDefaultVariant } from '../../engine/__tests__/helpers'
import { deserializeGame, serializeGame } from '../../persistence/saveGame'
import type { NewGameOptions } from '../../engine/types'
import { simulateGame } from '../../sim/simulateGame'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { dispatch } from '../../engine/GameEngine'
import { planOptionalSplit } from '../splitPlanning'
import { pickAiCommand } from '../simpleAi'
import { AI_PROFILES } from '../profiles'
import { incomingThreatScore } from '../boardSpatial'
import { legionPointValue } from '../battleEstimate'

function options(difficulty?: AiDifficultyId): NewGameOptions {
  return { seed: 84, players: [{ name: 'Alice', kind: 'human' },
    { name: 'CPU', kind: 'ai', aiProfileId: 'random', ...(difficulty ? { aiDifficultyId: difficulty } : {}) }] }
}

describe('per-seat planning difficulty boundary', () => {
  it('defaults absent values to Normal and rejects explicit malformed values', () => {
    expect(normalizeAiDifficulty(undefined)).toBe('normal')
    for (const id of ['easy', 'normal', 'hard'] as const) expect(normalizeAiDifficulty(id)).toBe(id)
    for (const value of [null, '', 'Hard', 'random', 1, true, [], {}, ['hard']]) {
      expect(() => normalizeAiDifficulty(value)).toThrow('Invalid AI difficulty')
      const invalid = options(); invalid.players[1].aiDifficultyId = value as never
      expect(() => createGame(loadDefaultVariant(), invalid)).toThrow('Invalid AI difficulty')
    }
  })
  it('changes no seeded resources, towers, personality RNG or game information between levels', () => {
    const variant = loadDefaultVariant(), baseline = createGame(variant, options())
    expect(baseline.players.map(player => player.aiDifficultyId)).toEqual(['normal', 'normal'])
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const input = options(level), original = structuredClone(input), state = createGame(variant, input)
      expect(state.players[1].aiDifficultyId).toBe(level)
      const removeDifficulty = (game: typeof state) => ({ ...game,
        players: game.players.map(({ aiDifficultyId: _difficulty, ...player }) => player) })
      expect(removeDifficulty(state)).toEqual(removeDifficulty(baseline)); expect(input).toEqual(original)
      expect(difficultyForPlayer(state, state.players[1].id)).toBe(AI_DIFFICULTIES[level])
    }
    expect(() => difficultyForPlayer(baseline, 'missing-player')).toThrow('owner not found')
  })
  it('roundtrips per-seat settings and migrates old missing fields without modifying the blob', () => {
    const state = createGame(loadDefaultVariant(), { ...options(), players: [
      { name: 'Easy CPU', kind: 'ai', aiDifficultyId: 'easy' }, { name: 'Hard CPU', kind: 'ai', aiDifficultyId: 'hard' },
    ] })
    const saved = serializeGame(state), original = structuredClone(saved), restored = deserializeGame(saved, state.variant)
    expect(restored.players.map(player => player.aiDifficultyId)).toEqual(['easy', 'hard']); expect(saved).toEqual(original)
    const legacy = structuredClone(saved)
    for (const player of legacy.state.players) delete (player as Partial<typeof player>).aiDifficultyId
    const beforeMigration = structuredClone(legacy)
    expect(deserializeGame(legacy, state.variant).players.map(player => player.aiDifficultyId)).toEqual(['normal', 'normal'])
    expect(legacy).toEqual(beforeMigration)
  })
  it('rejects invalid serialized and deserialized difficulty instead of downgrading it', () => {
    const state = createGame(loadDefaultVariant(), options())
    for (const invalid of [null, 'impossible', 3, false, {}, []]) {
      const blob = serializeGame(state); blob.state.players[1].aiDifficultyId = invalid as never
      const original = structuredClone(blob)
      expect(() => deserializeGame(blob, state.variant)).toThrow('Invalid AI difficulty'); expect(blob).toEqual(original)
      const corrupt = { ...state, players: state.players.map(player => ({ ...player })) }
      corrupt.players[1].aiDifficultyId = invalid as never
      expect(() => serializeGame(corrupt)).toThrow('Invalid AI difficulty')
    }
  })
  it('propagates optional simulation seat settings and validates their length before simulation', () => {
    const variant = loadDefaultVariant(), spy = vi.spyOn(gameEngine, 'createGame')
    try {
      expect(simulateGame(variant, { seed: 84, difficulties: ['easy', 'hard'], maxSteps: 0 }).outcome).toBe('max_steps')
      expect(spy.mock.results[0].value.players.map((player: { aiDifficultyId: string }) => player.aiDifficultyId)).toEqual(['easy', 'hard'])
      expect(() => simulateGame(variant, { seed: 84, players: 3, difficulties: ['easy', 'hard'], maxSteps: 0 })).toThrow('difficulties length')
      expect(() => simulateGame(variant, { seed: 84, difficulties: ['invalid' as never, 'normal'], maxSteps: 0 })).toThrow('Invalid AI difficulty')
    } finally { spy.mockRestore() }
  })
  it('uses the legion owner level for actual split work and safely executes every approved roll', () => {
    const records = []
    for (const level of Object.values(AI_DIFFICULTIES)) {
      const state = twoPlayerGame(71), own = state.legions[0]
      state.turnNumber = 3; state.phase = 'Split'; state.players[0].kind = 'ai'; state.players[0].aiProfileId = 'balanced'
      state.players[0].aiDifficultyId = level.id; state.players[1].aiDifficultyId = 'easy'
      own.creatures = ['Titan', 'Cyclops', 'Cyclops', 'Cyclops', 'Lion', 'Ogre', 'Ogre'].map(type => ({ type, hits: 0 }))
      own.hexLabel = '100'; state.legions = [own]
      const before = JSON.stringify(state), start = performance.now()
      const plan = planOptionalSplit(state, own, AI_PROFILES.balanced)
      const elapsedMs = performance.now() - start
      expect(plan).toEqual(planOptionalSplit(state, own, AI_PROFILES.balanced, level.split))
      expect(plan.plans).toBeLessThanOrEqual(level.split.maxPlans)
      expect(JSON.stringify(state)).toBe(before)
      records.push({ level: level.id, plans: plan.plans, queries: plan.movementQueries, exhausted: plan.exhausted, split: plan.childCreatures, elapsedMs })
      if (!plan.childCreatures) continue // An incomplete optional proof may HOLD; safety is never lowered.
      for (let roll = 1; roll <= 6; roll++) {
        const split = dispatch(state, { type: 'split', parentId: own.id, childCreatures: plan.childCreatures })
        let next = dispatch(split, { type: 'doneSplit' }, () => (roll - 0.5) / 6)
        let steps = 0
        while (next.phase === 'Move' && steps++ < 4) {
          const command = pickAiCommand(next, () => 0.5)!
          const input = JSON.stringify(next)
          expect(pickAiCommand(next, () => 0.5)).toEqual(command); expect(JSON.stringify(next)).toBe(input)
          next = dispatch(next, command)
        }
        expect(next.phase).not.toBe('Move')
        expect(new Set(next.legions.map(piece => piece.hexLabel)).size).toBe(2)
        expect(next.message).not.toMatch(/illegal|cannot|must move/i)
      }
    }
    console.log('Difficulty actual split work', JSON.stringify(records))
    expect(records[2].queries).toBeGreaterThan(records[1].queries)
    expect(records[1].queries).toBeGreaterThan(records[0].queries)
  })
  it('keeps the audited forced-loss Hydra stack together at every level', () => {
    for (const level of Object.values(AI_DIFFICULTIES)) {
      const state = twoPlayerGame(71), own = state.legions[0], enemy = state.legions[1]
      state.turnNumber = 3; state.phase = 'Split'; state.players[0].kind = 'ai'; state.players[0].aiProfileId = 'balanced'
      state.players[0].aiDifficultyId = level.id
      own.creatures = ['Titan', 'Hydra', 'Wyvern', 'Wyvern', 'Ogre', 'Ogre', 'Centaur'].map(type => ({ type, hits: 0 }))
      own.hexLabel = '4'; enemy.hexLabel = '103'; enemy.creatures = Array.from({ length: 7 }, () => ({ type: 'Hydra', hits: 0 }))
      expect(pickAiCommand(state, () => 0.5)).toEqual({ type: 'doneSplit' })
      expect(own.creatures).toHaveLength(7)
    }
  })
  it('retains the current safe split continuation instead of sending a held child to the threatened bait at any level', () => {
    for (const level of Object.values(AI_DIFFICULTIES)) {
      const state = twoPlayerGame(71), own = state.legions[0], enemy = state.legions[1]
      state.turnNumber = 3; state.phase = 'Split'; state.players[0].kind = 'ai'; state.players[0].aiProfileId = 'balanced'; state.players[0].aiDifficultyId = level.id
      own.creatures = ['Titan', 'Cyclops', 'Cyclops', 'Cyclops', 'Lion', 'Ogre', 'Ogre'].map(type => ({ type, hits: 0 }))
      own.hexLabel = '100'; enemy.hexLabel = '37'; enemy.creatures = ['Hydra', 'Hydra', 'Hydra'].map(type => ({ type, hits: 0 }))
      const command = pickAiCommand(state, () => 0.5)!
      if (command.type === 'doneSplit') { expect(own.creatures).toHaveLength(7); continue }
      expect(command.type).toBe('split')
      let next = dispatch(dispatch(state, command), { type: 'doneSplit' }, () => (3 - 0.5) / 6)
      for (let step = 0; step < 4 && next.phase === 'Move'; step++) next = dispatch(next, pickAiCommand(next, () => 0.5)!)
      expect(next.phase).not.toBe('Move')
      for (const piece of next.legions.filter(legion => legion.playerId === own.playerId)) {
        expect(incomingThreatScore(next, piece, piece.hexLabel)).toBeLessThanOrEqual(Math.max(1, legionPointValue(next, piece)) * 0.2)
      }
    }
  })
})
