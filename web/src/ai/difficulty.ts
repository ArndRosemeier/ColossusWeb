import type { GameState } from '../engine/types'
import type { BattlePlannerOptions } from './battleResponse'

export type AiDifficultyId = 'easy' | 'normal' | 'hard'

interface DifficultySettings {
  id: AiDifficultyId
  label: string
  battle: Readonly<BattlePlannerOptions>
  split: Readonly<{ maxPlans: number; destinationsPerRoll: number }>
}

/** Planning work only. All levels share legality, resources and mandatory safety. */
export const AI_DIFFICULTIES: Readonly<Record<AiDifficultyId, Readonly<DifficultySettings>>> = Object.freeze({
  easy: Object.freeze({ id: 'easy', label: 'Easy', battle: Object.freeze({ candidateLimit: 2, maxResponseNodes: 512 }),
    split: Object.freeze({ maxPlans: 96, destinationsPerRoll: 2 }) }),
  normal: Object.freeze({ id: 'normal', label: 'Normal', battle: Object.freeze({ candidateLimit: 8, maxResponseNodes: 2048 }),
    split: Object.freeze({ maxPlans: 1024, destinationsPerRoll: 4 }) }),
  hard: Object.freeze({ id: 'hard', label: 'Hard', battle: Object.freeze({ candidateLimit: 16, maxResponseNodes: 4096 }),
    split: Object.freeze({ maxPlans: 4096, destinationsPerRoll: 8 }) }),
})

export const AI_DIFFICULTY_CHOICES = Object.freeze(Object.values(AI_DIFFICULTIES))

/** Missing legacy/optional field means Normal; an explicit invalid value is corrupt data. */
export function normalizeAiDifficulty(value: unknown): AiDifficultyId {
  if (value === undefined) return 'normal'
  if (typeof value === 'string' && Object.hasOwn(AI_DIFFICULTIES, value)) return value as AiDifficultyId
  throw new Error(`Invalid AI difficulty: ${String(value)}`)
}

export function difficultyForPlayer(state: Pick<GameState, 'players'>, playerId: string) {
  const player = state.players.find(candidate => candidate.id === playerId)
  if (!player) throw new Error(`AI difficulty owner not found: ${playerId}`)
  return AI_DIFFICULTIES[normalizeAiDifficulty(player.aiDifficultyId)]
}
