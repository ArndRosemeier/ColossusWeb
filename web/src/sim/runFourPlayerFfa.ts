import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hydrateVariant } from '../variant/loadVariant'
import type { VariantData } from '../types/variant'
import { formatFfaSummary, runFourPlayerFfa } from './personaTournament'

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

const variant = loadVariant()
const games = parsePositiveInt(process.env.FFA_GAMES, 100)
const seed = parsePositiveInt(process.env.FFA_SEED, 40_000)

process.stdout.write(
  `Running 4-player FFA: all personas each game, ${games} games (rotated seats)\n`,
)

const summary = runFourPlayerFfa(variant, {
  games,
  seed,
  maxTurns: parsePositiveInt(process.env.SIM_MAX_TURNS, 500),
  onGame: ({ result, index }) => {
    if (index % 10 === 0) {
      process.stdout.write(
        `  [${index}/${games}] ${result.outcome}` +
          (result.winnerName ? ` ${result.winnerName}` : '') +
          ` turn=${result.turns}\n`,
      )
    }
  },
})

process.stdout.write('\n' + formatFfaSummary(summary) + '\n')
