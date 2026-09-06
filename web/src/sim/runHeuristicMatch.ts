import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResolvedAiProfileId } from '../ai/profiles'
import type { AiHeuristicId } from '../engine/types'
import { hydrateVariant } from '../variant/loadVariant'
import type { VariantData } from '../types/variant'
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

const ALL_HEURISTICS: AiHeuristicId[] = [
  'legacy',
  'spatial',
  'pipeline',
  'delegate',
  'perch',
  'decisive',
  'lookahead',
  'lookfight',
  'lookplus',
]

function parseHeuristics(value: string | undefined, fallback: AiHeuristicId[]): AiHeuristicId[] {
  if (value == null || value.trim() === '') return fallback
  const ids = value.split(',').map((s) => s.trim()) as AiHeuristicId[]
  for (const id of ids) {
    if (!ALL_HEURISTICS.includes(id)) {
      throw new Error(`Unknown heuristic '${id}'. Expected one of: ${ALL_HEURISTICS.join(', ')}`)
    }
  }
  return ids
}

const variant = loadVariant()
const gamesPerSide = parsePositiveInt(process.env.HEURISTIC_GAMES, 16)
const seed = parsePositiveInt(process.env.HEURISTIC_SEED, 90_000)
const maxTurns = parsePositiveInt(process.env.SIM_MAX_TURNS, 400)
const reference: AiHeuristicId = (process.env.HEURISTIC_REF as AiHeuristicId) || 'spatial'
const challengers = parseHeuristics(process.env.HEURISTIC_CHALLENGERS, ['pipeline', 'delegate', 'perch'])
const personas: ResolvedAiProfileId[] = (
  process.env.HEURISTIC_PERSONAS ?? 'aggressive,expander'
)
  .split(',')
  .map((s) => s.trim()) as ResolvedAiProfileId[]

type Row = {
  challenger: AiHeuristicId
  profile: ResolvedAiProfileId
  challengeWins: number
  refWins: number
  draws: number
  unfinished: number
  challengeWinsAsFirst: number
  games: number
}

const rows: Row[] = []
let gameIndex = 0
const t0 = Date.now()

process.stdout.write(
  `Challengers ${challengers.join(', ')} vs ${reference} · ${gamesPerSide} games × 2 seats · ${personas.join(', ')}\n`,
)

for (const challenger of challengers) {
  for (const profile of personas) {
    const row: Row = {
      challenger,
      profile,
      challengeWins: 0,
      refWins: 0,
      draws: 0,
      unfinished: 0,
      challengeWinsAsFirst: 0,
      games: 0,
    }
    for (const challengeFirst of [true, false] as const) {
      const heuristics: AiHeuristicId[] = challengeFirst
        ? [challenger, reference]
        : [reference, challenger]
      for (let g = 0; g < gamesPerSide; g++) {
        const result = simulateGame(variant, {
          seed: seed + gameIndex * 9973,
          players: 2,
          profiles: [profile, profile],
          heuristics,
          maxTurns,
        })
        gameIndex += 1
        row.games += 1
        if (result.outcome === 'winner' && result.winnerName === challenger) {
          row.challengeWins += 1
          if (challengeFirst) row.challengeWinsAsFirst += 1
        } else if (result.outcome === 'winner' && result.winnerName === reference) {
          row.refWins += 1
        } else if (result.outcome === 'draw') {
          row.draws += 1
        } else {
          row.unfinished += 1
        }
        if (gameIndex % 12 === 0) {
          process.stdout.write(
            `  [${gameIndex}] ${challenger}/${profile} ${result.outcome}` +
              (result.winnerName ? ` ${result.winnerName}` : '') +
              '\n',
          )
        }
      }
    }
    rows.push(row)
  }
}

process.stdout.write(`\nElapsed ${(Date.now() - t0) / 1000}s\n\n`)
process.stdout.write(`Vs ${reference} (same persona):\n`)
for (const r of rows) {
  const decided = r.challengeWins + r.refWins
  const pct = decided ? ((100 * r.challengeWins) / decided).toFixed(1) : '—'
  process.stdout.write(
    `  ${r.challenger.padEnd(9)} ${r.profile.padEnd(10)} ${r.challengeWins}-${r.refWins}-${r.draws}` +
      (r.unfinished ? ` unfinished=${r.unfinished}` : '') +
      `  (${pct}% challenger, n=${r.games})\n`,
  )
}
