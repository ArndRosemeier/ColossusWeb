import { pickSimpleAiCommand } from '../ai/simpleAi'
import { createGame, createRng, dispatch } from '../engine/GameEngine'
import type { GameCommand, GameState, NewGameOptions } from '../engine/types'
import type { LoadedVariant } from '../variant/loadVariant'
import { checkInvariants, stateFingerprint, type InvariantViolation } from './invariants'

export type SimOutcome =
  | 'winner'
  | 'draw'
  | 'stuck'
  | 'max_turns'
  | 'max_steps'
  | 'error'
  | 'invariant'

export type SimResult = {
  seed: number
  outcome: SimOutcome
  turns: number
  steps: number
  winnerName: string | null
  error: string | null
  violations: InvariantViolation[]
  lastPhase: string
  lastMessage: string
  lastCommand: GameCommand | null
}

export type SimulateOptions = {
  seed: number
  players?: number
  maxTurns?: number
  maxSteps?: number
  /** Consecutive unchanged fingerprints before declaring stuck */
  stuckLimit?: number
}

function aiPlayers(count: number): NewGameOptions['players'] {
  return Array.from({ length: count }, (_, i) => ({
    name: `AI-${i + 1}`,
    kind: 'ai' as const,
  }))
}

/**
 * Run one all-AI game to completion (or failure).
 * Uses a seeded RNG for both setup and every dispatch.
 */
export function simulateGame(variant: LoadedVariant, options: SimulateOptions): SimResult {
  const seed = options.seed
  const players = options.players ?? 2
  const maxTurns = options.maxTurns ?? 400
  const maxSteps = options.maxSteps ?? 50_000
  const stuckLimit = options.stuckLimit ?? 40

  const rng = createRng(seed)
  let state: GameState = createGame(variant, {
    players: aiPlayers(players),
    seed,
  })

  let steps = 0
  let lastFp = stateFingerprint(state)
  let unchanged = 0
  let lastCommand: GameCommand | null = null

  const finish = (
    outcome: SimOutcome,
    extra: Partial<Pick<SimResult, 'error' | 'violations'>> = {},
  ): SimResult => ({
    seed,
    outcome,
    turns: state.turnNumber,
    steps,
    winnerName: state.winnerId
      ? (state.players.find((p) => p.id === state.winnerId)?.name ?? state.winnerId)
      : null,
    error: extra.error ?? null,
    violations: extra.violations ?? [],
    lastPhase: state.battle && !state.battle.done ? `Battle/${state.battle.phase}` : state.phase,
    lastMessage: state.message,
    lastCommand,
  })

  while (!state.winnerId && !state.draw) {
    if (state.turnNumber > maxTurns) return finish('max_turns')
    if (steps >= maxSteps) return finish('max_steps')

    const cmd = pickSimpleAiCommand(state, rng)
    if (!cmd) {
      return finish('stuck', { error: 'AI returned no command' })
    }
    lastCommand = cmd

    try {
      state = dispatch(state, cmd, rng)
    } catch (e) {
      return finish('error', {
        error: e instanceof Error ? e.message : String(e),
      })
    }
    steps += 1

    const violations = checkInvariants(state)
    if (violations.length > 0) {
      return finish('invariant', { violations })
    }

    const fp = stateFingerprint(state)
    if (fp === lastFp) {
      unchanged += 1
      if (unchanged >= stuckLimit) {
        return finish('stuck', {
          error: `State unchanged for ${stuckLimit} steps (cmd=${JSON.stringify(cmd)})`,
        })
      }
    } else {
      unchanged = 0
      lastFp = fp
    }
  }

  return finish(state.draw ? 'draw' : 'winner')
}
