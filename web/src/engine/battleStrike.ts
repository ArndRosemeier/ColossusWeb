/**
 * Battle strikes / rangestrikes — Colossus BattleStrikeServerSide.
 */
import type { BuiltBattleland } from './battleland'
import { battleNeighbors, blocksLOS } from './battleland'
import { rollDie } from './movement'
import type { BattleState, BattleUnit, GameState } from './types'

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

/** Colossus: strikeNumber = clamp(4 - atkSkill + defSkill, 1..6) */
export function getStrikeNumber(state: GameState, attacker: BattleUnit, defender: BattleUnit): number {
  const atk = getUnitSkill(state, attacker)
  const def = getUnitSkill(state, defender)
  return Math.min(6, Math.max(1, 4 - atk + def))
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
  battle: BattleState,
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
  battle: BattleState,
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
  battle: BattleState,
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

  const type = state.variant.creatures[attacker.creatureType]
  const melee = isAdjacent(land, attacker.hex, defender.hex)
  let dice = getUnitPower(state, attacker)
  if (!melee && type?.rangestrikes) {
    dice = Math.floor(dice / 2)
  }
  const need = getStrikeNumber(state, attacker, defender)
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

export function applyCarry(state: GameState, battle: BattleState, targetId: string, hits: number): void {
  const target = battle.units.find((u) => u.id === targetId)
  if (!target || !isUnitAlive(state, target)) return
  target.hits += hits
}
