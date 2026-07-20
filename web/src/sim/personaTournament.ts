import type { ResolvedAiProfileId } from '../ai/profiles'
import type { LoadedVariant } from '../variant/loadVariant'
import { simulateGame, type SimResult } from './simulateGame'

export type MatchupResult = {
  a: ResolvedAiProfileId
  b: ResolvedAiProfileId
  aWins: number
  bWins: number
  draws: number
  unfinished: number
  games: number
  /** Wins for `a` when `a` moves first (seat 0) */
  aWinsAsFirst: number
  /** Wins for `a` when `a` moves second */
  aWinsAsSecond: number
  samples: SimResult[]
}

export type TournamentSummary = {
  personas: ResolvedAiProfileId[]
  gamesPerMatchup: number
  matchups: MatchupResult[]
  wins: Record<ResolvedAiProfileId, number>
  losses: Record<ResolvedAiProfileId, number>
  draws: Record<ResolvedAiProfileId, number>
  unfinished: number
  elapsedMs: number
}

export type TournamentOptions = {
  personas?: ResolvedAiProfileId[]
  /** Games per seating (A-first and B-first each get this many) */
  gamesPerSide?: number
  seed?: number
  maxTurns?: number
  onGame?: (info: {
    a: ResolvedAiProfileId
    b: ResolvedAiProfileId
    aFirst: boolean
    result: SimResult
    index: number
  }) => void
}

/**
 * Pairwise 2-player tournament: every unordered pair of distinct personas,
 * with `gamesPerSide` games for each seating order.
 */
export function runPersonaTournament(
  variant: LoadedVariant,
  options: TournamentOptions = {},
): TournamentSummary {
  const personas: ResolvedAiProfileId[] =
    options.personas ?? ['balanced', 'aggressive', 'cautious', 'expander']
  const gamesPerSide = options.gamesPerSide ?? 20
  const baseSeed = options.seed ?? 10_000
  const maxTurns = options.maxTurns ?? 400

  const wins = Object.fromEntries(personas.map((p) => [p, 0])) as Record<
    ResolvedAiProfileId,
    number
  >
  const losses = Object.fromEntries(personas.map((p) => [p, 0])) as Record<
    ResolvedAiProfileId,
    number
  >
  const drawCounts = Object.fromEntries(personas.map((p) => [p, 0])) as Record<
    ResolvedAiProfileId,
    number
  >
  let unfinished = 0
  const matchups: MatchupResult[] = []
  let gameIndex = 0
  const t0 = Date.now()

  for (let i = 0; i < personas.length; i++) {
    for (let j = i + 1; j < personas.length; j++) {
      const a = personas[i]!
      const b = personas[j]!
      const mu: MatchupResult = {
        a,
        b,
        aWins: 0,
        bWins: 0,
        draws: 0,
        unfinished: 0,
        games: 0,
        aWinsAsFirst: 0,
        aWinsAsSecond: 0,
        samples: [],
      }

      for (const aFirst of [true, false] as const) {
        const profiles: ResolvedAiProfileId[] = aFirst ? [a, b] : [b, a]
        for (let g = 0; g < gamesPerSide; g++) {
          const seed = baseSeed + gameIndex * 9973
          const result = simulateGame(variant, {
            seed,
            players: 2,
            profiles,
            maxTurns,
          })
          mu.games += 1
          gameIndex += 1
          options.onGame?.({ a, b, aFirst, result, index: gameIndex })

          if (result.outcome === 'winner' && result.winnerName) {
            const winner = result.winnerName as ResolvedAiProfileId
            if (winner === a) {
              mu.aWins += 1
              wins[a] += 1
              losses[b] += 1
              if (aFirst) mu.aWinsAsFirst += 1
              else mu.aWinsAsSecond += 1
            } else if (winner === b) {
              mu.bWins += 1
              wins[b] += 1
              losses[a] += 1
            }
          } else if (result.outcome === 'draw') {
            mu.draws += 1
            drawCounts[a] += 1
            drawCounts[b] += 1
          } else {
            mu.unfinished += 1
            unfinished += 1
            if (mu.samples.length < 3) mu.samples.push(result)
          }
        }
      }

      matchups.push(mu)
    }
  }

  return {
    personas,
    gamesPerMatchup: gamesPerSide * 2,
    matchups,
    wins,
    losses,
    draws: drawCounts,
    unfinished,
    elapsedMs: Date.now() - t0,
  }
}

export function formatTournamentSummary(summary: TournamentSummary): string {
  const lines: string[] = []
  lines.push(
    `Persona tournament: ${summary.personas.join(', ')} · ${summary.gamesPerMatchup} games/matchup · ${(summary.elapsedMs / 1000).toFixed(1)}s`,
  )
  lines.push('')
  lines.push('Standings (W-L-D):')
  const ranked = [...summary.personas].sort((x, y) => {
    const wx = summary.wins[x] ?? 0
    const wy = summary.wins[y] ?? 0
    if (wy !== wx) return wy - wx
    return (summary.losses[x] ?? 0) - (summary.losses[y] ?? 0)
  })
  for (const p of ranked) {
    const w = summary.wins[p] ?? 0
    const l = summary.losses[p] ?? 0
    const d = summary.draws[p] ?? 0
    const decided = w + l
    const pct = decided ? ((100 * w) / decided).toFixed(1) : '—'
    lines.push(`  ${p.padEnd(10)} ${w}-${l}-${d}  (${pct}% of decided)`)
  }
  lines.push('')
  lines.push('Matchups:')
  for (const m of summary.matchups) {
    const decided = m.aWins + m.bWins
    const ap = decided ? ((100 * m.aWins) / decided).toFixed(0) : '—'
    lines.push(
      `  ${m.a} vs ${m.b}: ${m.aWins}-${m.bWins}-${m.draws}` +
        (m.unfinished ? ` unfinished=${m.unfinished}` : '') +
        ` (${m.a} ${ap}% of decided, n=${m.games})`,
    )
  }
  if (summary.unfinished > 0) {
    lines.push('')
    lines.push(`Unfinished games: ${summary.unfinished}`)
    for (const m of summary.matchups) {
      for (const s of m.samples) {
        lines.push(
          `  sample seed=${s.seed} ${s.outcome} turn=${s.turns} — ${s.error ?? s.lastMessage}`,
        )
      }
    }
  }
  return lines.join('\n')
}

export type FfaSummary = {
  personas: ResolvedAiProfileId[]
  games: number
  wins: Record<ResolvedAiProfileId, number>
  draws: number
  unfinished: number
  unfinishedSamples: SimResult[]
  /** Wins when sitting in seat 0 (first in turn order after setup shuffle still applies via seed) */
  winsBySeat: number[]
  elapsedMs: number
}

export type FfaOptions = {
  personas?: ResolvedAiProfileId[]
  games?: number
  seed?: number
  maxTurns?: number
  onGame?: (info: { profiles: ResolvedAiProfileId[]; result: SimResult; index: number }) => void
}

/** Rotate `arr` left by `k` positions. */
function rotateLeft<T>(arr: readonly T[], k: number): T[] {
  const n = arr.length
  const shift = ((k % n) + n) % n
  return [...arr.slice(shift), ...arr.slice(0, shift)]
}

/**
 * Free-for-all: every game seats all personas (rotated each game so seat bias averages out).
 */
export function runFourPlayerFfa(
  variant: LoadedVariant,
  options: FfaOptions = {},
): FfaSummary {
  const personas: ResolvedAiProfileId[] =
    options.personas ?? ['balanced', 'aggressive', 'cautious', 'expander']
  if (personas.length !== 4) {
    throw new Error(`FFA expects 4 personas, got ${personas.length}`)
  }
  const games = options.games ?? 100
  const baseSeed = options.seed ?? 30_000
  const maxTurns = options.maxTurns ?? 500

  const wins = Object.fromEntries(personas.map((p) => [p, 0])) as Record<
    ResolvedAiProfileId,
    number
  >
  let draws = 0
  let unfinished = 0
  const unfinishedSamples: SimResult[] = []
  const winsBySeat = [0, 0, 0, 0]
  const t0 = Date.now()

  for (let i = 0; i < games; i++) {
    const profiles = rotateLeft(personas, i)
    const result = simulateGame(variant, {
      seed: baseSeed + i * 9973,
      players: 4,
      profiles,
      maxTurns,
    })
    options.onGame?.({ profiles, result, index: i + 1 })

    if (result.outcome === 'winner' && result.winnerName) {
      const winner = result.winnerName as ResolvedAiProfileId
      wins[winner] = (wins[winner] ?? 0) + 1
      const seat = profiles.indexOf(winner)
      if (seat >= 0) winsBySeat[seat] = (winsBySeat[seat] ?? 0) + 1
    } else if (result.outcome === 'draw') {
      draws += 1
    } else {
      unfinished += 1
      if (unfinishedSamples.length < 5) unfinishedSamples.push(result)
    }
  }

  return {
    personas,
    games,
    wins,
    draws,
    unfinished,
    unfinishedSamples,
    winsBySeat,
    elapsedMs: Date.now() - t0,
  }
}

export function formatFfaSummary(summary: FfaSummary): string {
  const lines: string[] = []
  const decided = summary.games - summary.draws - summary.unfinished
  lines.push(
    `4-player FFA: ${summary.personas.join(', ')} · ${summary.games} games · ${(summary.elapsedMs / 1000).toFixed(1)}s`,
  )
  lines.push(
    `Finished: ${decided} wins, ${summary.draws} draws, ${summary.unfinished} unfinished`,
  )
  lines.push('')
  lines.push('Win share (of decided games):')
  const ranked = [...summary.personas].sort(
    (a, b) => (summary.wins[b] ?? 0) - (summary.wins[a] ?? 0),
  )
  for (const p of ranked) {
    const w = summary.wins[p] ?? 0
    const pct = decided ? ((100 * w) / decided).toFixed(1) : '—'
    const vsFair = decided ? ((w / decided) / (1 / summary.personas.length)).toFixed(2) : '—'
    lines.push(`  ${p.padEnd(10)} ${String(w).padStart(3)} wins  ${pct}%  (${vsFair}× fair share)`)
  }
  lines.push('')
  lines.push(
    `Seat wins (rotated seating): ${summary.winsBySeat.map((n, i) => `S${i}=${n}`).join(' ')}`,
  )
  if (summary.unfinishedSamples.length > 0) {
    lines.push('')
    lines.push('Unfinished samples:')
    for (const s of summary.unfinishedSamples) {
      lines.push(
        `  seed=${s.seed} ${s.outcome} turn=${s.turns} — ${s.error ?? s.lastMessage}`,
      )
    }
  }
  return lines.join('\n')
}
