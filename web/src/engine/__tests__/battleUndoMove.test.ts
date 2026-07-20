import { describe, expect, it } from 'vitest'
import { prepareBattleManeuver, startBattle } from '../battle'
import { dispatch } from '../GameEngine'
import { twoPlayerGame } from './helpers'

function battleReady() {
  const state = twoPlayerGame(21)
  const attacker = state.legions.find((l) => l.playerId === state.players[0].id)!
  const defender = state.legions.find((l) => l.playerId === state.players[1].id)!
  const hex =
    Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')?.label ??
    attacker.hexLabel
  attacker.hexLabel = hex
  defender.hexLabel = hex
  attacker.enteredFrom = 'Bottom'
  const battle = startBattle(state, attacker, defender, () => 0.5)
  state.battle = battle
  // Defender first Move on Plains
  prepareBattleManeuver(battle)
  return { state, battle }
}

describe('battle move undo', () => {
  it('undo last restores unit to its maneuver-start hex (including off-board)', () => {
    let { state, battle } = battleReady()
    const unit = battle.units.find((u) => u.playerId === battle.activePlayerId)!
    expect(unit.hex).toBeNull()
    const entry = battle.defenderEntrances[0]!

    state = dispatch(state, { type: 'battleSelectUnit', unitId: unit.id })
    state = dispatch(state, { type: 'battleMove', unitId: unit.id, toHex: entry })
    expect(state.battle!.units.find((u) => u.id === unit.id)!.hex).toBe(entry)
    expect(state.battle!.units.find((u) => u.id === unit.id)!.moved).toBe(true)
    expect(state.battle!.moveStack).toEqual([unit.id])

    state = dispatch(state, { type: 'battleUndoLastMove' })
    const after = state.battle!.units.find((u) => u.id === unit.id)!
    expect(after.hex).toBeNull()
    expect(after.moved).toBe(false)
    expect(state.battle!.moveStack).toEqual([])
  })

  it('undo all restores every moved unit this phase', () => {
    let { state, battle } = battleReady()
    const mine = battle.units.filter((u) => u.playerId === battle.activePlayerId)
    const a = mine[0]!
    const b = mine[1]!
    const e0 = battle.defenderEntrances[0]!
    const e1 = battle.defenderEntrances[1] ?? e0

    state = dispatch(state, { type: 'battleMove', unitId: a.id, toHex: e0 })
    // Second unit may need a different hex if e0 occupied
    const destB =
      state.battle!.units.find((u) => u.id === b.id) &&
      (e1 !== e0 ? e1 : battle.defenderEntrances.find((h) => h !== e0) ?? e0)
    state = dispatch(state, { type: 'battleMove', unitId: b.id, toHex: destB! })
    expect(state.battle!.moveStack.length).toBe(2)

    state = dispatch(state, { type: 'battleUndoAllMoves' })
    expect(state.battle!.moveStack).toEqual([])
    expect(state.battle!.units.find((u) => u.id === a.id)!.hex).toBeNull()
    expect(state.battle!.units.find((u) => u.id === b.id)!.hex).toBeNull()
    expect(state.battle!.units.find((u) => u.id === a.id)!.moved).toBe(false)
    expect(state.battle!.units.find((u) => u.id === b.id)!.moved).toBe(false)
  })
})
