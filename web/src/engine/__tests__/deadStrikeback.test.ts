import { describe, expect, it } from 'vitest'
import {
  activePlayerHasLegalStrike,
  advanceBattlePhase,
  battleLand,
  getUnitPower,
  hasForcedStrike,
  isUnitAlive,
  legalStrikesFor,
  resolveStrikeFor,
  startBattle,
} from '../battle'
import { battleNeighbors } from '../battleland'
import { dispatch } from '../GameEngine'
import { twoPlayerGame } from './helpers'

function adjacentStrikeSetup() {
  const state = twoPlayerGame(11)
  const alice = state.players[0]!
  const bob = state.players[1]!
  const attacker = state.legions.find((l) => l.playerId === alice.id)!
  const defender = state.legions.find((l) => l.playerId === bob.id)!
  attacker.creatures = [
    { type: 'Titan', hits: 0 },
    { type: 'Lion', hits: 0 },
  ]
  defender.creatures = [
    { type: 'Titan', hits: 0 },
    { type: 'Centaur', hits: 0 },
  ]
  const hex =
    Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')?.label ??
    attacker.hexLabel
  attacker.hexLabel = hex
  defender.hexLabel = hex
  attacker.enteredFrom = 'Bottom'
  const battle = startBattle(state, attacker, defender, () => 0.5)
  state.battle = battle

  const land = battleLand(state, battle)
  const atkHex = battle.attackerEntrances[0]!
  const neighbors = battleNeighbors(land, atkHex)
  expect(neighbors.length).toBeGreaterThan(0)
  const defHex = neighbors[0]!

  for (const u of battle.units) {
    if (u.legionId === battle.attackerLegionId && u.creatureType === 'Lion') {
      u.hex = atkHex
    } else if (u.legionId === battle.defenderLegionId && u.creatureType === 'Centaur') {
      u.hex = defHex
    } else {
      // Park Titans far on remaining entrances so they stay out of contact
      u.hex =
        u.legionId === battle.attackerLegionId
          ? battle.attackerEntrances[battle.attackerEntrances.length - 1]!
          : battle.defenderEntrances[battle.defenderEntrances.length - 1]!
    }
  }
  battle.firstManeuverDone = { attacker: true, defender: true }

  const lion = battle.units.find(
    (u) => u.legionId === battle.attackerLegionId && u.creatureType === 'Lion',
  )!
  const centaur = battle.units.find(
    (u) => u.legionId === battle.defenderLegionId && u.creatureType === 'Centaur',
  )!
  return { state, battle, land, alice, bob, lion, centaur }
}

describe('dead creature strikeback', () => {
  it('K-dead: slain adjacent defender still has legal Strikeback targets', () => {
    const { state, battle, land, bob, lion, centaur } = adjacentStrikeSetup()

    centaur.hits = getUnitPower(state, centaur)
    expect(isUnitAlive(state, centaur)).toBe(false)
    expect(battle.units.some((u) => u.id === centaur.id)).toBe(true)

    battle.phase = 'Strikeback'
    battle.activeHalf = 'defender'
    battle.activePlayerId = bob.id
    for (const u of battle.units) u.struck = false

    const targets = legalStrikesFor(state, battle, centaur)
    expect(targets).toContain(lion.id)
    expect(activePlayerHasLegalStrike(state, battle)).toBe(true)
    expect(hasForcedStrike(state, battle, land, bob.id)).toBe(true)
  })

  it('K-dead: dead defender can resolve a strike during Strikeback', () => {
    const { state, battle, bob, lion, centaur } = adjacentStrikeSetup()
    centaur.hits = getUnitPower(state, centaur)
    battle.phase = 'Strikeback'
    battle.activeHalf = 'defender'
    battle.activePlayerId = bob.id
    for (const u of battle.units) u.struck = false

    const hitsBefore = lion.hits
    const result = resolveStrikeFor(state, battle, centaur.id, lion.id, () => 0.99)
    expect(result.hits).toBeGreaterThan(0)
    expect(lion.hits).toBeGreaterThan(hitsBefore)
    expect(centaur.struck).toBe(true)
  })

  it('K-dead: wiping the last living defender mid-Strike does not end the battle', () => {
    const { state, battle, alice, lion, centaur } = adjacentStrikeSetup()
    // Remove the defender Titan from the board so Centaur is the only living defender
    battle.units = battle.units.filter(
      (u) => !(u.legionId === battle.defenderLegionId && u.creatureType === 'Titan'),
    )
    centaur.hits = getUnitPower(state, centaur) - 1
    battle.phase = 'Strike'
    battle.activeHalf = 'attacker'
    battle.activePlayerId = alice.id
    battle.selectedUnitId = null
    battle.highlighted = []
    for (const u of battle.units) u.struck = false

    // Force enough hits to kill (Lion vs Centaur); use forced path via resolve then mimic engine
    const power = getUnitPower(state, centaur)
    centaur.hits = power // lethal during Strike
    lion.struck = true

    expect(isUnitAlive(state, centaur)).toBe(false)
    expect(
      battle.units.some(
        (u) => u.legionId === battle.defenderLegionId && isUnitAlive(state, u),
      ),
    ).toBe(false)

    // Engine no longer ends battle here — auto-advance to Strikeback when Strike is exhausted
    expect(activePlayerHasLegalStrike(state, battle)).toBe(false)
    advanceBattlePhase(state, battle)

    expect(battle.done).toBe(false)
    expect(battle.phase).toBe('Strikeback')
    expect(battle.units.some((u) => u.id === centaur.id)).toBe(true)
    expect(legalStrikesFor(state, battle, centaur)).toContain(lion.id)
  })

  it('K-dead: dispatch allows selecting and striking with a dead unit in Strikeback', () => {
    const { state, battle, bob, lion, centaur } = adjacentStrikeSetup()
    centaur.hits = getUnitPower(state, centaur)
    battle.phase = 'Strikeback'
    battle.activeHalf = 'defender'
    battle.activePlayerId = bob.id
    battle.turn = 1
    for (const u of battle.units) u.struck = false

    const next = dispatch(state, { type: 'battleSelectUnit', unitId: centaur.id }, () => 0.5)
    expect(next.battle!.selectedUnitId).toBe(centaur.id)
    expect(next.battle!.highlighted).toContain(lion.id)

    const lionHitsBefore = lion.hits
    const after = dispatch(
      next,
      { type: 'battleStrike', attackerId: centaur.id, defenderId: lion.id },
      () => 0.99,
    )
    // Strike resolves; phase may auto-advance and remove the dead Centaur afterward.
    const lionAfter = after.battle!.units.find((u) => u.id === lion.id)
    expect(lionAfter).toBeDefined()
    expect(lionAfter!.hits).toBeGreaterThan(lionHitsBefore)
    expect(after.log.some((line) => line.includes('Centaur') && line.includes('hit'))).toBe(true)
  })

  it('K-dead: after Strikeback, slain units leave and battle may then end', () => {
    const { state, battle, bob, lion, centaur } = adjacentStrikeSetup()
    // Wipe defender living units so removal ends the battle
    for (const u of battle.units) {
      if (u.legionId === battle.defenderLegionId) {
        u.hits = getUnitPower(state, u)
      }
    }
    expect(isUnitAlive(state, centaur)).toBe(false)
    expect(isUnitAlive(state, lion)).toBe(true)

    battle.phase = 'Strikeback'
    battle.activeHalf = 'defender'
    battle.activePlayerId = bob.id
    for (const u of battle.units) u.struck = true // already struck — empty forced check

    advanceBattlePhase(state, battle)

    expect(battle.units.some((u) => u.id === centaur.id)).toBe(false)
    expect(battle.fallen.some((u) => u.id === centaur.id)).toBe(true)
    expect(battle.done).toBe(true)
    expect(battle.winnerPlayerId).toBe(state.players[0]!.id)
  })
})
