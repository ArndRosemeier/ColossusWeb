import type { LoadedVariant } from '../variant/loadVariant'
import { resolveAiProfileId } from '../ai/profiles'
import {
  applyBattleResult,
  advanceBattlePhase,
  battleLand,
  checkBattleEnd,
  checkTitanDeath,
  doCarry,
  getStrikeDice,
  getStrikeNumber,
  isUnitAlive,
  legalBattleMovesFor,
  legalStrikes,
  resolveStrike,
  startBattle,
  MAX_BATTLE_TURNS,
} from './battle'
import { battleNeighbors } from './battleland'
import {
  canFlee,
  resolveAgreement,
  resolveEngagementConcession,
} from './engagement'
import { listAllMoves, rollDie } from './movement'
import { applyRecruit, listRecruits } from './recruit'
import {
  type DiceRollDisplay,
  type GameCommand,
  type GameState,
  type Legion,
  type NewGameOptions,
  type PendingDiceRoll,
  type PlayerState,
  PLAYER_COLORS,
} from './types'

function newDiceId(): string {
  return `dice-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function setDiceRoll(
  state: GameState,
  id: string,
  partial: Omit<DiceRollDisplay, 'id'>,
): void {
  state.diceRoll = { id, ...partial }
}

function clearDiceRoll(state: GameState): void {
  state.diceRoll = null
}

function setPendingDice(state: GameState, partial: Omit<PendingDiceRoll, 'id'>): void {
  state.pendingDice = { id: newDiceId(), ...partial }
  state.diceRoll = null
}

function rollFaces(count: number, rng: () => number, forced?: number[]): number[] {
  if (forced != null) {
    if (forced.length !== count) {
      throw new Error(`Expected ${count} dice, got ${forced.length}`)
    }
    for (const d of forced) {
      if (d < 1 || d > 6) throw new Error(`Invalid die face ${d}`)
    }
    return [...forced]
  }
  return Array.from({ length: count }, () => rollDie(rng))
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Seeded PRNG for reproducible games / simulations */
export function createRng(seed: number): () => number {
  return mulberry32(seed)
}

let legionSeq = 1

export const MARKERS_PER_COLOR = 12

/** Colossus marker ids for a color: Rd01…Rd09, Rd10…Rd12. */
export function allMarkersForColor(shortName: string): string[] {
  const out: string[] = []
  for (let i = 1; i <= MARKERS_PER_COLOR; i++) {
    out.push(`${shortName}${String(i).padStart(2, '0')}`)
  }
  return out
}

/** Take the lowest free marker id (sorted). */
export function takeMarker(player: PlayerState): string {
  if (player.markersAvailable.length === 0) {
    throw new Error('No legion markers available (maximum 12 legions)')
  }
  player.markersAvailable.sort((a, b) => a.localeCompare(b))
  return player.markersAvailable.shift()!
}

export function returnMarker(player: PlayerState, markerIdValue: string): void {
  if (!player.markersAvailable.includes(markerIdValue)) {
    player.markersAvailable.push(markerIdValue)
  }
}

export function createGame(variant: LoadedVariant, options: NewGameOptions): GameState {
  const rng = mulberry32(options.seed ?? Date.now())
  const towers = [...variant.board.towers]
  // Shuffle towers
  for (let i = towers.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[towers[i], towers[j]] = [towers[j], towers[i]]
  }

  const caretaker: Record<string, number> = {}
  for (const c of variant.data.creatures) {
    caretaker[c.name] = c.count
  }

  const players: PlayerState[] = options.players.map((p, i) => {
    const color =
      PLAYER_COLORS.find((c) => c.id === p.colorId) ?? PLAYER_COLORS[i % PLAYER_COLORS.length]
    const aiProfileId =
      p.kind === 'ai' ? resolveAiProfileId(p.aiProfileId ?? 'balanced', rng) : null
    return {
      id: `p${i}`,
      name: p.name,
      color,
      kind: p.kind,
      aiProfileId,
      startingTower: towers[i],
      score: 0,
      dead: false,
      titanPower: 6,
      hasTeleported: false,
      markersAvailable: allMarkersForColor(color.shortName),
    }
  })

  const legions: Legion[] = []
  const primaryAcquirable = variant.data.acquirables[0]?.name ?? 'Angel'
  for (const player of players) {
    const starting = variant.terrains.Tower?.starting ?? [
      { name: 'Centaur', number: 2 },
      { name: 'Gargoyle', number: 2 },
      { name: 'Ogre', number: 2 },
    ]
    // Match Colossus GameServerSide.getStartingLegion:
    // Titan + primary acquirable (Angel) + two of each tower starter.
    const creatures: { type: string; hits: number }[] = [
      { type: 'Titan', hits: 0 },
      { type: primaryAcquirable, hits: 0 },
    ]
    caretaker.Titan = (caretaker.Titan ?? 1) - 1
    caretaker[primaryAcquirable] = (caretaker[primaryAcquirable] ?? 1) - 1

    // Colossus order: startCre[2]x2, startCre[0]x2, startCre[1]x2
    const ordered = [2, 0, 1].map((i) => starting[i]).filter(Boolean)
    for (const s of ordered) {
      for (let n = 0; n < s.number; n++) {
        creatures.push({ type: s.name, hits: 0 })
        caretaker[s.name] = (caretaker[s.name] ?? 0) - 1
      }
    }

    const startingMarker = takeMarker(player)
    legions.push({
      id: `leg-${legionSeq++}`,
      markerId: startingMarker,
      playerId: player.id,
      hexLabel: player.startingTower,
      creatures,
      moved: false,
      teleported: false,
      recruited: false,
      enteredFrom: null,
    })
  }

  const state: GameState = {
    variant,
    players,
    legions,
    caretaker,
    phase: 'Split',
    activePlayerIndex: 0,
    turnNumber: 1,
    movementRoll: null,
    diceRoll: null,
    pendingDice: null,
    diceMode: options.diceMode ?? 'rng',
    mulliganAvailable: true,
    selectedLegionId: null,
    legalHexes: [],
    battle: null,
    pendingEngagements: [],
    activeEngagement: null,
    message: `${players[0].name}: Split phase — initial legion is 8-high (Titan+Angel+6); split before moving`,
    winnerId: null,
    draw: false,
    log: [`Game started with ${players.length} players`],
  }

  return state
}

export function activePlayer(state: GameState): PlayerState {
  return state.players[state.activePlayerIndex]
}

export function playerLegions(state: GameState, playerId: string): Legion[] {
  return state.legions.filter((l) => l.playerId === playerId)
}

export function dispatch(state: GameState, command: GameCommand, rng = Math.random): GameState {
  if (state.winnerId || state.draw) return state
  const next = structuredClone(state) as GameState
  // structuredClone drops class instances; variant is plain data — reattach
  next.variant = state.variant

  try {
    applyCommand(next, command, rng)
  } catch (e) {
    next.message = e instanceof Error ? e.message : String(e)
  }
  return next
}

function applyCommand(state: GameState, command: GameCommand, rng: () => number): void {
  if (command.type === 'commitDice') {
    commitPendingDice(state, rng, command.values)
    return
  }
  if (state.pendingDice) {
    state.message = 'Waiting for dice to settle'
    return
  }

  if (state.battle && state.battle.done === false) {
    handleBattleCommand(state, command, rng)
    return
  }

  // Pre-battle engagement resolution
  if (state.activeEngagement && state.phase === 'Fight') {
    handleEngagementCommand(state, command, rng)
    return
  }

  switch (command.type) {
    case 'selectLegion':
      selectLegion(state, command.legionId)
      break
    case 'split':
      doSplit(state, command.parentId, command.childCreatures)
      break
    case 'doneSplit':
      if (playerLegions(state, activePlayer(state).id).some((l) => l.creatures.length > 7)) {
        state.message = 'Legions taller than 7 must split before leaving Split phase'
        break
      }
      beginMovePhase(state, rng)
      break
    case 'move':
      doMove(state, command.legionId, command.toHex)
      break
    case 'undoMove':
      state.message = 'Undo not implemented'
      break
    case 'mulligan':
      doMulligan(state, rng)
      break
    case 'doneMove':
      if (!canEndMovePhase(state)) {
        state.message = 'You must move at least one legion if able'
        break
      }
      beginFightPhase(state)
      break
    case 'startEngagement':
      openEngagement(state, command.attackerId, command.defenderId)
      break
    case 'recruit':
      doRecruit(state, command.legionId, command.creatureType)
      break
    case 'doneMuster':
      endTurn(state, rng)
      break
    case 'pass':
      passPhase(state, rng)
      break
    default:
      state.message = `Command not valid outside battle: ${command.type}`
  }
}

function doMulligan(state: GameState, rng: () => number): void {
  if (state.phase !== 'Move') throw new Error('Not move phase')
  if (state.turnNumber !== 1 || !state.mulliganAvailable) {
    throw new Error('Mulligan not available')
  }
  if (playerLegions(state, activePlayer(state).id).some((l) => l.moved)) {
    throw new Error('Cannot mulligan after moving')
  }
  state.mulliganAvailable = false
  const player = activePlayer(state)
  if (state.diceMode === 'physical') {
    setPendingDice(state, {
      context: 'mulligan',
      dieCount: 1,
      playerId: player.id,
      label: `${player.name} mulligan`,
    })
    state.message = `${player.name} mulligans — rolling…`
    return
  }
  applyMovementRoll(state, rng, 'mulligan', `${player.name} mulligan`, player.id)
}

function applyMovementRoll(
  state: GameState,
  rng: () => number,
  context: 'movement' | 'mulligan',
  label: string,
  playerId: string,
  forced?: number[],
  rollId?: string,
): void {
  const values = rollFaces(1, rng, forced)
  state.movementRoll = values[0]!
  setDiceRoll(state, rollId ?? newDiceId(), {
    context,
    values,
    label,
    playerId,
  })
  if (context === 'mulligan') {
    state.message = `${activePlayer(state).name} mulligans — new roll ${state.movementRoll}`
    state.log.push(state.message)
  } else {
    state.message = `${activePlayer(state).name}: Move phase — rolled ${state.movementRoll}${
      state.turnNumber === 1 && state.mulliganAvailable ? ' (mulligan available)' : ''
    }`
    state.log.push(`Turn ${state.turnNumber}: ${activePlayer(state).name} rolls ${state.movementRoll}`)
  }
}

function commitPendingDice(state: GameState, rng: () => number, forced?: number[]): void {
  const pending = state.pendingDice
  if (!pending) return

  if (pending.context === 'movement' || pending.context === 'mulligan') {
    applyMovementRoll(
      state,
      rng,
      pending.context,
      pending.label,
      pending.playerId,
      forced,
      pending.id,
    )
    state.pendingDice = null
    return
  }

  if (pending.context === 'strike') {
    const battle = state.battle
    if (!battle || !pending.strike) throw new Error('No strike pending')
    const values = rollFaces(pending.dieCount, rng, forced)
    const result = resolveStrike(
      state,
      battle,
      pending.strike.attackerId,
      pending.strike.defenderId,
      rng,
      values,
    )
    state.log.push(result.message)
    state.message = result.message
    setDiceRoll(state, pending.id, {
      context: 'strike',
      values: result.rolls,
      need: result.need,
      hits: result.hits,
      label: pending.label,
      playerId: pending.playerId,
    })
    battle.selectedUnitId = null
    battle.highlighted = []
    state.pendingDice = null
    checkBattleEnd(state, battle)
    if (battle.done) finishBattle(state)
    return
  }

  throw new Error(`Unknown pending dice context`)
}

function openEngagement(state: GameState, attackerId: string, defenderId: string): void {
  if (state.phase !== 'Fight') throw new Error('Not fight phase')
  const attacker = state.legions.find((l) => l.id === attackerId)
  const defender = state.legions.find((l) => l.id === defenderId)
  if (!attacker || !defender) throw new Error('Legions not found')
  if (attacker.hexLabel !== defender.hexLabel) throw new Error('Not engaged')
  state.activeEngagement = {
    attackerId,
    defenderId,
    revealed: false,
    proposal: null,
    proposedBy: null,
  }
  state.message = `Engagement ${attacker.markerId} vs ${defender.markerId} — reveal, flee, agree, concede, or fight`
}

function handleEngagementCommand(
  state: GameState,
  command: GameCommand,
  rng: () => number,
): void {
  const eng = state.activeEngagement!
  const attacker = state.legions.find((l) => l.id === eng.attackerId)!
  const defender = state.legions.find((l) => l.id === eng.defenderId)!

  switch (command.type) {
    case 'revealEngagement': {
      eng.revealed = true
      state.message = `Revealed: ${attacker.markerId}=[${attacker.creatures.map((c) => c.type).join(',')}] vs ${defender.markerId}=[${defender.creatures.map((c) => c.type).join(',')}]`
      state.log.push(state.message)
      break
    }
    case 'flee': {
      if (!canFlee(state, defender)) throw new Error('Defender cannot flee (has a Lord)')
      resolveEngagementConcession(state, defender, attacker, true)
      state.log.push(`${defender.markerId} flees — half points to attacker`)
      finishEngagementResolution(state, attacker.playerId)
      break
    }
    case 'concedeEngagement': {
      const loser = state.legions.find((l) => l.id === command.loserId)
      if (!loser) throw new Error('Loser not found')
      const winner = loser.id === eng.attackerId ? defender : attacker
      resolveEngagementConcession(state, loser, winner, false)
      state.log.push(`${loser.markerId} concedes — full points`)
      finishEngagementResolution(state, winner.playerId)
      break
    }
    case 'proposeAgreement': {
      eng.proposal = command.kind
      eng.proposedBy = activePlayer(state).id
      if (command.kind === 'fight') {
        startBattleFromEngagement(state, rng)
        break
      }
      state.message = `Agreement proposed: ${command.kind}`
      break
    }
    case 'acceptAgreement': {
      if (!eng.proposal || eng.proposal === 'fight') throw new Error('No agreement pending')
      if (eng.proposedBy === activePlayer(state).id) throw new Error('Cannot accept own proposal')
      resolveAgreement(state, attacker, defender, eng.proposal)
      finishEngagementResolution(state, null)
      break
    }
    case 'refuseAgreement': {
      eng.proposal = null
      eng.proposedBy = null
      state.message = 'Agreement refused'
      break
    }
    case 'startEngagement':
      // Treat as fight after reveal
      startBattleFromEngagement(state, rng)
      break
    default:
      throw new Error(`Invalid during engagement: ${command.type}`)
  }
}

function finishEngagementResolution(state: GameState, slayerId: string | null): void {
  state.activeEngagement = null
  checkTitanDeath(state, slayerId)
  if (state.winnerId || state.draw) return
  if (activePlayer(state).dead) {
    advanceToNextLivingPlayer(state)
    return
  }
  state.pendingEngagements = findEngagements(state)
  if (state.pendingEngagements.length === 0) beginMusterPhase(state)
  else state.message = `Fight continues — ${state.pendingEngagements.length} engagement(s) left`
}

function startBattleFromEngagement(state: GameState, rng: () => number): void {
  const eng = state.activeEngagement!
  const attacker = state.legions.find((l) => l.id === eng.attackerId)!
  const defender = state.legions.find((l) => l.id === eng.defenderId)!
  state.activeEngagement = null
  state.battle = startBattle(state, attacker, defender, rng)
  state.phase = 'Battle'
  state.message = `Battle on ${attacker.hexLabel}: ${attacker.markerId} vs ${defender.markerId}`
  state.log.push(state.message)
}

function selectLegion(state: GameState, legionId: string): void {
  const legion = state.legions.find((l) => l.id === legionId)
  if (!legion) throw new Error('Legion not found')
  const player = activePlayer(state)
  if (legion.playerId !== player.id && state.phase !== 'Fight') {
    throw new Error('Not your legion')
  }
  state.selectedLegionId = legionId
  if (state.phase === 'Move' && state.movementRoll != null) {
    const moves = listAllMoves(state, legion, state.movementRoll)
    state.legalHexes = [...moves.keys()]
    state.message = `Selected ${legion.markerId} — ${state.legalHexes.length} legal moves`
  } else if (state.phase === 'Muster') {
    const recruits = listRecruits(state, legion)
    state.legalHexes = []
    state.message = recruits.length
      ? `Recruit: ${recruits.join(', ')}`
      : 'No recruits available for this legion'
  } else if (state.phase === 'Split') {
    state.legalHexes = []
    state.message = `Selected ${legion.markerId} (${legion.creatures.map((c) => c.type).join(', ')})`
  } else if (state.phase === 'Fight') {
    state.legalHexes = []
    const enemies = state.legions.filter(
      (l) => l.hexLabel === legion.hexLabel && l.playerId !== legion.playerId,
    )
    state.message = enemies.length
      ? `Engage ${enemies.map((e) => e.markerId).join(', ')}?`
      : 'No enemy here'
  }
}

function doSplit(state: GameState, parentId: string, childTypes: string[]): void {
  if (state.phase !== 'Split') throw new Error('Not split phase')
  const parent = state.legions.find((l) => l.id === parentId)
  if (!parent) throw new Error('Parent not found')
  if (parent.playerId !== activePlayer(state).id) throw new Error('Not your legion')
  if (childTypes.length < 2) throw new Error('Split-off must have at least 2 creatures')
  if (parent.creatures.length - childTypes.length < 2) {
    throw new Error('Parent must keep at least 2 creatures')
  }

  // Colossus GameServerSide.doSplit — turn 1 opening split is strictly 4:4 with 1 lord each
  if (state.turnNumber === 1) {
    const mine = playerLegions(state, activePlayer(state).id)
    if (mine.length > 1) throw new Error('Cannot split twice on turn 1')
    if (parent.creatures.length !== 8) throw new Error('Turn 1 split requires the opening 8-high legion')
    if (childTypes.length !== 4) throw new Error('Turn 1 split must be 4 and 4')
    const childLords = childTypes.filter((t) => state.variant.creatures[t]?.lord).length
    const parentLords = parent.creatures.filter((c) => state.variant.creatures[c.type]?.lord).length
    if (childLords !== 1 || parentLords - childLords !== 1) {
      throw new Error('Turn 1 split: each stack must have exactly one Lord')
    }
  }

  const remaining = [...parent.creatures]
  const childCreatures: { type: string; hits: number }[] = []
  for (const t of childTypes) {
    const idx = remaining.findIndex((c) => c.type === t)
    if (idx < 0) throw new Error(`Parent lacks ${t}`)
    childCreatures.push(remaining.splice(idx, 1)[0])
  }
  parent.creatures = remaining

  const player = activePlayer(state)
  if (player.markersAvailable.length === 0) {
    throw new Error('No legion markers available (maximum 12 legions)')
  }
  const child: Legion = {
    id: `leg-${legionSeq++}`,
    markerId: takeMarker(player),
    playerId: player.id,
    hexLabel: parent.hexLabel,
    creatures: childCreatures,
    moved: false,
    teleported: false,
    recruited: false,
    enteredFrom: null,
  }
  state.legions.push(child)
  state.selectedLegionId = child.id
  state.log.push(`${player.name} splits ${child.markerId} from ${parent.markerId}`)
  state.message = `Split created ${child.markerId}`
}

function beginMovePhase(state: GameState, rng: () => number): void {
  state.phase = 'Move'
  state.selectedLegionId = null
  state.legalHexes = []
  for (const l of playerLegions(state, activePlayer(state).id)) {
    l.moved = false
    l.teleported = false
    l.recruited = false
  }
  activePlayer(state).hasTeleported = false
  if (state.turnNumber !== 1) state.mulliganAvailable = false
  const player = activePlayer(state)
  if (state.diceMode === 'physical') {
    state.movementRoll = null
    setPendingDice(state, {
      context: 'movement',
      dieCount: 1,
      playerId: player.id,
      label: `${player.name} movement`,
    })
    state.message = `${player.name}: Move phase — rolling…`
    return
  }
  applyMovementRoll(state, rng, 'movement', `${player.name} movement`, player.id)
}

function doMove(state: GameState, legionId: string, toHex: string): void {
  if (state.phase !== 'Move') throw new Error('Not move phase')
  if (state.movementRoll == null) throw new Error('No movement roll')
  const legion = state.legions.find((l) => l.id === legionId)
  if (!legion) throw new Error('Legion not found')
  if (legion.playerId !== activePlayer(state).id) throw new Error('Not your legion')
  if (legion.moved) throw new Error('Already moved')

  const moves = listAllMoves(state, legion, state.movementRoll)
  const info = moves.get(toHex)
  if (!info) throw new Error('Illegal move')

  const friends = state.legions.filter(
    (l) => l.hexLabel === toHex && l.playerId === legion.playerId && l.id !== legion.id,
  )
  if (friends.length > 0 && !state.legions.some((l) => l.hexLabel === toHex && l.playerId !== legion.playerId)) {
    throw new Error('Cannot end on friendly legion')
  }

  // T3: tower teleport reveals a lord
  if (info.teleport && !legion.creatures.some((c) => {
    const t = state.variant.creatures[c.type]
    return t?.lord || t?.demilord
  })) {
    throw new Error('Tower teleport requires a revealed Lord')
  }
  if (info.teleport) {
    const lord = legion.creatures.find((c) => {
      const t = state.variant.creatures[c.type]
      return t?.lord || t?.demilord
    })
    if (lord) state.log.push(`${legion.markerId} reveals ${lord.type} for teleport`)
  }

  legion.hexLabel = toHex
  legion.moved = true
  legion.teleported = info.teleport
  legion.enteredFrom = info.side
  if (info.teleport) activePlayer(state).hasTeleported = true
  state.selectedLegionId = legionId
  state.legalHexes = []
  state.log.push(`${legion.markerId} moves to ${toHex}${info.teleport ? ' (teleport)' : ''}`)
  state.message = `${legion.markerId} → ${toHex}`
}

function beginFightPhase(state: GameState): void {
  state.phase = 'Fight'
  state.movementRoll = null
  if (state.diceRoll?.context === 'movement' || state.diceRoll?.context === 'mulligan') {
    clearDiceRoll(state)
  }
  state.selectedLegionId = null
  state.legalHexes = []
  state.pendingEngagements = findEngagements(state)
  if (state.pendingEngagements.length === 0) {
    beginMusterPhase(state)
    return
  }
  state.message = `${activePlayer(state).name}: Fight phase — ${state.pendingEngagements.length} engagement(s)`
}

function findEngagements(state: GameState): { attackerId: string; defenderId: string }[] {
  const result: { attackerId: string; defenderId: string }[] = []
  const seen = new Set<string>()
  for (const leg of state.legions) {
    const enemies = state.legions.filter(
      (l) => l.hexLabel === leg.hexLabel && l.playerId !== leg.playerId,
    )
    for (const e of enemies) {
      const key = [leg.id, e.id].sort().join(':')
      if (seen.has(key)) continue
      seen.add(key)
      // Active player's legion is attacker if present
      const activeId = activePlayer(state).id
      if (leg.playerId === activeId) result.push({ attackerId: leg.id, defenderId: e.id })
      else if (e.playerId === activeId) result.push({ attackerId: e.id, defenderId: leg.id })
      else result.push({ attackerId: leg.id, defenderId: e.id })
    }
  }
  return result
}

function canEndMovePhase(state: GameState): boolean {
  const mine = playerLegions(state, activePlayer(state).id)
  if (mine.some((l) => l.moved)) return true
  if (state.movementRoll == null) return true
  for (const leg of mine) {
    if (listAllMoves(state, leg, state.movementRoll).size > 0) return false
  }
  return true
}

function beginMusterPhase(state: GameState): void {
  if (activePlayer(state).dead) {
    advanceToNextLivingPlayer(state)
    return
  }
  state.phase = 'Muster'
  state.movementRoll = null
  clearDiceRoll(state)
  state.selectedLegionId = null
  state.legalHexes = []
  // Titan/Colossus: only legions that moved this turn may muster
  state.message = `${activePlayer(state).name}: Muster — recruit with legions that moved, or Done`
}

function doRecruit(state: GameState, legionId: string, creatureType: string): void {
  if (state.phase !== 'Muster') throw new Error('Not muster phase')
  const legion = state.legions.find((l) => l.id === legionId)
  if (!legion) throw new Error('Legion not found')
  if (legion.playerId !== activePlayer(state).id) throw new Error('Not your legion')
  applyRecruit(state, legionId, creatureType)
  state.log.push(`${legion.markerId} recruits ${creatureType}`)
  state.message = `${legion.markerId} recruited ${creatureType}`
  state.selectedLegionId = legionId
}

function endTurn(state: GameState, rng: () => number): void {
  advanceToNextLivingPlayer(state)
  void rng
}

/** Skip a dead active player (e.g. Titan died mid-turn) and start the next living player's Split. */
function advanceToNextLivingPlayer(state: GameState): void {
  if (state.winnerId || state.draw) return

  for (const p of state.players) {
    p.titanPower = 6 + Math.floor(p.score / 100)
  }

  let next = state.activePlayerIndex
  for (let i = 0; i < state.players.length; i++) {
    next = (next + 1) % state.players.length
    if (!state.players[next]!.dead) break
  }
  // If everyone else is dead, checkTitanDeath should already have set a winner
  if (state.players[next]!.dead) return

  if (next <= state.activePlayerIndex) {
    state.turnNumber += 1
  }
  state.activePlayerIndex = next
  state.phase = 'Split'
  state.movementRoll = null
  clearDiceRoll(state)
  state.pendingDice = null
  state.mulliganAvailable = state.turnNumber <= 1
  state.selectedLegionId = null
  state.legalHexes = []
  state.pendingEngagements = []
  state.activeEngagement = null
  state.message = `${activePlayer(state).name}: Split phase`
}

function passPhase(state: GameState, rng: () => number): void {
  if (state.phase === 'Split') {
    if (playerLegions(state, activePlayer(state).id).some((l) => l.creatures.length > 7)) {
      state.message = 'Legions taller than 7 must split before leaving Split phase'
      return
    }
    beginMovePhase(state, rng)
  } else if (state.phase === 'Move') {
    if (!canEndMovePhase(state)) {
      state.message = 'You must move at least one legion if able'
      return
    }
    beginFightPhase(state)
  } else if (state.phase === 'Fight') beginMusterPhase(state)
  else if (state.phase === 'Muster') endTurn(state, rng)
}

function handleBattleCommand(state: GameState, command: GameCommand, rng: () => number): void {
  const battle = state.battle!
  if (battle.done) return

  switch (command.type) {
    case 'battleSelectUnit': {
      const unit = battle.units.find((u) => u.id === command.unitId)
      if (!unit || !isUnitAlive(state, unit)) throw new Error('Invalid unit')
      if (unit.playerId !== battle.activePlayerId) throw new Error('Not your unit')
      battle.selectedUnitId = unit.id
      if (battle.phase === 'Move') {
        battle.highlighted = legalBattleMovesFor(state, battle, unit)
      } else if (battle.phase === 'Strike' || battle.phase === 'Strikeback') {
        battle.highlighted = legalStrikes(state, battle, unit)
      }
      break
    }
    case 'battleMove': {
      const unit = battle.units.find((u) => u.id === command.unitId)
      if (!unit) throw new Error('Unit not found')
      if (battle.phase !== 'Move') throw new Error('Not move phase')
      const legal = legalBattleMovesFor(state, battle, unit)
      if (!legal.includes(command.toHex)) throw new Error('Illegal battle move')
      unit.hex = command.toHex
      unit.moved = true
      battle.selectedUnitId = null
      battle.highlighted = []
      state.message = `${unit.creatureType} moves to ${command.toHex}`
      break
    }
    case 'battleStrike': {
      if (battle.phase !== 'Strike' && battle.phase !== 'Strikeback') {
        throw new Error('Not strike phase')
      }
      if (battle.pendingCarry) throw new Error('Resolve carry first')
      const attacker = battle.units.find((u) => u.id === command.attackerId)
      const defender = battle.units.find((u) => u.id === command.defenderId)
      if (!attacker || !defender || !attacker.hex || !defender.hex) {
        throw new Error('Invalid strike')
      }

      if (state.diceMode === 'physical') {
        const land = battleLand(state, battle)
        const meleeStrike = battleNeighbors(land, attacker.hex).includes(defender.hex)
        const dieCount = getStrikeDice(state, land, attacker, defender, meleeStrike)
        const need = getStrikeNumber(state, attacker, defender, land, meleeStrike)
        if (dieCount < 1) throw new Error('No dice for strike')
        setPendingDice(state, {
          context: 'strike',
          dieCount,
          playerId: battle.activePlayerId,
          label: `${attacker.creatureType} vs ${defender.creatureType}`,
          strike: {
            attackerId: command.attackerId,
            defenderId: command.defenderId,
            need,
          },
        })
        state.message = `${attacker.creatureType} strikes ${defender.creatureType}…`
        break
      }

      const result = resolveStrike(state, battle, command.attackerId, command.defenderId, rng)
      state.log.push(result.message)
      state.message = result.message
      if (result.rolls.length > 0) {
        setDiceRoll(state, newDiceId(), {
          context: 'strike',
          values: result.rolls,
          need: result.need,
          hits: result.hits,
          label: `${result.attackerType} vs ${result.defenderType}`,
          playerId: battle.activePlayerId,
        })
      }
      battle.selectedUnitId = null
      battle.highlighted = []
      checkBattleEnd(state, battle)
      if (battle.done) finishBattle(state)
      break
    }
    case 'battleCarry': {
      doCarry(state, battle, command.targetId)
      state.message = 'Carry applied'
      if (battle.done) finishBattle(state)
      break
    }
    case 'battleDonePhase': {
      try {
        const prevPhase = battle.phase
        advanceBattlePhase(state, battle)
        if (prevPhase === 'Strike' || prevPhase === 'Strikeback') {
          if (state.diceRoll?.context === 'strike') clearDiceRoll(state)
        }
      } catch (e) {
        state.message = e instanceof Error ? e.message : String(e)
        break
      }
      if (battle.done) {
        finishBattle(state)
      } else {
        state.message = `Battle: ${battle.activeHalf} ${battle.phase} (turn ${battle.turn}/${MAX_BATTLE_TURNS})`
      }
      break
    }
    case 'battleReinforce': {
      if (battle.phase !== 'Recruit') throw new Error('Not reinforce phase')
      const def = state.legions.find((l) => l.id === battle.defenderLegionId)!
      if (def.creatures.length >= 7) throw new Error('Legion full')
      if ((state.caretaker[command.creatureType] ?? 0) <= 0) throw new Error('Caretaker empty')
      // Must be a legal recruit for the engagement terrain
      def.moved = true
      const opts = listRecruits(state, def)
      def.moved = false
      if (!opts.includes(command.creatureType)) throw new Error('Illegal reinforcement')
      state.caretaker[command.creatureType] -= 1
      def.creatures.push({ type: command.creatureType, hits: 0 })
      battle.units.push({
        id: `bu-r-${battle.units.length}`,
        legionId: def.id,
        playerId: def.playerId,
        creatureType: command.creatureType,
        hits: 0,
        hex: null,
        struck: false,
        moved: false,
      })
      battle.defenderReinforced = true
      battle.phase = 'Move'
      state.log.push(`Defender reinforces with ${command.creatureType}`)
      break
    }
    case 'battleSkipReinforce': {
      if (battle.phase !== 'Recruit') throw new Error('Not reinforce phase')
      battle.defenderReinforced = true
      battle.phase = 'Move'
      break
    }
    case 'battleSummon': {
      if (battle.phase !== 'Summon') throw new Error('Not summon phase')
      if (battle.attackerSummoned || battle.denySummon) throw new Error('Cannot summon')
      const atk = state.legions.find((l) => l.id === battle.attackerLegionId)!
      if (atk.creatures.length >= 7) throw new Error('Legion full')
      const src = state.legions.find((l) => l.id === command.fromLegionId)
      if (!src || src.playerId !== atk.playerId) throw new Error('Invalid source legion')
      if (src.id === atk.id) throw new Error('Cannot summon from self')
      // Source must not be in an unresolved engagement
      if (
        state.legions.some(
          (l) => l.hexLabel === src.hexLabel && l.playerId !== src.playerId,
        )
      ) {
        throw new Error('Source legion is engaged')
      }
      const angelIdx = src.creatures.findIndex((c) => {
        const t = state.variant.creatures[c.type]
        return t?.summonable
      })
      if (angelIdx < 0) throw new Error('No summonable creature')
      const [angel] = src.creatures.splice(angelIdx, 1)
      atk.creatures.push({ type: angel.type, hits: 0 })
      battle.units.push({
        id: `bu-s-${battle.units.length}`,
        legionId: atk.id,
        playerId: atk.playerId,
        creatureType: angel.type,
        hits: 0,
        hex: null,
        struck: false,
        moved: false,
      })
      battle.attackerSummoned = true
      battle.pendingSummon = false
      battle.phase = 'Move'
      state.log.push(`Attacker summons ${angel.type} from ${src.markerId}`)
      break
    }
    case 'battleSkipSummon': {
      if (battle.phase !== 'Summon') throw new Error('Not summon phase')
      battle.pendingSummon = false
      battle.phase = 'Move'
      break
    }
    case 'concedeBattle': {
      const active = battle.activePlayerId
      battle.done = true
      battle.concededFullPoints = true
      const other = battle.units.find((u) => u.playerId !== active)
      battle.winnerPlayerId = other?.playerId ?? null
      for (const u of battle.units) {
        if (u.playerId === active) u.hits = 999
      }
      finishBattle(state)
      break
    }
    default:
      throw new Error(`Invalid battle command: ${command.type}`)
  }
}

function finishBattle(state: GameState): void {
  const battle = state.battle!
  applyBattleResult(state, battle)
  clearDiceRoll(state)
  state.pendingDice = null
  if (battle.timeLoss) {
    state.log.push('Battle over — defender wins by time-loss (no points)')
  } else {
    state.log.push(
      battle.winnerPlayerId
        ? `Battle over — ${state.players.find((p) => p.id === battle.winnerPlayerId)?.name} wins the engagement`
        : 'Battle over — mutual destruction',
    )
  }
  state.battle = null
  if (state.winnerId || state.draw) return
  if (activePlayer(state).dead) {
    advanceToNextLivingPlayer(state)
    return
  }
  state.phase = 'Fight'
  state.pendingEngagements = findEngagements(state)
  if (state.pendingEngagements.length === 0) {
    beginMusterPhase(state)
  } else {
    state.message = `Fight continues — ${state.pendingEngagements.length} engagement(s) left`
  }
}

/** Helpers for AI / UI */
export function getLegalRecruits(state: GameState, legionId: string): string[] {
  const legion = state.legions.find((l) => l.id === legionId)
  if (!legion) return []
  return listRecruits(state, legion)
}

export function getMovesForSelected(state: GameState): Map<string, { side: string; teleport: boolean }> {
  if (!state.selectedLegionId || state.movementRoll == null) return new Map()
  const legion = state.legions.find((l) => l.id === state.selectedLegionId)
  if (!legion) return new Map()
  return listAllMoves(state, legion, state.movementRoll)
}
