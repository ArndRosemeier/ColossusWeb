/**
 * R reinforce + U summon success paths.
 */
import { describe, expect, it } from 'vitest'
import {
  advanceBattlePhase,
  listBattleReinforceOptions,
  listBattleSummonSources,
  resolveStrike,
  startBattle,
} from '../battle'
import { dispatch } from '../GameEngine'
import { twoPlayerGame, turn1SplitChild } from './helpers'

describe('R reinforce / U summon', () => {
  it('R1–R3: defender can reinforce on turn-4 Recruit when qualified', () => {
    const state = twoPlayerGame(41)
    const alice = state.players[0]!
    const bob = state.players[1]!
    const attacker = state.legions.find((l) => l.playerId === alice.id)!
    const defender = state.legions.find((l) => l.playerId === bob.id)!
    // Marsh: Troll recruits from Ogre (typical Default tree)
    const marsh =
      Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Marsh')?.label ??
      defender.hexLabel
    attacker.hexLabel = marsh
    defender.hexLabel = marsh
    attacker.enteredFrom = 'Bottom'
    defender.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Ogre', hits: 0 },
      { type: 'Ogre', hits: 0 },
    ]
    attacker.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Centaur', hits: 0 },
    ]
    state.caretaker.Troll = Math.max(state.caretaker.Troll ?? 0, 2)
    state.caretaker.Ogre = Math.max(state.caretaker.Ogre ?? 0, 2)

    const battle = startBattle(state, attacker, defender, () => 0.5)
    state.battle = battle
    state.phase = 'Battle'

    const options = listBattleReinforceOptions(state, battle)
    expect(options.length).toBeGreaterThan(0)
    const pick = options.includes('Troll') ? 'Troll' : options[0]!

    battle.turn = 4
    battle.phase = 'Recruit'
    battle.activeHalf = 'defender'
    battle.activePlayerId = bob.id
    battle.defenderReinforced = false
    const heightBefore = defender.creatures.length

    const next = dispatch(state, { type: 'battleReinforce', creatureType: pick })
    expect(next.battle!.defenderReinforced).toBe(true)
    expect(next.battle!.phase).toBe('Move')
    const defAfter = next.legions.find((l) => l.id === defender.id)!
    expect(defAfter.creatures.length).toBe(heightBefore + 1)
    expect(defAfter.creatures.some((c) => c.type === pick)).toBe(true)
    const reinforceUnit = next.battle!.units.find(
      (u) => u.legionId === defender.id && u.creatureType === pick && u.hex == null,
    )
    expect(reinforceUnit).toBeTruthy()
  })

  it('U1–U3: attacker summons Angel from unengaged donor after defender kill', () => {
    let state = twoPlayerGame(42)
    const alice = state.players[0]!
    const bob = state.players[1]!
    // Opening split so Alice has a donor Angel stack
    const parent = state.legions.find((l) => l.playerId === alice.id)!
    state = dispatch(state, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(state, parent),
    })
    const aliceLegs = state.legions.filter((l) => l.playerId === alice.id)
    expect(aliceLegs.length).toBe(2)
    const donor = aliceLegs.find((l) => l.creatures.some((c) => c.type === 'Angel'))!
    const attacker = aliceLegs.find((l) => l.id !== donor.id)!
    const defender = state.legions.find((l) => l.playerId === bob.id)!

    const plains =
      Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')?.label ??
      attacker.hexLabel
    attacker.hexLabel = plains
    defender.hexLabel = plains
    // Donor elsewhere, unengaged
    const other =
      Object.values(state.variant.board.hexByLabel).find(
        (h) => h.terrain === 'Plains' && h.label !== plains,
      )?.label ?? donor.hexLabel
    donor.hexLabel = other
    attacker.enteredFrom = 'Bottom'
    attacker.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Lion', hits: 0 },
    ]
    defender.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Ogre', hits: 0 },
    ]

    const battle = startBattle(state, attacker, defender, () => 0.5)
    state.battle = battle
    state.phase = 'Battle'

    const sources = listBattleSummonSources(state, battle)
    expect(sources.some((l) => l.id === donor.id)).toBe(true)

    battle.summonState = 'firstBlood'
    battle.pendingSummon = true
    battle.phase = 'Summon'
    battle.activeHalf = 'attacker'
    battle.activePlayerId = alice.id
    const atkHeight = attacker.creatures.length
    const donorAngels = donor.creatures.filter((c) => c.type === 'Angel').length

    const next = dispatch(state, { type: 'battleSummon', fromLegionId: donor.id })
    expect(next.battle!.attackerSummoned).toBe(true)
    expect(next.battle!.phase).toBe('Move')
    const atkAfter = next.legions.find((l) => l.id === attacker.id)!
    const donorAfter = next.legions.find((l) => l.id === donor.id)!
    expect(atkAfter.creatures.length).toBe(atkHeight + 1)
    expect(atkAfter.creatures.some((c) => c.type === 'Angel')).toBe(true)
    expect(donorAfter.creatures.filter((c) => c.type === 'Angel').length).toBe(donorAngels - 1)
    expect(
      next.battle!.units.some(
        (u) => u.legionId === attacker.id && u.creatureType === 'Angel' && u.hex == null,
      ),
    ).toBe(true)
  })

  it('U4: cannot summon from an engaged donor legion', () => {
    let state = twoPlayerGame(43)
    const alice = state.players[0]!
    const bob = state.players[1]!
    const parent = state.legions.find((l) => l.playerId === alice.id)!
    state = dispatch(state, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(state, parent),
    })
    // Also give Bob a second stack by splitting
    const bobParent = state.legions.find((l) => l.playerId === bob.id)!
    state = dispatch(state, { type: 'doneSplit' })
    // End Alice split and do Bob's turn-1 split via advancing — simpler: manually split Bob
    state.phase = 'Split'
    state.activePlayerIndex = state.players.findIndex((p) => p.id === bob.id)
    state = dispatch(state, {
      type: 'split',
      parentId: bobParent.id,
      childCreatures: turn1SplitChild(state, bobParent),
    })

    const aliceLegs = state.legions.filter((l) => l.playerId === alice.id)
    const bobLegs = state.legions.filter((l) => l.playerId === bob.id)
    const donor = aliceLegs.find((l) => l.creatures.some((c) => c.type === 'Angel'))!
    const attacker = aliceLegs.find((l) => l.id !== donor.id)!
    const defender = bobLegs[0]!
    const engager = bobLegs[1]!

    const plains = Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')!
    const hills = Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Hills')!
    attacker.hexLabel = plains.label
    defender.hexLabel = plains.label
    donor.hexLabel = hills.label
    engager.hexLabel = hills.label // engages the donor
    attacker.enteredFrom = 'Bottom'

    const battle = startBattle(state, attacker, defender, () => 0.5)
    state.battle = battle
    expect(listBattleSummonSources(state, battle).some((l) => l.id === donor.id)).toBe(false)
  })

  it('U: denySummon blocks summon phase entry', () => {
    const state = twoPlayerGame(44)
    const alice = state.players[0]!
    const bob = state.players[1]!
    const attacker = state.legions.find((l) => l.playerId === alice.id)!
    const defender = state.legions.find((l) => l.playerId === bob.id)!
    const plains =
      Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')?.label ??
      attacker.hexLabel
    attacker.hexLabel = plains
    defender.hexLabel = plains
    attacker.enteredFrom = 'Bottom'
    const battle = startBattle(state, attacker, defender, () => 0.5)
    state.battle = battle
    battle.denySummon = true
    battle.summonState = 'firstBlood'
    battle.pendingSummon = true
    battle.phase = 'Strikeback'
    battle.activeHalf = 'defender'
    battle.activePlayerId = bob.id
    for (const u of battle.units) {
      u.hex =
        u.legionId === battle.attackerLegionId
          ? battle.attackerEntrances[0]!
          : battle.defenderEntrances[0]!
      u.struck = true
    }
    battle.firstManeuverDone = { attacker: true, defender: true }
    advanceBattlePhase(state, battle)
    expect(battle.phase).not.toBe('Summon')
    expect(battle.pendingSummon).toBe(false)
  })

  it('U: summon window is only the first Maneuver after first blood — later kills do not reopen', () => {
    const state = twoPlayerGame(45)
    const alice = state.players[0]!
    const bob = state.players[1]!
    const attacker = state.legions.find((l) => l.playerId === alice.id)!
    const defender = state.legions.find((l) => l.playerId === bob.id)!
    const plains =
      Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')?.label ??
      attacker.hexLabel
    attacker.hexLabel = plains
    defender.hexLabel = plains
    attacker.enteredFrom = 'Bottom'
    attacker.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Lion', hits: 0 },
    ]
    defender.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Ogre', hits: 0 },
      { type: 'Centaur', hits: 0 },
    ]
    const battle = startBattle(state, attacker, defender, () => 0.5)
    state.battle = battle
    expect(battle.summonState).toBe('noKills')

    // Place Lion adjacent to Centaur and kill Centaur (first blood)
    const lion = battle.units.find(
      (u) => u.legionId === battle.attackerLegionId && u.creatureType === 'Lion',
    )!
    const centaur = battle.units.find(
      (u) => u.legionId === battle.defenderLegionId && u.creatureType === 'Centaur',
    )!
    const ogre = battle.units.find(
      (u) => u.legionId === battle.defenderLegionId && u.creatureType === 'Ogre',
    )!
    const atkHex = battle.attackerEntrances[0]!
    const defHex = battle.defenderEntrances[0]!
    lion.hex = atkHex
    centaur.hex = defHex
    // Force kill: Centaur power 3 — one more hit finishes it
    centaur.hits = 2
    battle.phase = 'Strike'
    battle.activeHalf = 'attacker'
    battle.activePlayerId = alice.id
    resolveStrike(state, battle, lion.id, centaur.id, () => 0.01, [6, 6])
    expect(battle.summonState).toBe('firstBlood')
    expect(battle.pendingSummon).toBe(true)

    // Skip summon → tooLate
    battle.phase = 'Summon'
    battle.activeHalf = 'attacker'
    battle.activePlayerId = alice.id
    let next = dispatch(state, { type: 'battleSkipSummon' })
    expect(next.battle!.summonState).toBe('tooLate')
    expect(next.battle!.pendingSummon).toBe(false)

    // Later kill must not reopen
    const lion2 = next.battle!.units.find((u) => u.id === lion.id)!
    const ogre2 = next.battle!.units.find((u) => u.id === ogre.id)!
    ogre2.hex = defHex
    ogre2.hits = 5
    next.battle!.phase = 'Strike'
    next.battle!.activeHalf = 'attacker'
    next.battle!.activePlayerId = alice.id
    resolveStrike(next, next.battle!, lion2.id, ogre2.id, () => 0.01, [6, 6])
    expect(next.battle!.summonState).toBe('tooLate')
    expect(next.battle!.pendingSummon).toBe(false)
    expect(listBattleSummonSources(next, next.battle!)).toEqual([])

    // Advancing from defender Strikeback must not enter Summon again
    next.battle!.phase = 'Strikeback'
    next.battle!.activeHalf = 'defender'
    next.battle!.activePlayerId = bob.id
    next.battle!.pendingSummon = true // stale flag must not matter
    for (const u of next.battle!.units) {
      u.struck = true
    }
    next.battle!.firstManeuverDone = { attacker: true, defender: true }
    advanceBattlePhase(next, next.battle!)
    expect(next.battle!.phase).not.toBe('Summon')
    expect(next.battle!.summonState).toBe('tooLate')
  })
})
