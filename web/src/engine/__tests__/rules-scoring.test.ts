import { describe, expect, it } from 'vitest'
import {
  applyBattleResult,
  applyTimeLoss,
  checkTitanDeath,
  startBattle,
} from '../battle'
import { resolveAgreement } from '../engagement'
import { listAllMoves } from '../movement'
import { dispatch } from '../GameEngine'
import { twoPlayerGame, turn1SplitChild } from './helpers'
import type { BattleState, GameState } from '../types'

function plainsBattle(): { state: GameState; battle: BattleState } {
  const state = twoPlayerGame(1)
  const attacker = state.legions.find((l) => l.playerId === state.players[0].id)!
  const defender = state.legions.find((l) => l.playerId === state.players[1].id)!
  const plains =
    Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')
      ?.label ?? '1'
  attacker.hexLabel = plains
  defender.hexLabel = plains
  attacker.enteredFrom = 'Bottom'
  attacker.creatures = attacker.creatures.slice(0, 4)
  defender.creatures = defender.creatures.slice(0, 4)
  const battle = startBattle(state, attacker, defender, () => 0.5)
  state.battle = battle
  return { state, battle }
}

describe('rules-scoring', () => {
  it('Q5: combat win awards half Power×Skill of slain enemies', () => {
    const { state, battle } = plainsBattle()
    const attacker = state.legions.find((l) => l.id === battle.attackerLegionId)!
    const defender = state.legions.find((l) => l.id === battle.defenderLegionId)!
    const winner = state.players.find((p) => p.id === attacker.playerId)!
    const before = winner.score

    for (const u of battle.units) {
      if (u.legionId === defender.id) u.hits = 999
    }
    battle.done = true
    battle.winnerPlayerId = attacker.playerId
    applyBattleResult(state, battle)

    let expected = 0
    for (const u of battle.units) {
      if (u.legionId !== defender.id) continue
      const t = state.variant.creatures[u.creatureType]
      if (!t) continue
      const power =
        u.creatureType === 'Titan'
          ? (state.players.find((p) => p.id === u.playerId)?.titanPower ?? 6)
          : t.power
      expected += Math.floor((power * t.skill) / 2)
    }
    expect(winner.score - before).toBe(expected)
  })

  it('K4: survivors heal hits after battle', () => {
    const { state, battle } = plainsBattle()
    const attacker = state.legions.find((l) => l.id === battle.attackerLegionId)!
    const atkUnit = battle.units.find((u) => u.legionId === attacker.id)!
    atkUnit.hits = 2
    for (const u of battle.units) {
      if (u.legionId === battle.defenderLegionId) u.hits = 999
    }
    battle.done = true
    battle.winnerPlayerId = attacker.playerId
    applyBattleResult(state, battle)
    const survivors = state.legions.find((l) => l.id === attacker.id)!
    expect(survivors.creatures.every((c) => c.hits === 0)).toBe(true)
  })

  it('Q4: crossing a 100-point threshold acquires an Angel when stock and space allow', () => {
    const { state, battle } = plainsBattle()
    const attacker = state.legions.find((l) => l.id === battle.attackerLegionId)!
    const winner = state.players.find((p) => p.id === attacker.playerId)!
    winner.score = 90
    state.caretaker.Angel = Math.max(state.caretaker.Angel ?? 0, 3)
    // Ensure room for an angel
    attacker.creatures = attacker.creatures.slice(0, 3)
    // Re-sync battle units height for attacker survivors
    battle.units = battle.units.filter(
      (u) => u.legionId !== attacker.id || attacker.creatures.some((c) => c.type === u.creatureType),
    )

    for (const u of battle.units) {
      if (u.legionId === battle.defenderLegionId) u.hits = 999
    }
    battle.done = true
    battle.winnerPlayerId = attacker.playerId
    const angelsBefore = 0
    applyBattleResult(state, battle)
    const after = state.legions.find((l) => l.id === attacker.id)!
    expect(winner.score).toBeGreaterThanOrEqual(100)
    expect(after.creatures.filter((c) => c.type === 'Angel').length).toBeGreaterThan(
      angelsBefore,
    )
  })

  it('Q4: when crossing 500, Archangel is preferred if available', () => {
    const { state, battle } = plainsBattle()
    const attacker = state.legions.find((l) => l.id === battle.attackerLegionId)!
    const winner = state.players.find((p) => p.id === attacker.playerId)!
    winner.score = 490
    state.caretaker.Archangel = Math.max(state.caretaker.Archangel ?? 0, 1)
    state.caretaker.Angel = Math.max(state.caretaker.Angel ?? 0, 1)
    attacker.creatures = attacker.creatures.slice(0, 3)
    for (const u of battle.units) {
      if (u.legionId === battle.defenderLegionId) u.hits = 999
    }
    battle.done = true
    battle.winnerPlayerId = attacker.playerId
    applyBattleResult(state, battle)
    expect(winner.score).toBeGreaterThanOrEqual(500)
    const after = state.legions.find((l) => l.id === attacker.id)!
    expect(after.creatures.some((c) => c.type === 'Archangel')).toBe(true)
  })

  it('Q6: titanPower = 6 + floor(score/100) at end of turn', () => {
    let g = twoPlayerGame(4)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
    const dest = [...listAllMoves(g, mover, g.movementRoll!).keys()][0]
    g = dispatch(g, { type: 'move', legionId: mover.id, toHex: dest })
    g = dispatch(g, { type: 'doneMove' })
    g.players[0].score = 250
    g = dispatch(g, { type: 'doneMuster' })
    const alice = g.players.find((p) => p.name === 'Alice')!
    expect(alice.titanPower).toBe(6 + Math.floor(250 / 100))
  })

  it('S3/S4: losing Titan eliminates player; last Titan wins', () => {
    const state = twoPlayerGame(1)
    const alice = state.players[0]
    const bob = state.players[1]
    const attacker = state.legions.find((l) => l.playerId === alice.id)!
    const defender = state.legions.find((l) => l.playerId === bob.id)!
    attacker.hexLabel = defender.hexLabel
    const battle = startBattle(state, attacker, defender, () => 0.5)
    applyTimeLoss(state, battle)
    applyBattleResult(state, battle)
    expect(alice.dead).toBe(true)
    expect(state.winnerId).toBe(bob.id)
  })

  it('mutual Titan death ends as draw (Colossus checkForVictory case 0)', () => {
    const state = twoPlayerGame(2)
    const alice = state.players[0]
    const bob = state.players[1]
    // Strip both down to Titan-only stacks on the same hex, then mutual wipe
    for (const leg of state.legions) {
      leg.creatures = [{ type: 'Titan', hits: 0 }]
    }
    const a = state.legions.find((l) => l.playerId === alice.id)!
    const d = state.legions.find((l) => l.playerId === bob.id)!
    a.hexLabel = d.hexLabel
    resolveAgreement(state, a, d, 'mutual')
    checkTitanDeath(state, null)
    expect(alice.dead).toBe(true)
    expect(bob.dead).toBe(true)
    expect(state.draw).toBe(true)
    expect(state.winnerId).toBeNull()
  })

  it('B7: time-loss awards no points', () => {
    const { state, battle } = plainsBattle()
    const def = state.players.find(
      (p) =>
        p.id ===
        state.legions.find((l) => l.id === battle.defenderLegionId)!.playerId,
    )!
    const before = def.score
    applyTimeLoss(state, battle)
    applyBattleResult(state, battle)
    expect(def.score).toBe(before)
  })
})
