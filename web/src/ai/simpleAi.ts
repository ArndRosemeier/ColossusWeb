import { dispatch, getLegalRecruits, playerLegions } from '../engine/GameEngine'
import {
  isUnitAlive,
  legalBattleMovesFor,
  legalStrikes,
} from '../engine/battle'
import { canFlee } from '../engine/engagement'
import type { GameCommand, GameState, Legion } from '../engine/types'
import { profileFor, type AiProfile } from './profiles'
import { estimateBattleOutcome } from './battleEstimate'
import { pickBestMove } from './evaluateMove'

function actingPlayer(state: GameState) {
  if (state.battle && !state.battle.done) {
    return state.players.find((p) => p.id === state.battle!.activePlayerId) ?? null
  }
  return state.players[state.activePlayerIndex] ?? null
}

function profileOf(state: GameState): AiProfile {
  const p = actingPlayer(state)
  return profileFor(p?.aiProfileId)
}

/**
 * Random-legal AI: picks a random legal action for the active player.
 */
export function pickRandomCommand(state: GameState, rng = Math.random): GameCommand | null {
  if (state.winnerId || state.draw) return null
  const player = actingPlayer(state)
  if (!player || player.kind !== 'ai' || player.dead) return null
  const profile = profileOf(state)

  if (state.battle && !state.battle.done) {
    return pickBattleCommand(state, profile, rng)
  }

  if (state.activeEngagement) {
    return pickFight(state, profile, rng)
  }

  switch (state.phase) {
    case 'Split':
      return pickSplit(state, profile, rng)
    case 'Move':
      return pickMove(state, profile, rng)
    case 'Fight':
      return pickFight(state, profile, rng)
    case 'Muster':
      return pickMuster(state, profile, rng)
    default:
      return { type: 'pass' }
  }
}

function mustSplitLegions(state: GameState) {
  return playerLegions(state, state.players[state.activePlayerIndex].id).filter(
    (l) => l.creatures.length > 7,
  )
}

function pickSplit(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  const legs = playerLegions(state, state.players[state.activePlayerIndex].id)
  const forced = mustSplitLegions(state)

  if (state.turnNumber === 1 && forced.length > 0) {
    const parent = forced[0]
    const child = pickTurn1SplitChild(state, parent, profile, rng)
    return { type: 'split', parentId: parent.id, childCreatures: child }
  }

  const candidates = forced.length > 0 ? forced : legs.filter((l) => l.creatures.length >= 5)
  const shouldSplit = forced.length > 0 || (candidates.length > 0 && rng() < profile.splitChance)

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

function pickTurn1SplitChild(
  state: GameState,
  parent: Legion,
  profile: AiProfile,
  rng: () => number,
): string[] {
  const lords = parent.creatures.filter((c) => state.variant.creatures[c.type]?.lord)
  const nonLords = parent.creatures.filter((c) => !state.variant.creatures[c.type]?.lord)
  const angel = lords.find((c) => c.type === 'Angel')
  const titan = lords.find((c) => c.type === 'Titan')
  const childLord =
    angel && (rng() < profile.preferAngelOnTurn1 || !titan) ? angel : (titan ?? lords[0])
  const shuffled = [...nonLords]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return [childLord.type, ...shuffled.slice(0, 3).map((c) => c.type)]
}

function pickMove(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  if (state.movementRoll == null) return { type: 'doneMove' }
  const playerId = state.players[state.activePlayerIndex].id
  const anyMoved = playerLegions(state, playerId).some((l) => l.moved)
  return pickBestMove(state, profile, rng, anyMoved)
}

function pickFight(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  if (state.activeEngagement) {
    if (!state.activeEngagement.revealed) return { type: 'revealEngagement' }
    const eng = state.activeEngagement
    const attacker = state.legions.find((l) => l.id === eng.attackerId)!
    const defender = state.legions.find((l) => l.id === eng.defenderId)!
    const defPlayer = state.players.find((p) => p.id === defender.playerId)
    if (defPlayer?.kind === 'ai' && canFlee(state, defender)) {
      const defProfile = profileFor(defPlayer.aiProfileId)
      if (defProfile.fleeOutnumberRatio > 0) {
        // Outcome is from the attacker's perspective
        const { outcome, ratio } = estimateBattleOutcome(
          state,
          attacker,
          defender,
          defender.hexLabel,
        )
        const heightRatio = attacker.creatures.length / Math.max(1, defender.creatures.length)
        const attackerCrushing =
          outcome === 'winMinimal' ||
          outcome === 'winHeavy' ||
          (outcome === 'draw' && defProfile.id === 'cautious')
        if (
          attackerCrushing ||
          heightRatio >= defProfile.fleeOutnumberRatio ||
          ratio >= defProfile.fleeOutnumberRatio
        ) {
          return { type: 'flee' }
        }
      }
    }
    void profile
    void rng
    return { type: 'proposeAgreement', kind: 'fight' }
  }
  if (state.pendingEngagements.length === 0) return { type: 'pass' }
  const e = state.pendingEngagements[0]
  return { type: 'startEngagement', attackerId: e.attackerId, defenderId: e.defenderId }
}

function pickMuster(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  const legs = playerLegions(state, state.players[state.activePlayerIndex].id)
  if (profile.musterGreed >= 0.99) {
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

  const options: GameCommand[] = []
  for (const leg of legs) {
    for (const r of getLegalRecruits(state, leg.id)) {
      options.push({ type: 'recruit', legionId: leg.id, creatureType: r })
    }
  }
  if (options.length === 0) return { type: 'doneMuster' }
  if (rng() < profile.musterGreed) {
    let best = options[0]
    let bestRank = -1
    for (const cmd of options) {
      if (cmd.type !== 'recruit') continue
      const power = state.variant.creatures[cmd.creatureType]?.power ?? 0
      const skill = state.variant.creatures[cmd.creatureType]?.skill ?? 0
      const rank = power * skill
      if (rank > bestRank) {
        bestRank = rank
        best = cmd
      }
    }
    return best
  }
  return options[Math.floor(rng() * options.length)]
}

function hexApproxDist(a: string, b: string): number {
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

function pickBattleCommand(
  state: GameState,
  profile: AiProfile,
  rng: () => number,
): GameCommand {
  const battle = state.battle!

  if (battle.pendingCarry) {
    return { type: 'battleCarry', targetId: battle.pendingCarry.targetIds[0] }
  }

  if (battle.phase === 'Recruit') {
    if (rng() < profile.skipReinforceChance) return { type: 'battleSkipReinforce' }
    return { type: 'battleSkipReinforce' }
  }
  if (battle.phase === 'Summon') {
    if (rng() < profile.skipSummonChance) return { type: 'battleSkipSummon' }
    return { type: 'battleSkipSummon' }
  }

  const myUnits = battle.units.filter(
    (u) => u.playerId === battle.activePlayerId && isUnitAlive(state, u),
  )
  const enemies = battle.units.filter(
    (e) => e.playerId !== battle.activePlayerId && isUnitAlive(state, e),
  )

  if (
    profile.concedeWhenHopelessChance > 0 &&
    myUnits.length > 0 &&
    enemies.length >= myUnits.length * 3 &&
    rng() < profile.concedeWhenHopelessChance
  ) {
    return { type: 'concedeBattle' }
  }

  if (battle.phase === 'Move') {
    const movers = myUnits.filter((u) => !u.moved)
    for (const u of movers) {
      const moves = legalBattleMovesFor(state, battle, u)
      if (moves.length === 0) continue
      const enemyHexes = enemies.filter((e) => e.hex)
      if (enemyHexes.length === 0 || !u.hex) {
        return { type: 'battleMove', unitId: u.id, toHex: moves[Math.floor(rng() * moves.length)] }
      }
      let best = moves[0]
      let bestScore = -Infinity
      for (const m of moves) {
        const dist = Math.min(...enemyHexes.map((e) => hexApproxDist(m, e.hex!)))
        // Higher approach weight → prefer smaller distance
        const score = -dist * profile.battleApproachEnemy + rng() * 0.1
        if (score > bestScore) {
          bestScore = score
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

/** Single AI core — behavior varies by player.aiProfileId. */
export function pickAiCommand(state: GameState, rng = Math.random): GameCommand | null {
  if (state.winnerId || state.draw) return null
  const player = actingPlayer(state)
  if (!player || player.kind !== 'ai' || player.dead) return null
  const profile = profileOf(state)

  if (state.battle && !state.battle.done) {
    return pickBattleCommand(state, profile, rng)
  }

  if (state.activeEngagement) {
    return pickFight(state, profile, rng)
  }

  if (state.phase === 'Split' && mustSplitLegions(state).length > 0) {
    return pickSplit(state, profile, rng)
  }

  if (state.phase === 'Move' && state.movementRoll != null) {
    return pickMove(state, profile, rng)
  }

  if (state.phase === 'Muster') {
    return pickMuster(state, profile, rng)
  }

  return pickRandomCommand(state, rng)
}

/** True when the player who must act now is an AI (master or battle). */
export function isAiActing(state: GameState): boolean {
  if (state.winnerId || state.draw) return false
  const player = state.players[state.activePlayerIndex]
  const inBattle = Boolean(state.battle && !state.battle.done)
  const actorId = inBattle ? state.battle!.activePlayerId : player?.id
  const actor = state.players.find((p) => p.id === actorId)
  return Boolean(actor && actor.kind === 'ai' && !actor.dead)
}

/** @deprecated alias — use pickAiCommand */
export const pickSimpleAiCommand = pickAiCommand

export function runAiUntilHuman(state: GameState, maxSteps = 80, rng = () => Math.random()): GameState {
  let s = state
  for (let i = 0; i < maxSteps; i++) {
    if (!isAiActing(s)) break
    const cmd = pickAiCommand(s, rng)
    if (!cmd) break
    s = dispatch(s, cmd, rng)
  }
  return s
}
