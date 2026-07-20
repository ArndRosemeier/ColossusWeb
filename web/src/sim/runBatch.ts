import type { LoadedVariant } from '../variant/loadVariant'
import { simulateGame, type SimOutcome, type SimResult, type SimulateOptions } from './simulateGame'

export type BatchOptions = {
  games: number
  seed?: number
  players?: number
  maxTurns?: number
  maxSteps?: number
  stuckLimit?: number
  /** Called after each game (for progress logging) */
  onGame?: (result: SimResult, index: number) => void
}

export type BatchSummary = {
  games: number
  byOutcome: Record<SimOutcome, number>
  winners: Record<string, number>
  avgTurnsWhenWon: number
  avgStepsWhenWon: number
  failures: SimResult[]
  elapsedMs: number
}

export function runBatch(variant: LoadedVariant, options: BatchOptions): BatchSummary {
  const baseSeed = options.seed ?? 1
  const byOutcome: Record<SimOutcome, number> = {
    winner: 0,
    draw: 0,
    stuck: 0,
    max_turns: 0,
    max_steps: 0,
    error: 0,
    invariant: 0,
  }
  const winners: Record<string, number> = {}
  const failures: SimResult[] = []
  let turnSum = 0
  let stepSum = 0
  let won = 0

  const t0 = Date.now()
  for (let i = 0; i < options.games; i++) {
    const simOpts: SimulateOptions = {
      seed: baseSeed + i * 9973,
      players: options.players,
      maxTurns: options.maxTurns,
      maxSteps: options.maxSteps,
      stuckLimit: options.stuckLimit,
    }
    const result = simulateGame(variant, simOpts)
    byOutcome[result.outcome] += 1
    if (result.outcome === 'winner' && result.winnerName) {
      winners[result.winnerName] = (winners[result.winnerName] ?? 0) + 1
      turnSum += result.turns
      stepSum += result.steps
      won += 1
    } else if (result.outcome === 'draw') {
      turnSum += result.turns
      stepSum += result.steps
      won += 1 // count toward avg completion stats
      winners['(draw)'] = (winners['(draw)'] ?? 0) + 1
    } else {
      failures.push(result)
    }
    options.onGame?.(result, i)
  }

  return {
    games: options.games,
    byOutcome,
    winners,
    avgTurnsWhenWon: won ? turnSum / won : 0,
    avgStepsWhenWon: won ? stepSum / won : 0,
    failures,
    elapsedMs: Date.now() - t0,
  }
}

export function formatBatchSummary(summary: BatchSummary): string {
  const lines: string[] = []
  lines.push(`Games: ${summary.games} in ${(summary.elapsedMs / 1000).toFixed(2)}s`)
  lines.push(
    `Outcomes: ${Object.entries(summary.byOutcome)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ')}`,
  )
  if (summary.byOutcome.winner > 0) {
    lines.push(
      `Avg when won: ${summary.avgTurnsWhenWon.toFixed(1)} turns, ${summary.avgStepsWhenWon.toFixed(0)} steps`,
    )
    lines.push(
      `Winners: ${Object.entries(summary.winners)
        .map(([n, c]) => `${n}:${c}`)
        .join(', ')}`,
    )
  }
  const hardFails = summary.failures.filter((f) => f.outcome !== 'max_turns')
  const timeouts = summary.failures.filter((f) => f.outcome === 'max_turns')
  if (timeouts.length > 0) {
    lines.push(`Timeouts (no winner by max turns): ${timeouts.length}`)
  }
  if (hardFails.length > 0) {
    lines.push(`Hard failures: ${hardFails.length}`)
    const sample = hardFails.slice(0, 8)
    for (const f of sample) {
      const why =
        f.error ??
        (f.violations.length > 0
          ? f.violations.map((v) => `${v.code}:${v.detail}`).join('; ')
          : f.outcome)
      lines.push(
        `  seed=${f.seed} ${f.outcome} turn=${f.turns} phase=${f.lastPhase} — ${why}`,
      )
    }
    if (hardFails.length > sample.length) {
      lines.push(`  …and ${hardFails.length - sample.length} more`)
    }
  }
  return lines.join('\n')
}
