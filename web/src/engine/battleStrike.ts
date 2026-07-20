/**
 * Battle strikes / rangestrikes — Colossus BattleStrike (dice + strike number,
 * including hazard terrain / hexside modifiers).
 */
import type { BuiltBattleland } from './battleland'
import {
  battleNeighbors,
  blocksLOS,
  directionBetween,
  isNativeIn,
  oppositeHazard,
} from './battleland'
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
    const range = hexDistance(land, attacker.hex, defender.hex)
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

function isAdjacent(land: BuiltBattleland, a: string, b: string): boolean {
  return battleNeighbors(land, a).includes(b)
}

function losBlocked(land: BuiltBattleland, from: string, to: string): boolean {
  if (isAdjacent(land, from, to)) return false
  const dist = hexDistance(land, from, to)
  const q: { h: string; d: number; blocked: boolean }[] = [{ h: from, d: 0, blocked: false }]
  const best = new Map<string, boolean>()
  best.set(from, false)
  while (q.length) {
    const cur = q.shift()!
    if (cur.d >= dist) continue
    for (const n of battleNeighbors(land, cur.h)) {
      if (n === to) {
        if (!cur.blocked) return false
        continue
      }
      const hex = land.hexByLabel[n]
      const blocked = cur.blocked || (hex ? blocksLOS(hex) : false)
      const prev = best.get(n)
      if (prev === false) continue
      if (prev === true && blocked) continue
      best.set(n, blocked)
      q.push({ h: n, d: cur.d + 1, blocked })
    }
  }
  return true
}

export function legalStrikes(
  state: GameState,
  battle: { units: BattleUnit[] },
  land: BuiltBattleland,
  unit: BattleUnit,
  allowRangestrike: boolean,
): string[] {
  if (!unit.hex || unit.struck || !isUnitAlive(state, unit)) return []
  const type = state.variant.creatures[unit.creatureType]
  const enemies = battle.units.filter(
    (u) => u.playerId !== unit.playerId && isUnitAlive(state, u) && u.hex,
  )
  const result: string[] = []
  const inContact = enemies.some((e) => isAdjacent(land, unit.hex!, e.hex!))

  for (const e of enemies) {
    if (isAdjacent(land, unit.hex, e.hex!)) {
      result.push(e.id)
      continue
    }
    if (!allowRangestrike || !type?.rangestrikes || inContact) continue
    const dist = hexDistance(land, unit.hex, e.hex!)
    const skill = getUnitSkill(state, unit)
    if (dist < 2 || dist > Math.min(skill, 4)) continue
    if (!type.magicMissile) {
      if (dist < 3) continue
      const defType = state.variant.creatures[e.creatureType]
      if (defType?.lord || defType?.demilord) continue
      if (losBlocked(land, unit.hex, e.hex!)) continue
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
  return battle.units.some(
    (u) =>
      u.playerId === playerId &&
      isUnitAlive(state, u) &&
      !u.struck &&
      u.hex != null &&
      battle.units.some(
        (e) =>
          e.playerId !== u.playerId &&
          isUnitAlive(state, e) &&
          e.hex &&
          isAdjacent(land, u.hex!, e.hex!),
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
): { message: string; carries: { hitsLeft: number; targetIds: string[] } | null } {
  const attacker = battle.units.find((u) => u.id === attackerId)
  const defender = battle.units.find((u) => u.id === defenderId)
  if (!attacker || !defender || !attacker.hex || !defender.hex) {
    return { message: 'Invalid strike', carries: null }
  }

  const melee = isAdjacent(land, attacker.hex, defender.hex)
  const dice = getStrikeDice(state, land, attacker, defender, melee)
  const need = getStrikeNumber(state, attacker, defender, land, melee)
  let hits = 0
  const rolls: number[] = []
  for (let i = 0; i < dice; i++) {
    const d = rollDie(rng)
    rolls.push(d)
    if (d >= need) hits++
  }

  const powerBefore = getUnitPower(state, defender)
  const neededToKill = Math.max(0, powerBefore - defender.hits)
  defender.hits += hits
  attacker.struck = true
  const killed = !isUnitAlive(state, defender)
  const msg = `${attacker.creatureType} rolls [${rolls.join(',')}] need ${need}+: ${hits} hit(s)${killed ? ' — KILLED' : ''}`

  let carries: { hitsLeft: number; targetIds: string[] } | null = null
  if (melee) {
    const carryHits = Math.max(0, hits - neededToKill)
    if (carryHits > 0) {
      const others = battle.units.filter(
        (u) =>
          u.id !== defender.id &&
          u.playerId === defender.playerId &&
          isUnitAlive(state, u) &&
          u.hex &&
          isAdjacent(land, attacker.hex!, u.hex),
      )
      if (others.length) {
        carries = { hitsLeft: carryHits, targetIds: others.map((o) => o.id) }
      }
    }
  }

  return { message: msg, carries }
}

export function applyCarry(state: GameState, battle: { units: BattleUnit[] }, targetId: string, hits: number): void {
  const target = battle.units.find((u) => u.id === targetId)
  if (!target || !isUnitAlive(state, target)) return
  target.hits += hits
}
