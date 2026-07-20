/**
 * Battle phase machine, start/end, time-loss — orchestrates battleland / movement / strike.
 */
import { buildBattleland, type BuiltBattleland } from './battleland'
import { legalBattleMoves } from './battleMovement'
import {
  applyCarry,
  getUnitPower,
  getUnitSkill,
  hasForcedStrike,
  isUnitAlive,
  legalStrikes as findLegalStrikes,
  resolveStrike as doResolveStrike,
} from './battleStrike'
import { eliminateLegionToCaretaker } from './engagement'
import type {
  BattleHalf,
  BattleState,
  BattleUnit,
  EntrySide,
  GameState,
  Legion,
} from './types'

export const MAX_BATTLE_TURNS = 7
export { getUnitPower, getUnitSkill, isUnitAlive }

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

function oppositeSide(side: EntrySide): EntrySide | 'Top' {
  if (side === 'Bottom') return 'Top'
  if (side === 'Left') return 'Right'
  return 'Left'
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
  const entry = attacker.enteredFrom ?? 'Bottom'
  const atkSide = entry
  const defSide = oppositeSide(entry)
  const atkEntrances = land.entrances[atkSide === 'Bottom' ? 'Bottom' : atkSide === 'Left' ? 'Left' : 'Right']
  const defEntrances =
    land.entrances[defSide === 'Top' ? 'Top' : defSide === 'Left' ? 'Left' : defSide === 'Right' ? 'Right' : 'Bottom']

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
    denySummon: false,
  }
  landCache.set(battle, land)
  return battle
}

function booleanFalse(): boolean {
  return false
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

export function resolveStrikeFor(
  state: GameState,
  battle: BattleState,
  attackerId: string,
  defenderId: string,
  rng: () => number,
): string {
  const land = battleLand(state, battle)
  const { message, carries } = doResolveStrike(state, battle, land, attackerId, defenderId, rng)
  if (carries) {
    battle.pendingCarry = { fromUnitId: attackerId, hitsLeft: carries.hitsLeft, targetIds: carries.targetIds }
  }
  if (
    !battle.attackerSummoned &&
    !battle.denySummon &&
    battle.units.some((u) => u.legionId === battle.defenderLegionId && !isUnitAlive(state, u))
  ) {
    battle.pendingSummon = true
  }
  return message
}

/** Back-compat name used by GameEngine */
export function resolveStrike(
  state: GameState,
  battle: BattleState,
  attackerId: string,
  defenderId: string,
  rng: () => number,
): string {
  return resolveStrikeFor(state, battle, attackerId, defenderId, rng)
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
  checkBattleEnd(state, battle)
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
    if (battle.activeHalf === 'defender') {
      if (!battle.firstManeuverDone.defender) {
        killUnentered(state, battle, 'defender')
        battle.firstManeuverDone.defender = true
        if (battle.done) return
      }
      battle.activeHalf = 'attacker'
      const atk = state.legions.find((l) => l.id === battle.attackerLegionId)
      battle.activePlayerId = atk?.playerId ?? battle.activePlayerId
      // Summon phase before attacker move if pending
      if (battle.pendingSummon && !battle.attackerSummoned && !battle.denySummon) {
        battle.phase = 'Summon'
      } else {
        battle.phase = 'Move'
      }
      for (const u of battle.units) {
        u.moved = false
        u.struck = false
      }
    } else {
      if (!battle.firstManeuverDone.attacker) {
        killUnentered(state, battle, 'attacker')
        battle.firstManeuverDone.attacker = true
        if (battle.done) return
      }
      const nextTurn = battle.turn + 1
      if (nextTurn > MAX_BATTLE_TURNS) {
        applyTimeLoss(state, battle)
        return
      }
      battle.turn = nextTurn
      battle.activeHalf = 'defender'
      const def = state.legions.find((l) => l.id === battle.defenderLegionId)
      battle.activePlayerId = def?.playerId ?? battle.activePlayerId
      // Reinforce at start of defender's 4th maneuver
      if (nextTurn === 4 && !battle.defenderReinforced) {
        battle.phase = 'Recruit'
      } else {
        battle.phase = 'Move'
      }
      for (const u of battle.units) {
        u.moved = false
        u.struck = false
      }
    }
  } else if (battle.phase === 'Summon' || battle.phase === 'Recruit') {
    battle.phase = 'Move'
  }

  battle.selectedUnitId = null
  battle.highlighted = []
}

export function applyBattleResult(state: GameState, battle: BattleState): void {
  const attacker = state.legions.find((l) => l.id === battle.attackerLegionId)
  const defender = state.legions.find((l) => l.id === battle.defenderLegionId)
  if (!attacker || !defender) return

  const syncLegion = (legion: Legion) => {
    const survivors = battle.units.filter(
      (u) => u.legionId === legion.id && isUnitAlive(state, u),
    )
    const deadTypes = [...legion.creatures]
    legion.creatures = survivors.map((u) => ({ type: u.creatureType, hits: 0 }))
    const before = deadTypes.map((c) => c.type)
    const after = legion.creatures.map((c) => c.type)
    for (const t of before) {
      const idx = after.indexOf(t)
      if (idx >= 0) after.splice(idx, 1)
      else state.caretaker[t] = (state.caretaker[t] ?? 0) + 1
    }
  }

  const pointsFor = (loserLegionId: string, fullValue: boolean) => {
    let pts = 0
    for (const u of battle.units) {
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
      if (slayerId) {
        const slayer = state.players.find((p) => p.id === slayerId)
        if (slayer) {
          let bonus = 0
          for (const leg of leftovers) {
            for (const c of leg.creatures) {
              const t = state.variant.creatures[c.type]
              if (!t) continue
              bonus += Math.floor((t.power * t.skill) / 2)
            }
            // Transfer marker availability (Q9)
            slayer.nextMarker = Math.max(slayer.nextMarker, Number(leg.markerId.replace(/\D/g, '')) + 1 || slayer.nextMarker)
          }
          if (bonus > 0) {
            slayer.score += bonus
            // No angels from these points — skip maybeAcquireAngel
            state.log.push(
              `${slayer.name} scores ${bonus} half-points for ${player.name}'s remaining legions (no angels)`,
            )
          }
        }
      }
      for (const leg of [...leftovers]) {
        eliminateLegionToCaretaker(state, leg)
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
  checkBattleEnd(state, battle)
}
