/**
 * Battle phase machine, start/end, time-loss — orchestrates battleland / movement / strike.
 */
import { buildBattleland, defenderEntryKey, type BuiltBattleland } from './battleland'
import { legalBattleMoves } from './battleMovement'
import {
  applyCarry,
  getStrikeDice,
  getStrikeNumber,
  getUnitPower,
  getUnitSkill,
  hasForcedStrike,
  isUnitAlive,
  legalStrikes as findLegalStrikes,
  listStrikeRaiseOptions,
  resolveStrike as doResolveStrike,
} from './battleStrike'
import { eliminateLegionToCaretaker } from './engagement'
import { listRecruits, returnEliminatedCreature } from './recruit'
import { revealAll, revealCreatures } from './publicKnowledge'
import type {
  BattleHalf,
  BattleState,
  BattleUnit,
  EntrySide,
  GameState,
  Legion,
} from './types'

export const MAX_BATTLE_TURNS = 7
export {
  getStrikeDice,
  getStrikeNumber,
  getUnitPower,
  getUnitSkill,
  hasForcedStrike,
  isUnitAlive,
  listStrikeRaiseOptions,
}
export type { StrikeRaiseOption } from './battleStrike'

/** Legal turn-4 defender reinforcements (same rules as battleReinforce). */
export function listBattleReinforceOptions(state: GameState, battle: BattleState): string[] {
  const def = state.legions.find((l) => l.id === battle.defenderLegionId)
  if (!def || def.creatures.length >= 7) return []
  return listRecruits(state, { ...def, moved: true, recruited: false })
}

/** Friendly unengaged legions that can donate a summonable creature to the attacker. */
export function listBattleSummonSources(state: GameState, battle: BattleState): Legion[] {
  const atk = state.legions.find((l) => l.id === battle.attackerLegionId)
  if (!atk || atk.creatures.length >= 7) return []
  if (battle.attackerSummoned || battle.denySummon || battle.summonState === 'tooLate') return []
  return state.legions.filter((l) => {
    if (l.playerId !== atk.playerId || l.id === atk.id) return false
    if (state.legions.some((e) => e.hexLabel === l.hexLabel && e.playerId !== l.playerId)) {
      return false
    }
    return l.creatures.some((c) => state.variant.creatures[c.type]?.summonable)
  })
}

/** End the one-time mid-battle summon window (used, skipped, or unavailable). */
export function closeSummonWindow(battle: BattleState): void {
  battle.pendingSummon = false
  battle.summonState = 'tooLate'
}

const landCache = new WeakMap<BattleState, BuiltBattleland>()

export function battleLand(state: GameState, battle: BattleState): BuiltBattleland {
  let land = landCache.get(battle)
  if (land) return land
  const def =
    state.variant.data.battlelands[battle.terrain] ??
    state.variant.data.battlelands.Plains
  land = buildBattleland(def)
  landCache.set(battle, land)
  return land
}

function oppositeSide(side: EntrySide): ReturnType<typeof defenderEntryKey> {
  return defenderEntryKey(side)
}

export function startBattle(
  state: GameState,
  attacker: Legion,
  defender: Legion,
  rng: () => number,
): BattleState {
  void rng
  const hex = state.variant.board.hexByLabel[attacker.hexLabel]
  const terrain = hex?.terrain ?? 'Plains'
  const def = state.variant.data.battlelands[terrain] ?? state.variant.data.battlelands.Plains
  const land = buildBattleland(def)
  const atkSide = attacker.enteredFrom ?? 'Bottom'
  const defSide = oppositeSide(atkSide)
  const atkEntrances = land.entrances[atkSide]
  const defEntrances = land.entrances[defSide]
  // Off-board initially — must enter on first maneuver (B3)
  const units: BattleUnit[] = []
  let uid = 0
  for (const c of attacker.creatures) {
    units.push({
      id: `bu-${uid++}`,
      legionId: attacker.id,
      playerId: attacker.playerId,
      creatureType: c.type,
      hits: c.hits,
      hex: null,
      struck: false,
      moved: false,
      moveOriginHex: null,
    })
  }
  for (const c of defender.creatures) {
    // Tower: defender deploys on startlist
    const startHex =
      land.tower && land.startlist.length
        ? land.startlist[units.filter((u) => u.legionId === defender.id).length % land.startlist.length]
        : null
    units.push({
      id: `bu-${uid++}`,
      legionId: defender.id,
      playerId: defender.playerId,
      creatureType: c.type,
      hits: c.hits,
      hex: land.tower ? startHex : null,
      struck: false,
      moved: false,
      moveOriginHex: land.tower ? startHex : null,
    })
  }

  const defenderFirst = !land.tower
  const battle: BattleState = {
    attackerLegionId: attacker.id,
    defenderLegionId: defender.id,
    terrain,
    activePlayerId: defenderFirst ? defender.playerId : attacker.playerId,
    activeHalf: defenderFirst ? 'defender' : 'attacker',
    phase: land.tower ? 'Move' : 'Move',
    units,
    fallen: [],
    turn: 1,
    highlighted: [],
    selectedUnitId: null,
    pendingCarry: null,
    done: false,
    winnerPlayerId: null,
    timeLoss: booleanFalse(),
    attackerEntrances: atkEntrances,
    defenderEntrances: defEntrances,
    firstManeuverDone: { attacker: false, defender: land.tower },
    defenderReinforced: false,
    attackerSummoned: false,
    pendingSummon: false,
    summonState: 'noKills',
    denySummon: false,
    moveStack: [],
  }
  landCache.set(battle, land)
  return battle
}

function booleanFalse(): boolean {
  return false
}

/** Snapshot origins and clear moved flags for a new maneuver half. */
export function prepareBattleManeuver(battle: BattleState): void {
  for (const u of battle.units) {
    u.moved = false
    u.struck = false
    u.moveOriginHex = u.hex
  }
  battle.moveStack = []
  battle.selectedUnitId = null
  battle.highlighted = []
}

export function undoBattleUnitMove(battle: BattleState, unitId: string): void {
  const unit = battle.units.find((u) => u.id === unitId)
  if (!unit || !unit.moved) throw new Error('Unit has not moved')
  unit.hex = unit.moveOriginHex
  unit.moved = false
  battle.moveStack = battle.moveStack.filter((id) => id !== unitId)
  if (battle.selectedUnitId === unitId) {
    battle.selectedUnitId = null
    battle.highlighted = []
  }
}

export function undoLastBattleMove(battle: BattleState): void {
  const unitId = battle.moveStack[battle.moveStack.length - 1]
  if (!unitId) throw new Error('No battle move to undo')
  undoBattleUnitMove(battle, unitId)
}

export function undoAllBattleMoves(battle: BattleState): void {
  while (battle.moveStack.length > 0) {
    undoLastBattleMove(battle)
  }
}

export function canUndoBattleMoves(battle: BattleState): boolean {
  return battle.phase === 'Move' && !battle.done && battle.moveStack.length > 0
}

export function legalBattleMovesFor(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
): string[] {
  return legalBattleMoves(state, battle, battleLand(state, battle), unit)
}

export function legalStrikesFor(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
): string[] {
  const allowRange = battle.phase === 'Strike'
  return findLegalStrikes(state, battle, battleLand(state, battle), unit, allowRange)
}

/** Back-compat for callers expecting (state, battle, unit) */
export function legalStrikes(
  state: GameState,
  battle: BattleState,
  unit: BattleUnit,
): string[] {
  return legalStrikesFor(state, battle, unit)
}

/** True if the active battle player still has any unstruck unit with a legal target. */
export function activePlayerHasLegalStrike(state: GameState, battle: BattleState): boolean {
  // Dead units may still strike until removeDeadCreatures (Strikeback).
  return battle.units.some(
    (u) =>
      u.playerId === battle.activePlayerId &&
      !u.struck &&
      legalStrikesFor(state, battle, u).length > 0,
  )
}

export function resolveStrikeFor(
  state: GameState,
  battle: BattleState,
  attackerId: string,
  defenderId: string,
  rng: () => number,
  forcedRolls?: number[],
  raisedStrikeNumber?: number,
): {
  message: string
  rolls: number[]
  need: number
  hits: number
  attackerType: string
  defenderType: string
} {
  const land = battleLand(state, battle)
  const result = doResolveStrike(
    state,
    battle,
    land,
    attackerId,
    defenderId,
    rng,
    forcedRolls,
    raisedStrikeNumber,
  )
  if (result.carries) {
    battle.pendingCarry = {
      fromUnitId: attackerId,
      hitsLeft: result.carries.hitsLeft,
      targetIds: result.carries.targetIds,
    }
  }
  // First defender kill on the battleland opens a one-time summon window (Colossus FIRST_BLOOD).
  const struck = battle.units.find((u) => u.id === defenderId)
  if (
    battle.summonState === 'noKills' &&
    !battle.denySummon &&
    struck &&
    struck.legionId === battle.defenderLegionId &&
    !isUnitAlive(state, struck)
  ) {
    battle.summonState = 'firstBlood'
    battle.pendingSummon = true
  }
  return {
    message: result.message,
    rolls: result.rolls,
    need: result.need,
    hits: result.hits,
    attackerType: result.attackerType,
    defenderType: result.defenderType,
  }
}

/** Back-compat name used by GameEngine */
export function resolveStrike(
  state: GameState,
  battle: BattleState,
  attackerId: string,
  defenderId: string,
  rng: () => number,
  forcedRolls?: number[],
  raisedStrikeNumber?: number,
): {
  message: string
  rolls: number[]
  need: number
  hits: number
  attackerType: string
  defenderType: string
} {
  return resolveStrikeFor(
    state,
    battle,
    attackerId,
    defenderId,
    rng,
    forcedRolls,
    raisedStrikeNumber,
  )
}

export function checkBattleEnd(state: GameState, battle: BattleState): void {
  const atkAlive = battle.units.some(
    (u) => u.legionId === battle.attackerLegionId && isUnitAlive(state, u),
  )
  const defAlive = battle.units.some(
    (u) => u.legionId === battle.defenderLegionId && isUnitAlive(state, u),
  )
  if (!atkAlive || !defAlive) {
    battle.done = true
    if (atkAlive) {
      battle.winnerPlayerId = battle.units.find((u) => u.legionId === battle.attackerLegionId)!.playerId
    } else if (defAlive) {
      battle.winnerPlayerId = battle.units.find((u) => u.legionId === battle.defenderLegionId)!.playerId
    } else {
      battle.winnerPlayerId = null
    }
  }
}

export function applyTimeLoss(state: GameState, battle: BattleState): void {
  const defender = state.legions.find((l) => l.id === battle.defenderLegionId)
  if (!defender) return
  for (const u of battle.units) {
    if (u.legionId === battle.attackerLegionId) u.hits = 999
  }
  battle.done = true
  battle.timeLoss = true
  battle.winnerPlayerId = defender.playerId
  state.log.push(
    `Battle time-loss on turn ${MAX_BATTLE_TURNS + 1}: attacker eliminated, defender wins with no points`,
  )
}

function killUnentered(state: GameState, battle: BattleState, half: BattleHalf): void {
  const legionId = half === 'attacker' ? battle.attackerLegionId : battle.defenderLegionId
  for (const u of battle.units) {
    if (u.legionId === legionId && u.hex == null) {
      u.hits = 999
      state.log.push(`${u.creatureType} failed to enter — eliminated`)
    }
  }
  // Elimination is checked only after removeDeadCreatures (caller).
}

/**
 * Colossus removeDeadCreatures — after Strikeback, dead chits leave the board
 * (and their legion). Survivors stay in `units`; casualties move to `fallen`
 * for end-of-battle point tally. Caretaker recycle waits until the engagement
 * ends (immortals only) so slain Lords/Demi-Lords are not available mid-battle.
 */
export function removeDeadCreatures(state: GameState, battle: BattleState): void {
  const dead = battle.units.filter((u) => !isUnitAlive(state, u))
  if (dead.length === 0) {
    checkBattleEnd(state, battle)
    return
  }

  const deadIds = new Set(dead.map((u) => u.id))
  battle.fallen.push(...dead)
  battle.units = battle.units.filter((u) => !deadIds.has(u.id))

  for (const u of dead) {
    const legion = state.legions.find((l) => l.id === u.legionId)
    if (legion) {
      const idx = legion.creatures.findIndex((c) => c.type === u.creatureType)
      if (idx >= 0) {
        legion.creatures.splice(idx, 1)
      }
    }
    state.log.push(`${u.creatureType} eliminated from the battle`)
  }

  if (battle.selectedUnitId && deadIds.has(battle.selectedUnitId)) {
    battle.selectedUnitId = null
    battle.highlighted = []
  }
  if (battle.pendingCarry && deadIds.has(battle.pendingCarry.fromUnitId)) {
    battle.pendingCarry = null
  } else if (battle.pendingCarry) {
    battle.pendingCarry = {
      ...battle.pendingCarry,
      targetIds: battle.pendingCarry.targetIds.filter((id) => !deadIds.has(id)),
    }
    if (battle.pendingCarry.targetIds.length === 0) battle.pendingCarry = null
  }

  // Official Titan / Colossus: Titan waits until end of strike cycle, then player
  // is out and the battle ends immediately. Mutual Titan death → draw.
  checkBattleTitanElimination(state, battle)
  if (!battle.done) checkBattleEnd(state, battle)
}

/**
 * After dead are removed: if a Titan left the board this cycle, end the battle.
 * Draw only when both Titans are among the fallen (typically Strike + Strikeback).
 */
export function checkBattleTitanElimination(state: GameState, battle: BattleState): void {
  if (battle.done) return

  const atkTitanDead = battle.fallen.some(
    (u) => u.legionId === battle.attackerLegionId && u.creatureType === 'Titan',
  )
  const defTitanDead = battle.fallen.some(
    (u) => u.legionId === battle.defenderLegionId && u.creatureType === 'Titan',
  )
  if (!atkTitanDead && !defTitanDead) return

  battle.done = true
  battle.endedByTitanKill = true
  battle.pendingCarry = null

  if (atkTitanDead && defTitanDead) {
    battle.winnerPlayerId = null
    state.log.push('Both Titans slain — mutual elimination')
  } else if (atkTitanDead) {
    battle.winnerPlayerId = state.legions.find((l) => l.id === battle.defenderLegionId)?.playerId ?? null
    state.log.push('Attacker Titan slain — battle ends')
  } else {
    battle.winnerPlayerId = state.legions.find((l) => l.id === battle.attackerLegionId)?.playerId ?? null
    state.log.push('Defender Titan slain — battle ends')
  }
}

export function advanceBattlePhase(state: GameState, battle: BattleState): void {
  if (battle.done) return
  const land = battleLand(state, battle)

  if (battle.pendingCarry) {
    throw new Error('Resolve carry before ending phase')
  }

  if (
    (battle.phase === 'Strike' || battle.phase === 'Strikeback') &&
    hasForcedStrike(state, battle, land, battle.activePlayerId)
  ) {
    throw new Error('Must strike with all characters that can')
  }

  if (battle.phase === 'Move') {
    battle.phase = 'Strike'
    for (const u of battle.units) u.struck = false
  } else if (battle.phase === 'Strike') {
    battle.phase = 'Strikeback'
    const otherHalf: BattleHalf = battle.activeHalf === 'attacker' ? 'defender' : 'attacker'
    const otherLegionId =
      otherHalf === 'attacker' ? battle.attackerLegionId : battle.defenderLegionId
    const other = state.legions.find((l) => l.id === otherLegionId)
    battle.activePlayerId = other?.playerId ?? battle.activePlayerId
    for (const u of battle.units) u.struck = false
  } else if (battle.phase === 'Strikeback') {
    // First-maneuver failures become dead, then Colossus removeDeadCreatures
    if (battle.activeHalf === 'defender' && !battle.firstManeuverDone.defender) {
      killUnentered(state, battle, 'defender')
      battle.firstManeuverDone.defender = true
    } else if (battle.activeHalf === 'attacker' && !battle.firstManeuverDone.attacker) {
      killUnentered(state, battle, 'attacker')
      battle.firstManeuverDone.attacker = true
    }

    removeDeadCreatures(state, battle)
    if (battle.done) return

    if (battle.activeHalf === 'defender') {
      battle.activeHalf = 'attacker'
      const atk = state.legions.find((l) => l.id === battle.attackerLegionId)
      battle.activePlayerId = atk?.playerId ?? battle.activePlayerId
      if (
        battle.summonState === 'firstBlood' &&
        battle.pendingSummon &&
        !battle.attackerSummoned &&
        !battle.denySummon
      ) {
        if (listBattleSummonSources(state, battle).length > 0) {
          battle.phase = 'Summon'
        } else {
          // Nothing available — window closes (Colossus TOO_LATE)
          closeSummonWindow(battle)
          battle.phase = 'Move'
        }
      } else {
        // Abandoned or unavailable window — never reopen mid-battle
        if (battle.summonState === 'firstBlood') closeSummonWindow(battle)
        else battle.pendingSummon = false
        battle.phase = 'Move'
      }
      prepareBattleManeuver(battle)
    } else {
      const nextTurn = battle.turn + 1
      if (nextTurn > MAX_BATTLE_TURNS) {
        applyTimeLoss(state, battle)
        return
      }
      battle.turn = nextTurn
      battle.activeHalf = 'defender'
      const def = state.legions.find((l) => l.id === battle.defenderLegionId)
      battle.activePlayerId = def?.playerId ?? battle.activePlayerId
      if (nextTurn === 4 && !battle.defenderReinforced) {
        if (listBattleReinforceOptions(state, battle).length > 0) {
          battle.phase = 'Recruit'
        } else {
          // Nothing to muster — skip reinforce UI entirely
          battle.defenderReinforced = true
          battle.phase = 'Move'
        }
      } else {
        battle.phase = 'Move'
      }
      prepareBattleManeuver(battle)
    }
  } else if (battle.phase === 'Summon' || battle.phase === 'Recruit') {
    if (battle.phase === 'Recruit') battle.defenderReinforced = true
    if (battle.phase === 'Summon') closeSummonWindow(battle)
    battle.phase = 'Move'
    // Newly summoned/reinforced units keep hex null as origin; others already snapshotted
    for (const u of battle.units) {
      if (u.moveOriginHex === undefined) u.moveOriginHex = u.hex
    }
    if (!battle.moveStack) battle.moveStack = []
  }

  battle.selectedUnitId = null
  battle.highlighted = []

  // Empty Strike / Strikeback: skip without requiring Done
  if (
    !battle.done &&
    !battle.pendingCarry &&
    (battle.phase === 'Strike' || battle.phase === 'Strikeback') &&
    !activePlayerHasLegalStrike(state, battle)
  ) {
    advanceBattlePhase(state, battle)
  }
  // Empty reinforce: never pause on Recruit with no options
  if (
    !battle.done &&
    battle.phase === 'Recruit' &&
    listBattleReinforceOptions(state, battle).length === 0
  ) {
    battle.defenderReinforced = true
    battle.phase = 'Move'
  }
  // Empty summon: never pause on Summon with no donor angel
  if (
    !battle.done &&
    battle.phase === 'Summon' &&
    listBattleSummonSources(state, battle).length === 0
  ) {
    closeSummonWindow(battle)
    battle.phase = 'Move'
  }
}

export function applyBattleResult(state: GameState, battle: BattleState): void {
  const attacker = state.legions.find((l) => l.id === battle.attackerLegionId)
  const defender = state.legions.find((l) => l.id === battle.defenderLegionId)
  if (!attacker || !defender) return

  // Colossus resurrectImmortals — after the engagement, recycle Lords/Demi-Lords.
  for (const u of battle.fallen) {
    returnEliminatedCreature(state, u.creatureType)
  }

  const syncLegion = (legion: Legion) => {
    const survivors = battle.units.filter(
      (u) => u.legionId === legion.id && isUnitAlive(state, u),
    )
    // Dead units still sitting on the board (e.g. concede hits=999) recycle now.
    for (const u of battle.units) {
      if (u.legionId !== legion.id) continue
      if (isUnitAlive(state, u)) continue
      returnEliminatedCreature(state, u.creatureType)
    }
    legion.creatures = survivors.map((u) => ({ type: u.creatureType, hits: 0 }))
    // Battle survivors are fully public
    revealAll(legion)
  }

  const pointsFor = (loserLegionId: string, fullValue: boolean) => {
    let pts = 0
    const pool = [...battle.units, ...battle.fallen]
    for (const u of pool) {
      if (u.legionId !== loserLegionId) continue
      if (isUnitAlive(state, u)) continue
      const t = state.variant.creatures[u.creatureType]
      if (!t) continue
      const power =
        u.creatureType === 'Titan'
          ? (state.players.find((p) => p.id === u.playerId)?.titanPower ?? 6)
          : t.power
      const value = power * t.skill
      pts += fullValue ? value : Math.floor(value / 2)
    }
    return pts
  }

  if (battle.timeLoss) {
    syncLegion(defender)
    eliminateLegionToCaretaker(state, attacker)
    state.log.push('Time-loss — defender survives, no points awarded')
    checkTitanDeath(state, defender.playerId)
    return
  }

  // Titan kill after Strikeback: living remnants of the Titan legion do not score;
  // checkTitanDeath removes the eliminated player's remaining forces.
  if (battle.endedByTitanKill) {
    const atkTitanDead = battle.fallen.some(
      (u) => u.legionId === attacker.id && u.creatureType === 'Titan',
    )
    const defTitanDead = battle.fallen.some(
      (u) => u.legionId === defender.id && u.creatureType === 'Titan',
    )
    const atkAlive = battle.units.some(
      (u) => u.legionId === attacker.id && isUnitAlive(state, u),
    )
    const defAlive = battle.units.some(
      (u) => u.legionId === defender.id && isUnitAlive(state, u),
    )

    if (atkTitanDead && defTitanDead) {
      syncLegion(attacker)
      syncLegion(defender)
      if (!atkAlive) eliminateLegionToCaretaker(state, attacker)
      if (!defAlive) eliminateLegionToCaretaker(state, defender)
      checkTitanDeath(state, null)
      return
    }

    if (defTitanDead) {
      const winner = state.players.find((p) => p.id === attacker.playerId)!
      if (atkAlive) {
        const scoreBefore = winner.score
        winner.score += pointsFor(defender.id, false)
        syncLegion(attacker)
        maybeAcquireAngel(state, winner.id, attacker, scoreBefore)
      } else {
        syncLegion(attacker)
        eliminateLegionToCaretaker(state, attacker)
      }
      checkTitanDeath(state, atkAlive ? attacker.playerId : null)
      return
    }

    if (atkTitanDead) {
      const winner = state.players.find((p) => p.id === defender.playerId)!
      if (defAlive) {
        const scoreBefore = winner.score
        winner.score += pointsFor(attacker.id, false)
        syncLegion(defender)
        maybeAcquireAngel(state, winner.id, defender, scoreBefore)
      } else {
        syncLegion(defender)
        eliminateLegionToCaretaker(state, defender)
      }
      checkTitanDeath(state, defAlive ? defender.playerId : null)
      return
    }
  }

  const atkAlive = battle.units.some(
    (u) => u.legionId === attacker.id && isUnitAlive(state, u),
  )
  const defAlive = battle.units.some(
    (u) => u.legionId === defender.id && isUnitAlive(state, u),
  )

  const fullPoints = battle.concededFullPoints === true

  if (atkAlive && !defAlive) {
    const winner = state.players.find((p) => p.id === attacker.playerId)!
    const scoreBefore = winner.score
    winner.score += pointsFor(defender.id, fullPoints)
    syncLegion(attacker)
    maybeAcquireAngel(state, winner.id, attacker, scoreBefore)
    eliminateLegionToCaretaker(state, defender)
    checkTitanDeath(state, attacker.playerId)
  } else if (defAlive && !atkAlive) {
    const winner = state.players.find((p) => p.id === defender.playerId)!
    const scoreBefore = winner.score
    winner.score += pointsFor(attacker.id, fullPoints)
    syncLegion(defender)
    maybeAcquireAngel(state, winner.id, defender, scoreBefore)
    eliminateLegionToCaretaker(state, attacker)
    checkTitanDeath(state, defender.playerId)
  } else {
    syncLegion(attacker)
    syncLegion(defender)
    if (!atkAlive) eliminateLegionToCaretaker(state, attacker)
    if (!defAlive) eliminateLegionToCaretaker(state, defender)
    checkTitanDeath(state, null)
  }
}

function maybeAcquireAngel(
  state: GameState,
  playerId: string,
  legion: Legion,
  scoreBefore: number,
): void {
  const player = state.players.find((p) => p.id === playerId)
  if (!player) return
  const acquirables = state.variant.data.acquirables
  if (acquirables.length === 0) return
  const interval = acquirables[0].points
  let earned = Math.floor(player.score / interval) - Math.floor(scoreBefore / interval)
  while (earned > 0 && legion.creatures.length < 7) {
    const pick =
      [...acquirables]
        .filter((a) => player.score >= a.points && (state.caretaker[a.name] ?? 0) > 0)
        .sort((a, b) => b.points - a.points)[0] ?? null
    if (!pick) break
    state.caretaker[pick.name] -= 1
    legion.creatures.push({ type: pick.name, hits: 0 })
    revealCreatures(legion, [pick.name])
    state.log.push(`${player.name} acquires an ${pick.name}!`)
    earned -= 1
  }
}

/**
 * @param slayerId player who gets half points for leftover unengaged stacks (Q8)
 */
export function checkTitanDeath(state: GameState, slayerId: string | null): void {
  for (const player of state.players) {
    if (player.dead) continue
    const hasTitan = state.legions.some(
      (l) => l.playerId === player.id && l.creatures.some((c) => c.type === 'Titan'),
    )
    if (!hasTitan) {
      player.dead = true
      state.log.push(`${player.name} is eliminated (Titan slain)!`)
      const leftovers = state.legions.filter((l) => l.playerId === player.id)
      // Colossus PlayerServerSide.die: engaged leftovers → enemy on that hex;
      // unengaged → slayer. No angels from leftover half-points.
      for (const leg of leftovers) {
        const enemy = state.legions.find(
          (e) => e.hexLabel === leg.hexLabel && e.playerId !== leg.playerId,
        )
        const scorerId = enemy?.playerId ?? slayerId
        const scorer = scorerId ? state.players.find((p) => p.id === scorerId) : undefined
        if (!scorer) continue
        let bonus = 0
        for (const c of leg.creatures) {
          const t = state.variant.creatures[c.type]
          if (!t) continue
          const power = c.type === 'Titan' ? (player.titanPower ?? 6) : t.power
          bonus += Math.floor((power * t.skill) / 2)
        }
        if (bonus > 0) {
          scorer.score += bonus
          state.log.push(
            `${scorer.name} scores ${bonus} half-points for ${player.name}'s ${leg.markerId} (no angels)`,
          )
        }
      }
      for (const leg of [...leftovers]) {
        eliminateLegionToCaretaker(state, leg)
      }
      // After leftovers return their markers, transfer the entire free pool to the slayer
      const slayer = slayerId ? state.players.find((p) => p.id === slayerId) : undefined
      if (slayer && player.markersAvailable.length > 0) {
        for (const m of player.markersAvailable) {
          if (!slayer.markersAvailable.includes(m)) {
            slayer.markersAvailable.push(m)
          }
        }
        player.markersAvailable = []
      }
    }
  }
  const alive = state.players.filter((p) => !p.dead)
  if (alive.length === 1) {
    state.winnerId = alive[0].id
    state.draw = false
    state.message = `${alive[0].name} wins!`
  } else if (alive.length === 0) {
    // Colossus GameServerSide.checkForVictory case 0 — Draw
    state.draw = true
    state.winnerId = null
    state.message = 'Draw — all Titans slain'
    state.log.push(state.message)
  }
}

export function doCarry(state: GameState, battle: BattleState, targetId: string): void {
  const carry = battle.pendingCarry
  if (!carry || !carry.targetIds.includes(targetId)) throw new Error('Illegal carry')
  applyCarry(state, battle, targetId, carry.hitsLeft)
  battle.pendingCarry = null
  // Side elimination waits until removeDeadCreatures after Strikeback.
}
