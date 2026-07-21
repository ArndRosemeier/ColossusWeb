import { dispatch, getLegalRecruits, playerLegions } from '../engine/GameEngine'
import {
  isUnitAlive,
  listBattleReinforceOptions,
  listBattleSummonSources,
  listPostBattleReinforceOptions,
} from '../engine/battle'
import { scoreRecruitOption } from '../engine/recruit'
import type { GameCommand, GameState, Legion } from '../engine/types'
import { profileFor, type AiProfile } from './profiles'
import { aiDefenderShouldFlee, engagementNeedsHumanInput } from './engagementDecision'
import { pickBestMove } from './evaluateMove'
import {
  pickBestBattleMove,
  pickBestBattleStrike,
  pickBestCarry,
} from './evaluateBattle'
import { creatureCombatValue, findBestSummonable } from './legionStrength'
import { chooseCreaturesToSplitOut } from './splitChoice'

function actingPlayer(state: GameState) {
  if (state.pendingPostBattleReinforce) {
    const leg = state.legions.find((l) => l.id === state.pendingPostBattleReinforce!.legionId)
    return leg ? (state.players.find((p) => p.id === leg.playerId) ?? null) : null
  }
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

  if (state.pendingPostBattleReinforce) {
    return pickPostBattleReinforce(state, profile, rng)
  }

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
    (l) => l.creatures.length > 7 && !l.splitThisTurn,
  )
}

/** Height-7 stacks that can still muster after shedding 2 (Colossus always considers these). */
function fullLegionsNeedingSplit(state: GameState) {
  return playerLegions(state, state.players[state.activePlayerIndex].id).filter(
    (l) => l.creatures.length === 7 && !l.splitThisTurn,
  )
}

function pickSplit(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  const player = state.players[state.activePlayerIndex]!
  // Colossus: cannot split without a free marker (12 per color, plus any claimed from kills)
  if (player.markersAvailable.length === 0) {
    return { type: 'doneSplit' }
  }

  const forced = mustSplitLegions(state)

  if (state.turnNumber === 1 && forced.length > 0) {
    const parent = forced[0]!
    const child = pickTurn1SplitChild(state, parent, profile, rng)
    return { type: 'split', parentId: parent.id, childCreatures: child }
  }

  // Always split height >7; always split height 7 so stacks can keep mustering
  // (Colossus SimpleAI.splitOneLegion — only skips when no marker / rare combat cases).
  const full = fullLegionsNeedingSplit(state)
  const candidates = forced.length > 0 ? forced : full
  if (candidates.length === 0) {
    return { type: 'doneSplit' }
  }

  const parent = [...candidates].sort((a, b) => b.creatures.length - a.creatures.length)[0]!
  const child =
    parent.creatures.length >= 8 && state.turnNumber === 1
      ? pickTurn1SplitChild(state, parent, profile, rng)
      : chooseCreaturesToSplitOut(state, parent)

  if (child.length >= 2 && parent.creatures.length - child.length >= 2) {
    return { type: 'split', parentId: parent.id, childCreatures: child }
  }

  // Fallback: any two non-Titans (should be rare)
  const fallback = parent.creatures
    .filter((c) => c.type !== 'Titan')
    .slice(0, 2)
    .map((c) => c.type)
  if (fallback.length >= 2 && parent.creatures.length - fallback.length >= 2) {
    return { type: 'split', parentId: parent.id, childCreatures: fallback }
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

function pickFight(state: GameState, profile: AiProfile, rng: () => number): GameCommand | null {
  if (state.activeEngagement) {
    if (aiDefenderShouldFlee(state)) {
      return { type: 'flee' }
    }
    // Human is attacker and/or defender — do not decide Fight/Flee for them
    if (engagementNeedsHumanInput(state)) {
      return null
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
    let bestRank = -Infinity
    for (const leg of legs) {
      const recruits = getLegalRecruits(state, leg.id)
      for (const r of recruits) {
        const rank = scoreRecruitOption(state, r, leg.hexLabel, leg)
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
    let best = options[0]!
    let bestRank = -Infinity
    for (const cmd of options) {
      if (cmd.type !== 'recruit') continue
      const leg = state.legions.find((l) => l.id === cmd.legionId)
      if (!leg) continue
      const rank = scoreRecruitOption(state, cmd.creatureType, leg.hexLabel, leg)
      if (rank > bestRank) {
        bestRank = rank
        best = cmd
      }
    }
    return best
  }
  return options[Math.floor(rng() * options.length)]!
}

function pickBattleReinforce(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  const battle = state.battle!
  const opts = listBattleReinforceOptions(state, battle)
  if (opts.length === 0) return { type: 'battleSkipReinforce' }
  if (rng() < profile.skipReinforceChance) return { type: 'battleSkipReinforce' }
  const def = state.legions.find((l) => l.id === battle.defenderLegionId)!
  let best = opts[0]!
  let bestVal = -Infinity
  for (const c of opts) {
    const v = creatureCombatValue(state, c, def.hexLabel)
    if (v > bestVal) {
      bestVal = v
      best = c
    }
  }
  return { type: 'battleReinforce', creatureType: best }
}

function pickPostBattleReinforce(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  const pending = state.pendingPostBattleReinforce!
  const opts = listPostBattleReinforceOptions(state, pending.legionId)
  if (opts.length === 0) return { type: 'postBattleSkipReinforce' }
  if (rng() < profile.skipReinforceChance) return { type: 'postBattleSkipReinforce' }
  const def = state.legions.find((l) => l.id === pending.legionId)!
  let best = opts[0]!
  let bestVal = -Infinity
  for (const c of opts) {
    const v = creatureCombatValue(state, c, def.hexLabel)
    if (v > bestVal) {
      bestVal = v
      best = c
    }
  }
  return { type: 'postBattleReinforce', creatureType: best }
}

function pickBattleSummon(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  const battle = state.battle!
  const sources = listBattleSummonSources(state, battle)
  if (sources.length === 0) return { type: 'battleSkipSummon' }
  if (rng() < profile.skipSummonChance) return { type: 'battleSkipSummon' }
  const best = findBestSummonable(
    state,
    state.legions.find((l) => l.id === battle.attackerLegionId)!,
  )
  if (!best) return { type: 'battleSkipSummon' }
  return { type: 'battleSummon', fromLegionId: best.fromLegionId }
}

function pickBattleCommand(
  state: GameState,
  profile: AiProfile,
  rng: () => number,
): GameCommand {
  const battle = state.battle!

  if (battle.pendingCarry) {
    return pickBestCarry(state, battle, profile)
  }

  if (battle.phase === 'Recruit') {
    return pickBattleReinforce(state, profile, rng)
  }
  if (battle.phase === 'Summon') {
    return pickBattleSummon(state, profile, rng)
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
    return pickBestBattleMove(state, battle, profile, rng)
  }

  // Strike / Strikeback
  return pickBestBattleStrike(state, battle, profile, rng)
}

/** Single AI core — behavior varies by player.aiProfileId. */
export function pickAiCommand(state: GameState, rng = Math.random): GameCommand | null {
  if (state.winnerId || state.draw) return null
  const player = actingPlayer(state)
  if (!player || player.kind !== 'ai' || player.dead) return null
  const profile = profileOf(state)

  if (state.pendingPostBattleReinforce) {
    return pickPostBattleReinforce(state, profile, rng)
  }

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
    // Colossus SimpleAI.handleMulligans: turn 1, roll 2 or 5 → mulligan once
    if (
      state.turnNumber === 1 &&
      state.mulliganAvailable &&
      (state.movementRoll === 2 || state.movementRoll === 5)
    ) {
      return { type: 'mulligan' }
    }
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
  // Engagement reply (flee / fight) may belong to a human even on an AI mover's turn
  if (engagementNeedsHumanInput(state)) return false
  if (state.pendingPostBattleReinforce) {
    const leg = state.legions.find((l) => l.id === state.pendingPostBattleReinforce!.legionId)
    const actor = leg ? state.players.find((p) => p.id === leg.playerId) : undefined
    return Boolean(actor && actor.kind === 'ai' && !actor.dead)
  }
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
