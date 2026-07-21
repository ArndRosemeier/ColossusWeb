/**
 * Tower vs Abyss (anti-tower) battle placement — Colossus hasStartList vs isTower.
 */
import { describe, expect, it } from 'vitest'
import { buildBattleland } from '../battleland'
import { startBattle, battleLand, legalBattleMovesFor } from '../battle'
import { listNormalMoveHexes } from '../movement'
import { createGame } from '../GameEngine'
import { loadDefaultVariant, loadNamedVariant, twoPlayerGame } from './helpers'

describe('Tower / Abyss battlelands', () => {
  it('Tower battleland: isTower + startlist (raised keep)', () => {
    const v = loadDefaultVariant()
    const land = buildBattleland(v.data.battlelands.Tower!)
    expect(land.tower).toBe(true)
    expect(land.hasStartList).toBe(true)
    expect(land.startlist).toEqual(['D4', 'C4', 'E4', 'D3', 'C3', 'E3', 'D5'])
    const center = land.hexByLabel['D4']!
    expect(center.terrain).toBe('Tower')
    expect(center.elevation).toBe(2)
  })

  it('Abyss battleland: inverted Tower — high Tower rim, Drift pit startlist, not isTower', () => {
    const v = loadNamedVariant('Abyssal6')
    const land = buildBattleland(v.data.battlelands.Abyss!)
    expect(land.tower).toBe(false)
    expect(land.hasStartList).toBe(true)
    expect(land.startlist).toEqual(['D4', 'C4', 'E4', 'D3', 'C3', 'E3', 'D5'])
    const pit = land.hexByLabel['D4']!
    expect(pit.terrain).toBe('Drift')
    expect(pit.elevation).toBe(0)
    const rim = land.hexByLabel['A3'] ?? land.labels.map((l) => land.hexByLabel[l]!).find((h) => h.terrain === 'Tower')
    expect(rim?.terrain).toBe('Tower')
    expect(rim?.elevation).toBe(2)
  })

  it('B4: Tower — attacker maneuvers first; defender pre-deployed on startlist', () => {
    const state = twoPlayerGame(1)
    const attacker = state.legions.find((l) => l.playerId === state.players[0]!.id)!
    const defender = state.legions.find((l) => l.playerId === state.players[1]!.id)!
    const tower =
      Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Tower')!.label
    attacker.hexLabel = tower
    defender.hexLabel = tower
    attacker.enteredFrom = 'Left'
    const battle = startBattle(state, attacker, defender, () => 0.5)
    expect(battle.activeHalf).toBe('attacker')
    expect(battle.firstManeuverDone.defender).toBe(true)
    expect(battle.attackerEntrances).toEqual(
      buildBattleland(state.variant.data.battlelands.Tower!).entrances.Bottom,
    )
    const defUnits = battle.units.filter((u) => u.legionId === defender.id)
    expect(defUnits.every((u) => u.hex != null && battleLand(state, battle).startlist.includes(u.hex!))).toBe(
      true,
    )
  })

  it('Abyss — defender first; off-board; turn-1 places only on Drift startlist; attacker Bottom', () => {
    const v = loadNamedVariant('Abyssal6')
    const state = createGame(v, {
      players: [
        { name: 'Alice', kind: 'human' },
        { name: 'Bob', kind: 'human' },
      ],
      seed: 2,
    })
    const attacker = state.legions.find((l) => l.playerId === state.players[0]!.id)!
    const defender = state.legions.find((l) => l.playerId === state.players[1]!.id)!
    const abyss = Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Abyss')!
    attacker.hexLabel = abyss.label
    defender.hexLabel = abyss.label
    attacker.enteredFrom = 'Right'
    const battle = startBattle(state, attacker, defender, () => 0.5)
    state.battle = battle
    const land = battleLand(state, battle)

    expect(battle.terrain).toBe('Abyss')
    expect(land.hasStartList).toBe(true)
    expect(land.tower).toBe(false)
    expect(battle.activeHalf).toBe('defender')
    expect(battle.firstManeuverDone.defender).toBe(false)
    expect(battle.attackerEntrances).toEqual(land.entrances.Bottom)

    const defUnits = battle.units.filter((u) => u.legionId === defender.id)
    expect(defUnits.every((u) => u.hex == null)).toBe(true)

    const mover = defUnits[0]!
    const legal = legalBattleMovesFor(state, battle, mover)
    expect(legal.length).toBeGreaterThan(0)
    expect(legal.every((h) => land.startlist.includes(h))).toBe(true)
    // Must not offer rim entrances as turn-1 defender destinations
    expect(legal.some((h) => land.entrances.Top.includes(h))).toBe(false)
  })

  it('master move onto Abyss forces Bottom entry side (hasStartList)', () => {
    const v = loadNamedVariant('Abyssal6')
    const state = createGame(v, {
      players: [
        { name: 'Alice', kind: 'human' },
        { name: 'Bob', kind: 'human' },
      ],
      seed: 3,
    })
    const alice = state.players[0]!
    const bob = state.players[1]!
    const attacker = state.legions.find((l) => l.playerId === alice.id)!
    const defender = state.legions.find((l) => l.playerId === bob.id)!
    const abyss = Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Abyss')!
    defender.hexLabel = abyss.label
    state.phase = 'Move'

    const neighbors = Object.values(state.variant.board.hexByLabel).filter((h) =>
      h.neighbors.some((n) => n === abyss.label),
    )
    expect(neighbors.length).toBeGreaterThan(0)

    let found: string | undefined
    for (const near of neighbors) {
      attacker.hexLabel = near.label
      for (let roll = 1; roll <= 6; roll++) {
        const moves = listNormalMoveHexes(state, attacker, roll)
        if (moves.has(abyss.label)) {
          expect(moves.get(abyss.label)).toBe('Bottom')
          found = near.label
          break
        }
      }
      if (found) break
    }
    expect(found, 'expected some adjacent hex to reach Abyss within roll 1–6').toBeTruthy()
  })
})
