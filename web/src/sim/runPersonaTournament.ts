import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hydrateVariant } from '../variant/loadVariant'
import type { VariantData } from '../types/variant'
import { formatTournamentSummary, runPersonaTournament } from './personaTournament'

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
const gamesPerSide = parsePositiveInt(process.env.TOURNEY_GAMES, 25)
const seed = parsePositiveInt(process.env.TOURNEY_SEED, 20_000)

process.stdout.write(
  `Running persona tournament: 4 personas, ${gamesPerSide} games × 2 seatings per matchup (6 matchups)\n`,
)

let n = 0
const summary = runPersonaTournament(variant, {
  gamesPerSide,
  seed,
  maxTurns: parsePositiveInt(process.env.SIM_MAX_TURNS, 400),
  onGame: ({ result }) => {
    n += 1
    if (n % 20 === 0) {
      process.stdout.write(
        `  [${n}] ${result.outcome}` +
          (result.winnerName ? ` ${result.winnerName}` : '') +
          '\n',
      )
    }
  },
})

process.stdout.write('\n' + formatTournamentSummary(summary) + '\n')
