/**
 * Battle strikes / rangestrikes — Colossus BattleStrike (dice + strike number,
 * including hazard terrain / hexside modifiers).
 */
import type { BuiltBattleland } from './battleland'
import {
  battleNeighbors,
  directionBetween,
  isNativeIn,
  meleeNeighbors,
  oppositeHazard,
} from './battleland'
import { isLosBlocked } from './battleLos'
import { rollDie } from './movement'
import type { BattleUnit, GameState } from './types'
import type { CreatureType } from '../types/variant'

export function getUnitPower(state: GameState, u: BattleUnit): number {
  if (u.creatureType === 'Titan') {
    return state.players.find((pl) => pl.id === u.playerId)?.titanPower ?? 6
  }
  return state.variant.creatures[u.creatureType]?.power ?? 1
}

export function getUnitSkill(state: GameState, u: BattleUnit): number {
  return state.variant.creatures[u.creatureType]?.skill ?? 2
}

export function isUnitAlive(state: GameState, u: BattleUnit): boolean {
  return u.hits < getUnitPower(state, u)
}

function creatureOf(state: GameState, u: BattleUnit): CreatureType | undefined {
  return state.variant.creatures[u.creatureType]
}

function nativeTerrain(c: CreatureType | undefined, terrain: string): boolean {
  return c != null && isNativeIn(c, terrain)
}

function nativeSlope(c: CreatureType | undefined): boolean {
  return Boolean(c?.native.slope)
}

/** Colossus: Sand attribute ⇒ native dune. */
function nativeDune(c: CreatureType | undefined): boolean {
  return Boolean(c?.native.Sand)
}

/**
 * Colossus HazardTerrain.getSkillBonusStruckIn — defense skill bonus added to
 * strike number when the defender is struck in this terrain.
 * Brambles/Tree PATRIOTS: +1 when defender native and attacker not.
 */
function skillBonusStruckIn(
  terrain: string,
  attackerNative: boolean,
  defenderNative: boolean,
): number {
  // PATRIOTS skill bonus 1: native defender vs foreign attacker (Brambles / Tree / Stone)
  if (terrain === 'Brambles' || terrain === 'Tree' || terrain === 'Stone') {
    if (defenderNative && !attackerNative) return 1
  }
  return 0
}

/**
 * Colossus getSkillPenaltyStrikeFrom — subtracted from attacker skill when
 * striking out of this terrain. Brambles FOREIGNERS skill penalty 1.
 */
function skillPenaltyStrikeFrom(terrain: string, attackerNative: boolean): number {
  if (terrain === 'Brambles' && !attackerNative) return 1
  return 0
}

/** Min intervening Brambles hexes on a shortest path (endpoints excluded). */
function countInterveningBrambles(land: BuiltBattleland, from: string, to: string): number {
  if (from === to) return 0
  const q: { h: string; d: number; brambles: number }[] = [{ h: from, d: 0, brambles: 0 }]
  const best = new Map<string, { d: number; brambles: number }>()
  best.set(from, { d: 0, brambles: 0 })
  let minBrambles = 99
  while (q.length) {
    const cur = q.shift()!
    for (const n of battleNeighbors(land, cur.h)) {
      if (n === to) {
        minBrambles = Math.min(minBrambles, cur.brambles)
        continue
      }
      const hex = land.hexByLabel[n]
      const add = hex?.terrain === 'Brambles' ? 1 : 0
      const nextD = cur.d + 1
      const nextB = cur.brambles + add
      const prev = best.get(n)
      if (prev && (prev.d < nextD || (prev.d === nextD && prev.brambles <= nextB))) continue
      best.set(n, { d: nextD, brambles: nextB })
      q.push({ h: n, d: nextD, brambles: nextB })
    }
  }
  return minBrambles >= 99 ? 0 : minBrambles
}

/**
 * Dice rolled for this strike (Colossus BattleStrike.getDice).
 */
export function getStrikeDice(
  state: GameState,
  land: BuiltBattleland,
  attacker: BattleUnit,
  defender: BattleUnit,
  melee: boolean,
): number {
  const atkType = creatureOf(state, attacker)
  let dice = getUnitPower(state, attacker)
  if (!attacker.hex || !defender.hex) {
    return melee ? dice : Math.floor(dice / 2)
  }
  const hex = land.hexByLabel[attacker.hex]
  if (!hex) return melee ? dice : Math.floor(dice / 2)

  if (!melee) {
    dice = Math.floor(dice / 2)
    if (hex.terrain === 'Volcano' && nativeTerrain(atkType, 'Volcano')) dice += 2
    return Math.max(0, dice)
  }

  if (hex.terrain === 'Volcano' && nativeTerrain(atkType, 'Volcano')) dice += 2

  const dir = directionBetween(land, attacker.hex, defender.hex)
  if (dir >= 0) {
    const hazard = hex.hexsides[dir] ?? 'nothing'
    if (hazard === 'dune' && nativeDune(atkType)) dice += 2
    else if (hazard === 'slope' && nativeSlope(atkType)) dice += 1
    else if (!nativeDune(atkType) && oppositeHazard(land, hex, dir) === 'dune') dice -= 1
  }

  return Math.max(0, dice)
}

/**
 * Effective attacker skill after terrain / hexside / range penalties
 * (Colossus BattleStrike.getAttackerSkill).
 */
export function getAttackerSkill(
  state: GameState,
  land: BuiltBattleland,
  attacker: BattleUnit,
  defender: BattleUnit,
  melee: boolean,
): number {
  const atkType = creatureOf(state, attacker)
  const defType = creatureOf(state, defender)
  let skill = getUnitSkill(state, attacker)
  if (!attacker.hex || !defender.hex) return skill

  const hex = land.hexByLabel[attacker.hex]
  const targetHex = land.hexByLabel[defender.hex]
  if (!hex || !targetHex) return skill

  if (melee) {
    skill -= skillPenaltyStrikeFrom(hex.terrain, nativeTerrain(atkType, hex.terrain))

    if (hex.elevation > targetHex.elevation) {
      const dir = directionBetween(land, attacker.hex, defender.hex)
      if (dir >= 0 && hex.hexsides[dir] === 'tower') skill += 1
    } else if (hex.elevation < targetHex.elevation) {
      const dir = directionBetween(land, defender.hex, attacker.hex)
      if (dir >= 0) {
        const hazard = targetHex.hexsides[dir] ?? 'nothing'
        if ((hazard === 'slope' && !nativeSlope(atkType)) || hazard === 'tower') skill -= 1
      }
    }
  } else if (!atkType?.magicMissile) {
    // Titan range is inclusive at both ends (adjacent = 2). Penalty only at range ≥ 4.
    const range = titanRange(land, attacker.hex, defender.hex)
    if (range >= 4) skill -= range - 3
    if (!nativeTerrain(atkType, 'Brambles')) {
      skill -= countInterveningBrambles(land, attacker.hex, defender.hex)
    }
    // Colossus BattleHex.hasWall(): any tower/wall hexside (not Tower terrain name)
    if (targetHex.hexsides.some((h) => h === 'tower')) {
      const heightDeficit = targetHex.elevation - hex.elevation
      if (heightDeficit > 0) skill -= heightDeficit
    }
    if (targetHex.terrain === 'Volcano') skill -= 1
  }

  void defType
  return skill
}

/**
 * Strike number to hit (Colossus BattleStrike.getStrikeNumber).
 * Without land/hexes: plain 4 - atkSkill + defSkill (clamped).
 */
export function getStrikeNumber(
  state: GameState,
  attacker: BattleUnit,
  defender: BattleUnit,
  land?: BuiltBattleland,
  melee = true,
): number {
  const defSkill = getUnitSkill(state, defender)
  let attackerSkill = getUnitSkill(state, attacker)
  let strikeNumber = 4 - attackerSkill + defSkill

  if (land && attacker.hex && defender.hex) {
    const atkType = creatureOf(state, attacker)
    const defType = creatureOf(state, defender)
    attackerSkill = getAttackerSkill(state, land, attacker, defender, melee)
    strikeNumber = 4 - attackerSkill + defSkill

    const targetHex = land.hexByLabel[defender.hex]
    if (targetHex) {
      if (melee) {
        strikeNumber += skillBonusStruckIn(
          targetHex.terrain,
          nativeTerrain(atkType, targetHex.terrain),
          nativeTerrain(defType, targetHex.terrain),
        )
      } else if (!atkType?.magicMissile) {
        // Native defending in Brambles/Stone from non-native non-missile rangestrike
        if (
          (targetHex.terrain === 'Brambles' || targetHex.terrain === 'Stone') &&
          nativeTerrain(defType, targetHex.terrain) &&
          !nativeTerrain(atkType, targetHex.terrain)
        ) {
          strikeNumber += 1
        }
      }
    }
  }

  return Math.min(6, Math.max(1, strikeNumber))
}

export function hexDistance(land: BuiltBattleland, a: string, b: string): number {
  if (a === b) return 0
  const q: { h: string; d: number }[] = [{ h: a, d: 0 }]
  const seen = new Set([a])
  while (q.length) {
    const cur = q.shift()!
    for (const n of battleNeighbors(land, cur.h)) {
      if (seen.has(n)) continue
      if (n === b) return cur.d + 1
      seen.add(n)
      q.push({ h: n, d: cur.d + 1 })
    }
  }
  return 99
}

/**
 * Titan / Colossus rangestrike range: inclusive at both ends (own hex + target +
 * intervening). Adjacent = 2; one empty hex between = 3; two empty = 4 (max).
 * Matches Colossus `Battle.getRange` for connected battle hexes.
 */
export function titanRange(land: BuiltBattleland, a: string, b: string): number {
  const steps = hexDistance(land, a, b)
  if (steps >= 99) return 99
  return steps + 1
}

function isMeleeAdjacent(land: BuiltBattleland, a: string, b: string): boolean {
  return meleeNeighbors(land, a).includes(b)
}

/**
 * Free carry targets: adjacent enemies where strike number/dice are no worse than
 * the primary strike (Colossus CreatureServerSide.findCarry without penalty options).
 * With `raisedStrikeNumber`, treat the primary strike as needing that SN so harder
 * targets that match the raised need become legal carries.
 */
export function legalCarryTargetIds(
  state: GameState,
  battle: { units: BattleUnit[] },
  land: BuiltBattleland,
  attacker: BattleUnit,
  primary: BattleUnit,
  raisedStrikeNumber?: number,
): string[] {
  if (!attacker.hex) return []
  const baseDice = getStrikeDice(state, land, attacker, primary, true)
  const naturalSn = getStrikeNumber(state, attacker, primary, land, true)
  const primarySn = raisedStrikeNumber != null ? Math.max(naturalSn, raisedStrikeNumber) : naturalSn

  return battle.units
    .filter((u) => {
      if (u.id === primary.id) return false
      if (u.playerId !== primary.playerId) return false
      if (!isUnitAlive(state, u) || !u.hex) return false
      if (!isMeleeAdjacent(land, attacker.hex!, u.hex)) return false

      let tmpDice = getStrikeDice(state, land, attacker, u, true)
      let tmpSn = getStrikeNumber(state, attacker, u, land, true)
      if (tmpDice > baseDice) tmpDice = baseDice
      if (tmpSn < primarySn) tmpSn = primarySn
      return tmpSn === primarySn && tmpDice === baseDice
    })
    .map((u) => u.id)
}

export type StrikeRaiseOption = {
  /** Announced Strike-number (higher than natural). */
  need: number
  /** Carry targets that become legal only because of this raise. */
  newlyEnabledIds: string[]
}

/**
 * Optional raised Strike-numbers that unlock harder adjacent carry targets.
 * Announce one of these before rolling (Titan Engagements).
 */
export function listStrikeRaiseOptions(
  state: GameState,
  battle: { units: BattleUnit[] },
  land: BuiltBattleland,
  attacker: BattleUnit,
  primary: BattleUnit,
): { naturalNeed: number; melee: boolean; options: StrikeRaiseOption[] } {
  if (!attacker.hex || !primary.hex) {
    return { naturalNeed: 6, melee: false, options: [] }
  }
  const melee = isMeleeAdjacent(land, attacker.hex, primary.hex)
  const naturalNeed = getStrikeNumber(state, attacker, primary, land, melee)
  if (!melee) return { naturalNeed, melee: false, options: [] }

  const free = new Set(legalCarryTargetIds(state, battle, land, attacker, primary))
  const options: StrikeRaiseOption[] = []
  for (let need = naturalNeed + 1; need <= 6; need++) {
    const raised = legalCarryTargetIds(state, battle, land, attacker, primary, need)
    const newlyEnabledIds = raised.filter((id) => !free.has(id))
    if (newlyEnabledIds.length > 0) {
      options.push({ need, newlyEnabledIds })
    }
  }
  return { naturalNeed, melee: true, options }
}

function occupiedHexes(battle: { units: BattleUnit[] }): Set<string> {
  const set = new Set<string>()
  for (const u of battle.units) {
    if (u.hex) set.add(u.hex)
  }
  return set
}

export function legalStrikes(
  state: GameState,
  battle: { units: BattleUnit[] },
  land: BuiltBattleland,
  unit: BattleUnit,
  allowRangestrike: boolean,
): string[] {
  // Dead strikers still act until removeDeadCreatures (simultaneous combat / Strikeback).
  if (!unit.hex || unit.struck) return []
  const type = state.variant.creatures[unit.creatureType]
  // Contact includes dead enemies still on the board (Colossus findTargetHexes:
  // adjacentEnemy=true even if target.isDead()). They are removed only after Strikeback,
  // so killing an adjacent foe this Strike phase does not free you to rangestrike.
  const opposingOnBoard = battle.units.filter(
    (u) => u.playerId !== unit.playerId && u.hex != null,
  )
  const inContact = opposingOnBoard.some((e) => isMeleeAdjacent(land, unit.hex!, e.hex!))
  const livingEnemies = opposingOnBoard.filter((u) => isUnitAlive(state, u))
  const occupied = occupiedHexes(battle)
  const result: string[] = []

  for (const e of livingEnemies) {
    if (isMeleeAdjacent(land, unit.hex, e.hex!)) {
      result.push(e.id)
      continue
    }
    if (!allowRangestrike || !type?.rangestrikes || inContact) continue
    // Titan range (inclusive): max = min(skill, 4); non-missile needs range ≥ 3.
    const range = titanRange(land, unit.hex, e.hex!)
    const skill = getUnitSkill(state, unit)
    if (range > Math.min(skill, 4)) continue
    if (!type.magicMissile) {
      if (range < 3) continue
      const defType = state.variant.creatures[e.creatureType]
      // Lords (Titan/Angel/Archangel) immune except Warlock (magicMissile).
      // Demilords (Guardian, Warlock) are not immune.
      if (defType?.lord) continue
      // Geometric LOS: intervening Tree/Stone or creatures block (Colossus isLOSBlocked).
      if (isLosBlocked(land, unit.hex, e.hex!, occupied)) continue
    }
    result.push(e.id)
  }
  return result
}

export function hasForcedStrike(
  state: GameState,
  battle: { units: BattleUnit[] },
  land: BuiltBattleland,
  playerId: string,
): boolean {
  // Colossus isForcedStrikeRemaining: dead strikers still forced if in contact
  // with a living enemy (countDead=false for the contact target).
  return battle.units.some(
    (u) =>
      u.playerId === playerId &&
      !u.struck &&
      u.hex != null &&
      battle.units.some(
        (e) =>
          e.playerId !== u.playerId &&
          isUnitAlive(state, e) &&
          e.hex &&
          isMeleeAdjacent(land, u.hex!, e.hex!),
      ),
  )
}

export function resolveStrike(
  state: GameState,
  battle: { units: BattleUnit[] },
  land: BuiltBattleland,
  attackerId: string,
  defenderId: string,
  rng: () => number,
  /** When set, use these faces instead of rolling (physical dice / tests). */
  forcedRolls?: number[],
  /**
   * Optional higher Strike-number announced before the roll so excess hits can
   * carry to harder adjacent targets (Titan Engagements).
   */
  raisedStrikeNumber?: number,
): {
  message: string
  carries: { hitsLeft: number; targetIds: string[] } | null
  rolls: number[]
  need: number
  hits: number
  attackerType: string
  defenderType: string
} {
  const attacker = battle.units.find((u) => u.id === attackerId)
  const defender = battle.units.find((u) => u.id === defenderId)
  if (!attacker || !defender || !attacker.hex || !defender.hex) {
    return {
      message: 'Invalid strike',
      carries: null,
      rolls: [],
      need: 6,
      hits: 0,
      attackerType: '?',
      defenderType: '?',
    }
  }

  const melee = isMeleeAdjacent(land, attacker.hex, defender.hex)
  const dice = getStrikeDice(state, land, attacker, defender, melee)
  const naturalNeed = getStrikeNumber(state, attacker, defender, land, melee)
  const need =
    raisedStrikeNumber != null && raisedStrikeNumber > naturalNeed
      ? raisedStrikeNumber
      : naturalNeed
  let hits = 0
  const rolls: number[] = []
  if (forcedRolls != null) {
    if (forcedRolls.length !== dice) {
      throw new Error(`Strike expects ${dice} dice, got ${forcedRolls.length}`)
    }
    for (const d of forcedRolls) {
      if (d < 1 || d > 6) throw new Error(`Invalid die face ${d}`)
      rolls.push(d)
      if (d >= need) hits++
    }
  } else {
    for (let i = 0; i < dice; i++) {
      const d = rollDie(rng)
      rolls.push(d)
      if (d >= need) hits++
    }
  }

  const powerBefore = getUnitPower(state, defender)
  const neededToKill = Math.max(0, powerBefore - defender.hits)
  defender.hits += hits
  attacker.struck = true
  const killed = !isUnitAlive(state, defender)
  const raiseNote = need > naturalNeed ? ` (raised SN ${need})` : ''
  const msg = `${attacker.creatureType} rolls [${rolls.join(',')}] need ${need}+: ${hits} hit(s)${raiseNote}${killed ? ' — KILLED' : ''}`

  let carries: { hitsLeft: number; targetIds: string[] } | null = null
  if (melee) {
    const carryHits = Math.max(0, hits - neededToKill)
    if (carryHits > 0) {
      const targetIds = legalCarryTargetIds(
        state,
        battle,
        land,
        attacker,
        defender,
        need > naturalNeed ? need : undefined,
      )
      if (targetIds.length) {
        carries = { hitsLeft: carryHits, targetIds }
      }
    }
  }

  return {
    message: msg,
    carries,
    rolls,
    need,
    hits,
    attackerType: attacker.creatureType,
    defenderType: defender.creatureType,
  }
}

export function applyCarry(state: GameState, battle: { units: BattleUnit[] }, targetId: string, hits: number): void {
  const target = battle.units.find((u) => u.id === targetId)
  if (!target || !isUnitAlive(state, target)) return
  target.hits += hits
}
