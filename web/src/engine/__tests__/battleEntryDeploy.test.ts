import { describe, expect, it } from 'vitest'
import { startBattle, legalBattleMovesFor } from '../battle'
import { twoPlayerGame } from './helpers'
import type { BattleState, BattleUnit, Legion } from '../types'
import {
  deploymentPlacementBonus,
  evaluateBattleHex,
  pickBestBattleMove,
} from '../../ai/evaluateBattle'
import { AI_PROFILES } from '../../ai/profiles'

function hexOfTerrain(state: ReturnType<typeof twoPlayerGame>, terrain: string): string {
  const hex = Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === terrain)
  if (!hex) throw new Error(`No ${terrain} hex`)
  return hex.label
}

function stubLegion(partial: Partial<Legion> & Pick<Legion, 'playerId' | 'creatures'>): Legion {
  return {
    id: 'test-leg',
    markerId: 'Rd01',
    hexLabel: '100',
    moved: false,
    teleported: false,
    recruited: false,
    musteredThisTurn: null,
    splitThisTurn: false,
    enteredFrom: 'Bottom',
    knownPublic: partial.creatures.map((c) => c.type),
    ...partial,
  }
}

describe('battle entry movement', () => {
  it('off-board skill-2 creature can enter inland past the landing hex', () => {
    const g = twoPlayerGame(11)
    const plains = hexOfTerrain(g, 'Plains')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0]!.id,
      markerId: 'Rd01',
      hexLabel: plains,
      enteredFrom: 'Bottom',
      creatures: [{ type: 'Cyclops', hits: 0 }],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1]!.id,
      markerId: 'Bu01',
      hexLabel: plains,
      enteredFrom: null,
      creatures: [{ type: 'Ogre', hits: 0 }],
    })
    g.legions = [atk, def]
    const battle = startBattle(g, atk, def, () => 0.5)
    g.battle = battle
    const cyclops = battle.units.find((u) => u.creatureType === 'Cyclops')!
    expect(cyclops.hex).toBeNull()

    const moves = legalBattleMovesFor(g, battle, cyclops)
    const entrances = new Set(battle.attackerEntrances)
    expect(moves.some((h) => entrances.has(h))).toBe(true)
    // Must reach beyond the 4 Bottom landings (A1/B1/C1/D1)
    expect(moves.some((h) => !entrances.has(h))).toBe(true)
  })

  it('occupied entrance blocks that landing but inland via other entrances remains', () => {
    const g = twoPlayerGame(12)
    const plains = hexOfTerrain(g, 'Plains')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0]!.id,
      markerId: 'Rd01',
      hexLabel: plains,
      enteredFrom: 'Bottom',
      creatures: [
        { type: 'Cyclops', hits: 0 },
        { type: 'Cyclops', hits: 0 },
      ],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1]!.id,
      markerId: 'Bu01',
      hexLabel: plains,
      enteredFrom: null,
      creatures: [{ type: 'Ogre', hits: 0 }],
    })
    g.legions = [atk, def]
    const battle = startBattle(g, atk, def, () => 0.5)
    g.battle = battle
    const [first, second] = battle.units.filter((u) => u.legionId === atk.id)
    first!.hex = battle.attackerEntrances[0]!
    first!.moved = true
    const moves = legalBattleMovesFor(g, battle, second!)
    expect(moves).not.toContain(first!.hex)
    expect(moves.length).toBeGreaterThan(0)
  })
})

describe('first-maneuver deployment AI', () => {
  function fatLegionBattle(): {
    g: ReturnType<typeof twoPlayerGame>
    battle: BattleState
    atkUnits: BattleUnit[]
  } {
    const g = twoPlayerGame(13)
    const plains = hexOfTerrain(g, 'Plains')
    // 7 attackers vs 1 defender — classic clog if they only sit on 4 entrances
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0]!.id,
      markerId: 'Rd01',
      hexLabel: plains,
      enteredFrom: 'Bottom',
      creatures: [
        { type: 'Cyclops', hits: 0 },
        { type: 'Cyclops', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Lion', hits: 0 },
        { type: 'Ogre', hits: 0 },
        { type: 'Ogre', hits: 0 },
        { type: 'Gargoyle', hits: 0 },
      ],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1]!.id,
      markerId: 'Bu01',
      hexLabel: plains,
      enteredFrom: null,
      creatures: [{ type: 'Ogre', hits: 0 }],
    })
    g.legions = [atk, def]
    const battle = startBattle(g, atk, def, () => 0.5)
    // Attacker move phase (defender already done / tower skip not needed — force attacker)
    battle.activeHalf = 'attacker'
    battle.activePlayerId = atk.playerId
    battle.phase = 'Move'
    battle.firstManeuverDone = { attacker: false, defender: true }
    g.battle = battle
    return {
      g,
      battle,
      atkUnits: battle.units.filter((u) => u.legionId === atk.id),
    }
  }

  it('prefers inland entry over clogging an entrance when allies wait', () => {
    const { g, battle, atkUnits } = fatLegionBattle()
    const unit = atkUnits[0]!
    const entrance = battle.attackerEntrances[0]!
    const inlandMoves = legalBattleMovesFor(g, battle, unit).filter(
      (h) => !battle.attackerEntrances.includes(h),
    )
    expect(inlandMoves.length).toBeGreaterThan(0)
    const inland = inlandMoves[0]!
    const profile = AI_PROFILES.balanced
    const onDoor = deploymentPlacementBonus(g, battle, unit, entrance)
    const clearDoor = deploymentPlacementBonus(g, battle, unit, inland)
    expect(clearDoor).toBeGreaterThan(onDoor)
    expect(evaluateBattleHex(g, battle, unit, inland, profile)).toBeGreaterThan(
      evaluateBattleHex(g, battle, unit, entrance, profile),
    )
  })

  it('deploys all seven attackers on first maneuver without ending early', () => {
    const { g, battle, atkUnits } = fatLegionBattle()
    const profile = AI_PROFILES.balanced
    let guard = 0
    while (atkUnits.some((u) => u.hex == null && !u.moved)) {
      const cmd = pickBestBattleMove(g, battle, profile, () => 0)
      expect(cmd.type).toBe('battleMove')
      if (cmd.type !== 'battleMove') break
      const u = battle.units.find((x) => x.id === cmd.unitId)!
      expect(u.hex).toBeNull()
      u.hex = cmd.toHex
      u.moved = true
      guard += 1
      expect(guard).toBeLessThanOrEqual(7)
    }
    expect(atkUnits.every((u) => u.hex != null)).toBe(true)
  })

  it('does not race a Titan into enemy reach just to go inland', () => {
    const g = twoPlayerGame(14)
    const plains = hexOfTerrain(g, 'Plains')
    const atk = stubLegion({
      id: 'atk',
      playerId: g.players[0]!.id,
      markerId: 'Rd01',
      hexLabel: plains,
      enteredFrom: 'Bottom',
      creatures: [
        { type: 'Titan', hits: 0 },
        { type: 'Ogre', hits: 0 },
      ],
    })
    const def = stubLegion({
      id: 'def',
      playerId: g.players[1]!.id,
      markerId: 'Bu01',
      hexLabel: plains,
      enteredFrom: null,
      creatures: [
        { type: 'Cyclops', hits: 0 },
        { type: 'Cyclops', hits: 0 },
        { type: 'Cyclops', hits: 0 },
      ],
    })
    g.legions = [atk, def]
    g.players[0]!.titanPower = 6
    const battle = startBattle(g, atk, def, () => 0.5)
    battle.activeHalf = 'attacker'
    battle.activePlayerId = atk.playerId
    battle.phase = 'Move'
    battle.firstManeuverDone = { attacker: false, defender: true }
    g.battle = battle

    // Defender already formed mid-board
    const foes = battle.units.filter((u) => u.legionId === def.id)
    foes[0]!.hex = 'C3'
    foes[1]!.hex = 'D3'
    foes[2]!.hex = 'D4'
    for (const f of foes) f.moved = true

    const titan = battle.units.find((u) => u.creatureType === 'Titan')!
    const moves = legalBattleMovesFor(g, battle, titan)
    expect(moves.length).toBeGreaterThan(1)

    const profile = AI_PROFILES.balanced
    const scored = moves.map((h) => ({
      h,
      score: evaluateBattleHex(g, battle, titan, h, profile),
    }))
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]!.h

    // Best entry must not sit on / next to the enemy cluster
    expect(['C3', 'D3', 'D4', 'C4', 'B3', 'D2', 'E3']).not.toContain(best)
    // And must beat a deliberately hot hex if that hex is legal
    const hot = moves.find((h) => h === 'C3' || h === 'D2' || h === 'C2')
    if (hot) {
      expect(evaluateBattleHex(g, battle, titan, best, profile)).toBeGreaterThan(
        evaluateBattleHex(g, battle, titan, hot, profile),
      )
    }
  })
})
