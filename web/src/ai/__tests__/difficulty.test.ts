import { describe, expect, it, vi } from 'vitest'
import * as gameEngine from '../../engine/GameEngine'
import { AI_DIFFICULTIES, difficultyForPlayer, normalizeAiDifficulty, type AiDifficultyId } from '../difficulty'
import { createGame } from '../../engine/GameEngine'
import { loadDefaultVariant } from '../../engine/__tests__/helpers'
import { deserializeGame, serializeGame } from '../../persistence/saveGame'
import type { NewGameOptions } from '../../engine/types'
import { simulateGame } from '../../sim/simulateGame'

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
})
