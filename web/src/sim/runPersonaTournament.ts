import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hydrateVariant } from '../variant/loadVariant'
import type { VariantData } from '../types/variant'
import type { ResolvedAiProfileId } from '../ai/profiles'
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

const ALL_PERSONAS: ResolvedAiProfileId[] = [
  'balanced',
  'aggressive',
  'cautious',
  'expander',
]

function parsePersonas(value: string | undefined): ResolvedAiProfileId[] | undefined {
  if (value == null || value.trim() === '') return undefined
  const ids = value.split(',').map((s) => s.trim()) as ResolvedAiProfileId[]
  for (const id of ids) {
    if (!ALL_PERSONAS.includes(id)) {
      throw new Error(`Unknown persona '${id}'. Expected one of: ${ALL_PERSONAS.join(', ')}`)
    }
  }
  return ids
}

const variant = loadVariant()
const gamesPerSide = parsePositiveInt(process.env.TOURNEY_GAMES, 25)
const seed = parsePositiveInt(process.env.TOURNEY_SEED, 20_000)
const personas = parsePersonas(process.env.TOURNEY_PERSONAS)

process.stdout.write(
  `Running persona tournament: ${(personas ?? ['balanced', 'aggressive', 'cautious', 'expander']).join(', ')}, ${gamesPerSide} games × 2 seatings per matchup\n`,
)

let n = 0
const summary = runPersonaTournament(variant, {
  personas,
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
