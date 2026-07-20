import { dispatch, getLegalRecruits, playerLegions } from '../engine/GameEngine'
import { listAllMoves } from '../engine/movement'
import {
  isUnitAlive,
  legalBattleMovesFor,
  legalStrikes,
} from '../engine/battle'
import type { GameCommand, GameState } from '../engine/types'

function actingPlayer(state: GameState) {
  if (state.battle && !state.battle.done) {
    return state.players.find((p) => p.id === state.battle!.activePlayerId) ?? null
  }
  return state.players[state.activePlayerIndex] ?? null
}

/**
 * Random-legal AI: picks a random legal action for the active player.
 */
export function pickRandomCommand(state: GameState, rng = Math.random): GameCommand | null {
  if (state.winnerId || state.draw) return null
  const player = actingPlayer(state)
  if (!player || player.kind !== 'ai' || player.dead) return null

  if (state.battle && !state.battle.done) {
    return pickBattleCommand(state, rng)
  }

  if (state.activeEngagement) {
    return pickFight(state, rng)
  }

  switch (state.phase) {
    case 'Split':
      return pickSplit(state, rng)
    case 'Move':
      return pickMove(state, rng)
    case 'Fight':
      return pickFight(state, rng)
    case 'Muster':
      return pickMuster(state, rng)
    default:
      return { type: 'pass' }
  }
}

function mustSplitLegions(state: GameState) {
  return playerLegions(state, state.players[state.activePlayerIndex].id).filter(
    (l) => l.creatures.length > 7,
  )
}

function pickSplit(state: GameState, rng: () => number): GameCommand {
  const legs = playerLegions(state, state.players[state.activePlayerIndex].id)
  const forced = mustSplitLegions(state)

  // Turn 1: Colossus requires exactly one 4:4 split with one Lord each
  if (state.turnNumber === 1 && forced.length > 0) {
    const parent = forced[0]
    const child = pickTurn1SplitChild(state, parent, rng)
    return { type: 'split', parentId: parent.id, childCreatures: child }
  }

  const candidates = forced.length > 0 ? forced : legs.filter((l) => l.creatures.length >= 5)
  const shouldSplit = forced.length > 0 || (candidates.length > 0 && rng() < 0.35)

  if (shouldSplit && candidates.length > 0) {
    const parent = candidates[Math.floor(rng() * candidates.length)]
    const types = parent.creatures.map((c) => c.type)
    const child: string[] = []
    for (const t of types) {
      if (t === 'Titan') continue
      child.push(t)
      if (child.length >= 2) break
    }
    if (child.length >= 2 && parent.creatures.length - child.length >= 2) {
      return { type: 'split', parentId: parent.id, childCreatures: child }
    }
  }
  if (forced.length > 0) {
    const parent = [...forced].sort((a, b) => b.creatures.length - a.creatures.length)[0]
    const child = parent.creatures
      .filter((c) => c.type !== 'Titan')
      .slice(0, 2)
      .map((c) => c.type)
    if (child.length >= 2 && parent.creatures.length - child.length >= 2) {
      return { type: 'split', parentId: parent.id, childCreatures: child }
    }
  }
  return { type: 'doneSplit' }
}

/** Angel or Titan + 3 creatures for the opening split. */
function pickTurn1SplitChild(
  state: GameState,
  parent: GameState['legions'][0],
  rng: () => number,
): string[] {
  const lords = parent.creatures.filter((c) => state.variant.creatures[c.type]?.lord)
  const nonLords = parent.creatures.filter((c) => !state.variant.creatures[c.type]?.lord)
  // Prefer leaving Titan on parent (split off Angel) ~70% of the time
  const angel = lords.find((c) => c.type === 'Angel')
  const titan = lords.find((c) => c.type === 'Titan')
  const childLord = angel && (rng() < 0.7 || !titan) ? angel : (titan ?? lords[0])
  const shuffled = [...nonLords]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return [childLord.type, ...shuffled.slice(0, 3).map((c) => c.type)]
}

function pickMove(state: GameState, rng: () => number): GameCommand {
  if (state.movementRoll == null) return { type: 'doneMove' }
  const playerId = state.players[state.activePlayerIndex].id
  const legs = playerLegions(state, playerId).filter((l) => !l.moved)
  const movable: { legionId: string; hex: string; teleport: boolean }[] = []
  for (const leg of legs) {
    const moves = listAllMoves(state, leg, state.movementRoll)
    for (const [hex, info] of moves) {
      movable.push({ legionId: leg.id, hex, teleport: info.teleport })
    }
  }
  if (movable.length === 0) return { type: 'doneMove' }

  const anyMoved = playerLegions(state, playerId).some((l) => l.moved)
  const attacks = movable.filter((m) =>
    state.legions.some((l) => l.hexLabel === m.hex && l.playerId !== playerId),
  )
  // Must move at least one legion if able
  if (!anyMoved || (rng() >= 0.15 || attacks.length > 0)) {
    const pool = attacks.length && rng() < 0.7 ? attacks : movable
    const choice = pool[Math.floor(rng() * pool.length)]
    return { type: 'move', legionId: choice.legionId, toHex: choice.hex, teleport: choice.teleport }
  }
  return { type: 'doneMove' }
}

function pickFight(state: GameState, rng: () => number): GameCommand {
  void rng
  if (state.activeEngagement) {
    if (!state.activeEngagement.revealed) return { type: 'revealEngagement' }
    return { type: 'proposeAgreement', kind: 'fight' }
  }
  if (state.pendingEngagements.length === 0) return { type: 'pass' }
  const e = state.pendingEngagements[0]
  return { type: 'startEngagement', attackerId: e.attackerId, defenderId: e.defenderId }
}

function pickMuster(state: GameState, rng: () => number): GameCommand {
  const legs = playerLegions(state, state.players[state.activePlayerIndex].id)
  for (const leg of legs) {
    const recruits = getLegalRecruits(state, leg.id)
    if (recruits.length) {
      const pick = recruits[Math.floor(rng() * recruits.length)]
      return { type: 'recruit', legionId: leg.id, creatureType: pick }
    }
  }
  return { type: 'doneMuster' }
}

function hexApproxDist(a: string, b: string): number {
  // Support both "x:y" MVP labels and Colossus "C1" labels
  if (a.includes(':') && b.includes(':')) {
    const [ax, ay] = a.split(':').map(Number)
    const [bx, by] = b.split(':').map(Number)
    return Math.abs(ax - bx) + Math.abs(ay - by)
  }
  const parse = (lab: string) => {
    const col = lab.charCodeAt(0) - 65
    const row = Number(lab.slice(1)) || 0
    return { col, row }
  }
  const A = parse(a)
  const B = parse(b)
  return Math.abs(A.col - B.col) + Math.abs(A.row - B.row)
}

function pickBattleCommand(state: GameState, rng: () => number): GameCommand {
  const battle = state.battle!

  if (battle.pendingCarry) {
    return { type: 'battleCarry', targetId: battle.pendingCarry.targetIds[0] }
  }
  if (battle.phase === 'Recruit') return { type: 'battleSkipReinforce' }
  if (battle.phase === 'Summon') return { type: 'battleSkipSummon' }

  const myUnits = battle.units.filter(
    (u) => u.playerId === battle.activePlayerId && isUnitAlive(state, u),
  )

  if (battle.phase === 'Move') {
    const movers = myUnits.filter((u) => !u.moved)
    for (const u of movers) {
      const moves = legalBattleMovesFor(state, battle, u)
      if (moves.length === 0) continue
      const enemies = battle.units.filter(
        (e) => e.playerId !== u.playerId && isUnitAlive(state, e) && e.hex,
      )
      if (enemies.length === 0 || !u.hex) {
        return { type: 'battleMove', unitId: u.id, toHex: moves[Math.floor(rng() * moves.length)] }
      }
      let best = moves[0]
      let bestDist = Infinity
      for (const m of moves) {
        const dist = Math.min(...enemies.map((e) => hexApproxDist(m, e.hex!)))
        if (dist < bestDist || (dist === bestDist && rng() < 0.3)) {
          bestDist = dist
          best = m
        }
      }
      return { type: 'battleMove', unitId: u.id, toHex: best }
    }
    return { type: 'battleDonePhase' }
  }

  for (const u of myUnits) {
    if (u.struck) continue
    const targets = legalStrikes(state, battle, u)
    if (targets.length) {
      return {
        type: 'battleStrike',
        attackerId: u.id,
        defenderId: targets[Math.floor(rng() * targets.length)],
      }
    }
  }
  return { type: 'battleDonePhase' }
}

/** SimpleAI: slightly better heuristics than pure random */
export function pickSimpleAiCommand(state: GameState, rng = Math.random): GameCommand | null {
  if (state.winnerId || state.draw) return null
  const player = actingPlayer(state)
  if (!player || player.kind !== 'ai' || player.dead) return null

  if (state.battle && !state.battle.done) {
    return pickBattleCommand(state, rng)
  }

  if (state.activeEngagement) {
    return pickFight(state, rng)
  }

  if (state.phase === 'Split' && mustSplitLegions(state).length > 0) {
    return pickSplit(state, rng)
  }

  if (state.phase === 'Move' && state.movementRoll != null) {
    const legs = playerLegions(state, player.id).filter((l) => !l.moved)
    type Scored = { legionId: string; hex: string; teleport: boolean; score: number }
    const scored: Scored[] = []
    for (const leg of legs) {
      const moves = listAllMoves(state, leg, state.movementRoll)
      for (const [hex, info] of moves) {
        let score = 1
        const terrain = state.variant.board.hexByLabel[hex]?.terrain
        if (terrain && terrain !== 'Tower') score += 2
        if (state.legions.some((l) => l.hexLabel === hex && l.playerId !== player.id)) {
          const enemy = state.legions.find((l) => l.hexLabel === hex && l.playerId !== player.id)!
          const myPow = leg.creatures.length
          const theirPow = enemy.creatures.length
          score += myPow >= theirPow ? 20 : 5
        }
        if (info.teleport) score += 3
        scored.push({ legionId: leg.id, hex, teleport: info.teleport, score })
      }
    }
    scored.sort((a, b) => b.score - a.score)
    const anyMoved = playerLegions(state, player.id).some((l) => l.moved)
    if (scored.length === 0) return { type: 'doneMove' }
    // Always take a strong attack / teleport if available
    if (scored[0].score >= 5) {
      const c = scored[0]
      return { type: 'move', legionId: c.legionId, toHex: c.hex, teleport: c.teleport }
    }
    // Must move at least once; otherwise wander or finish
    if (!anyMoved || rng() < 0.75) {
      const c = scored[Math.floor(rng() * Math.min(5, scored.length))]
      return { type: 'move', legionId: c.legionId, toHex: c.hex, teleport: c.teleport }
    }
    return { type: 'doneMove' }
  }

  if (state.phase === 'Muster') {
    const legs = playerLegions(state, player.id)
    let best: GameCommand | null = null
    let bestRank = -1
    for (const leg of legs) {
      const recruits = getLegalRecruits(state, leg.id)
      for (const r of recruits) {
        const power = state.variant.creatures[r]?.power ?? 0
        const skill = state.variant.creatures[r]?.skill ?? 0
        const rank = power * skill
        if (rank > bestRank) {
          bestRank = rank
          best = { type: 'recruit', legionId: leg.id, creatureType: r }
        }
      }
    }
    return best ?? { type: 'doneMuster' }
  }

  return pickRandomCommand(state, rng)
}

export function runAiUntilHuman(state: GameState, maxSteps = 80, rng = Math.random): GameState {
  let s = state
  for (let i = 0; i < maxSteps; i++) {
    if (s.winnerId || s.draw) break
    const player = s.players[s.activePlayerIndex]
    const inBattle = s.battle && !s.battle.done
    const actorId = inBattle ? s.battle!.activePlayerId : player.id
    const actor = s.players.find((p) => p.id === actorId)
    if (!actor || actor.kind !== 'ai') break
    const cmd = pickSimpleAiCommand(s, rng)
    if (!cmd) break
    s = dispatch(s, cmd, rng)
  }
  return s
}
