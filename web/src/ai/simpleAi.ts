import { dispatch, getLegalRecruits, playerLegions } from '../engine/GameEngine'
import {
  isUnitAlive,
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
import { creatureCombatValue } from './legionStrength'
import { chooseCreaturesToSplitOut, chooseOpeningSplit } from './splitChoice'
import { planOptionalSplit, splitMovePolicy } from './splitPlanning'
import { planReinforcement } from './supportPlanning'
import { pickBattleSupport } from './battleSupport'

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
    return pickPostBattleReinforce(state)
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

  // Mandatory height-8 splits remain legal; optional splits must beat HOLD.
  for (const parent of forced) {
    const child = chooseCreaturesToSplitOut(state, parent)
    if (child.length === 2) return { type: 'split', parentId: parent.id, childCreatures: child }
  }
  for (const parent of fullLegionsNeedingSplit(state)) {
    const plan = planOptionalSplit(state, parent, profile)
    if (plan.childCreatures) {
      return { type: 'split', parentId: parent.id, childCreatures: plan.childCreatures }
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
  const angel = lords.find((c) => c.type === 'Angel')
  const titan = lords.find((c) => c.type === 'Titan')
  const childLord =
    angel && (rng() < profile.preferAngelOnTurn1 || !titan) ? angel : (titan ?? lords[0])
  return chooseOpeningSplit(state, parent, childLord.type, rng)
}

function pickMove(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  if (state.movementRoll == null) return { type: 'doneMove' }
  const playerId = state.players[state.activePlayerIndex].id
  const anyMoved = playerLegions(state, playerId).some((l) => l.moved)
  const splitPolicy = splitMovePolicy(state)
  if (splitPolicy.command) return splitPolicy.command
  return pickBestMove(state, profile, rng, anyMoved, new Set(splitPolicy.heldLegionIds))
}

function pickFight(state: GameState, profile: AiProfile, rng: () => number): GameCommand | null {
  if (state.activeEngagement) {
    const eng = state.activeEngagement
    if (aiDefenderShouldFlee(state)) {
      return { type: 'flee' }
    }
    // Human is attacker and/or defender — do not decide Fight/Flee for them
    if (engagementNeedsHumanInput(state)) {
      return null
    }
    // The defender's own pre-battle window: an AI that declined to flee must
    // close it before ANY battle can begin (Titan Engagements; Colossus
    // askFlee → doNotFlee, `GameServerSide.java:2719-2754`).
    if (!eng.fleeDeclined) {
      return { type: 'standFight' }
    }
    void profile
    void rng
    return { type: 'proposeAgreement', kind: 'fight' }
  }
  if (state.pendingEngagements.length === 0) return { type: 'pass' }
  const e = state.pendingEngagements[0]
  return { type: 'startEngagement', attackerId: e.attackerId, defenderId: e.defenderId }
}

type RecruitCommand = Extract<GameCommand, { type: 'recruit' }>

function scoreMusterRecruit(state: GameState, cmd: RecruitCommand): number {
  const leg = state.legions.find((l) => l.id === cmd.legionId)
  if (!leg) return -Infinity
  return scoreRecruitOption(state, cmd.creatureType, leg.hexLabel, leg)
}

/**
 * Muster picks. Full greed → global best score.
 * Lower greed may randomize among *near-best* scores only — never uniform
 * among all legal recruits (that produced 4–5 Ogre piles on cautious AI).
 */
function pickMuster(state: GameState, profile: AiProfile, rng: () => number): GameCommand {
  const legs = playerLegions(state, state.players[state.activePlayerIndex].id)
  const options: RecruitCommand[] = []
  for (const leg of legs) {
    for (const r of getLegalRecruits(state, leg.id)) {
      options.push({ type: 'recruit', legionId: leg.id, creatureType: r })
    }
  }
  if (options.length === 0) return { type: 'doneMuster' }

  const scored = options.map((cmd) => ({ cmd, rank: scoreMusterRecruit(state, cmd) }))
  let bestRank = -Infinity
  for (const s of scored) {
    if (s.rank > bestRank) bestRank = s.rank
  }

  if (profile.musterGreed >= 0.99 || rng() < profile.musterGreed) {
    return scored.find((s) => s.rank === bestRank)!.cmd
  }

  // Slack: small absolute floor so close ties can vary; never includes dumpster picks
  // (e.g. another Ogre at ~12 when Guardian/Troll/Minotaur scores ~25).
  const slack = Math.max(2, Math.abs(bestRank) * 0.12)
  const nearBest = scored.filter((s) => s.rank >= bestRank - slack)
  return nearBest[Math.floor(rng() * nearBest.length)]!.cmd
}

function pickPostBattleReinforce(state: GameState): GameCommand {
  const defender = state.legions.find((l) => l.id === state.pendingPostBattleReinforce!.legionId)!
  const creatureType = planReinforcement(listPostBattleReinforceOptions(state, defender.id), defender.hexLabel,
    (type, hex) => creatureCombatValue(state, type, hex))
  return creatureType ? { type: 'postBattleReinforce', creatureType } : { type: 'postBattleSkipReinforce' }
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

  if (battle.phase === 'Recruit' || battle.phase === 'Summon') {
    return pickBattleSupport(state, battle)
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
    return pickPostBattleReinforce(state)
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
