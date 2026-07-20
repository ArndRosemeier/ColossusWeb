import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hydrateVariant } from '../variant/loadVariant'
import type { VariantData } from '../types/variant'
import { formatBatchSummary, runBatch } from './runBatch'
import { simulateGame } from './simulateGame'

const here = dirname(fileURLToPath(import.meta.url))

function loadVariant() {
  const raw = readFileSync(resolve(here, '../../public/variants/Default/variant.json'), 'utf8')
  return hydrateVariant(JSON.parse(raw) as VariantData)
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.floor(n)
}

describe('AI simulation', () => {
  it('completes a single seeded AI game', () => {
    const variant = loadVariant()
    const result = simulateGame(variant, { seed: 42, players: 2, maxTurns: 400 })
    expect(result.outcome).toBe('winner')
    expect(result.winnerName).toBeTruthy()
  })

  it(
    'runs a batch of AI games and reports failures',
    { timeout: 600_000 },
    () => {
      const variant = loadVariant()
      const games = parsePositiveInt(process.env.SIM_GAMES, 50)
      const players = parsePositiveInt(process.env.SIM_PLAYERS, 2)
      const seed = parsePositiveInt(process.env.SIM_SEED, 1000)

      process.stdout.write(`Simulating ${games} games × ${players} AI, seed=${seed}\n`)

      let completed = 0
      const summary = runBatch(variant, {
        games,
        players,
        seed,
        maxTurns: parsePositiveInt(process.env.SIM_MAX_TURNS, 400),
        onGame: (r) => {
          completed += 1
          if (completed % 10 === 0 || (r.outcome !== 'winner' && r.outcome !== 'max_turns' && r.outcome !== 'draw')) {
            process.stdout.write(
              `[${completed}/${games}] seed=${r.seed} ${r.outcome}` +
                (r.winnerName ? ` winner=${r.winnerName}` : '') +
                (r.error ? ` err=${r.error}` : '') +
                (r.violations.length
                  ? ` inv=${r.violations.map((v) => v.code).join(',')}`
                  : '') +
                '\n',
            )
          }
        },
      })

      process.stdout.write('\n' + formatBatchSummary(summary) + '\n')

      expect(summary.byOutcome.error, `engine errors:\n${formatBatchSummary(summary)}`).toBe(0)
      expect(summary.byOutcome.invariant, `invariant breaks:\n${formatBatchSummary(summary)}`).toBe(0)
      expect(summary.byOutcome.stuck, `stuck games:\n${formatBatchSummary(summary)}`).toBe(0)
      expect(summary.byOutcome.max_steps, `step-cap hits:\n${formatBatchSummary(summary)}`).toBe(0)
      const finished = summary.byOutcome.winner + summary.byOutcome.draw
      expect(finished / games).toBeGreaterThanOrEqual(0.7)
      // Soft timeouts should be rare now that mutual Titan death is a draw
      expect(summary.byOutcome.max_turns / games).toBeLessThanOrEqual(0.05)
    },
  )
})
