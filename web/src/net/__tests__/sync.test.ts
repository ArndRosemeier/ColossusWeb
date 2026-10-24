/**
 * The transport-free rules of online play: turn authority, adoption, the ONE
 * commit path, and the opening board every client builds.
 */
import { describe, expect, it } from 'vitest'
import { createGame, getMovesForSelected } from '../../engine/GameEngine'
import { loadDefaultVariant, twoPlayerGame } from '../../engine/__tests__/helpers'
import type { GameCommand, GameState } from '../../engine/types'
import { serializeGame } from '../../persistence/saveGame'
import { newToken } from '../identity'
import { createWorld, hostHandle } from '../room'
import {
  actingPlayerIds,
  adopt,
  assertHumanSeats,
  createCommitPath,
  isMyTurn,
  multiplayerSeatOptions,
  type MoveSink,
} from '../sync'

const variant = loadDefaultVariant()

describe('turn authority is the state, not a claim', () => {
  it('enables only the active seat, and follows a battle, a throw, a reinforcement and an engagement', () => {
    const state = twoPlayerGame(1)
    const [first, second] = state.players
    expect(actingPlayerIds(state)).toEqual([first!.id])
    expect(isMyTurn(state, second!.id)).toBe(false)

    const throwing = { ...state, pendingDice: { playerId: second!.id } } as unknown as GameState
    expect(actingPlayerIds(throwing)).toEqual([second!.id])

    const battling = { ...state, battle: { done: false, activePlayerId: second!.id } } as unknown as GameState
    expect(actingPlayerIds(battling)).toEqual([second!.id])

    const defenderLegion = state.legions.find((l) => l.playerId === second!.id)!
    const reinforcing = {
      ...state,
      pendingPostBattleReinforce: { legionId: defenderLegion.id },
    } as unknown as GameState
    expect(actingPlayerIds(reinforcing)).toEqual([second!.id])

    const attackerLegion = state.legions.find((l) => l.playerId === first!.id)!
    const engagement = {
      ...state,
      phase: 'Fight',
      activeEngagement: { attackerId: attackerLegion.id, defenderId: defenderLegion.id },
    } as unknown as GameState
    expect(actingPlayerIds(engagement).sort()).toEqual([first!.id, second!.id].sort())
  })
})

describe('adoption keeps the local UI, and recomputes what is derived', () => {
  it('the inspected legion survives; its reachable set is recomputed; a vanished one is cleared', () => {
    const remote = twoPlayerGame(3)
    const local = twoPlayerGame(3)
    const inspected = remote.legions[0]!.id
    local.selectedLegionId = inspected
    local.legalHexes = ['0101', '0202']

    const adopted = adopt(serializeGame(remote), local, variant)
    expect(adopted.selectedLegionId).toBe(inspected)
    expect(adopted.legalHexes).toEqual([...getMovesForSelected(adopted).keys()])
    expect(adopted.legalHexes).not.toEqual(['0101', '0202'])

    local.selectedLegionId = 'gone'
    expect(adopt(serializeGame(remote), local, variant).selectedLegionId).toBeNull()
  })
})

describe('the ONE commit path', () => {
  function harness() {
    let state: GameState | null = twoPlayerGame(5)
    const sent: GameState[] = []
    const sink: MoveSink = { commit: (s) => sent.push(s) }
    let online = true
    const path = createCommitPath({
      getState: () => state,
      setState: (next) => {
        state = next
      },
      getSink: () => (online ? sink : null),
    })
    return {
      path,
      sent,
      get: () => state!,
      offline: () => {
        online = false
      },
    }
  }

  it('a shared command is sent once; a UI-only one and a pending throw are not', () => {
    const h = harness()
    const change = (s: GameState) => ({ ...s, message: 'moved' })
    h.path.local(change, { type: 'endPhase' } as GameCommand)
    expect(h.sent).toHaveLength(1)
    h.path.local((s) => ({ ...s, selectedLegionId: s.legions[0]!.id }), { type: 'selectLegion', legionId: 'x' } as GameCommand)
    h.path.local((s) => ({ ...s, message: 'refused' }), { type: 'notice', message: 'no' })
    expect(h.sent).toHaveLength(1)
    h.path.local((s) => ({ ...s, pendingDice: { playerId: s.players[0]!.id } }) as GameState)
    expect(h.sent).toHaveLength(1)
  })

  it('nothing is sent in a local game, and adoption never sends', () => {
    const h = harness()
    h.offline()
    h.path.local((s) => ({ ...s, message: 'local' }))
    h.path.remote(serializeGame(twoPlayerGame(6)), variant)
    expect(h.sent).toHaveLength(0)
  })
})

describe('the opening board', () => {
  it('every client derives the SAME board from the room, with human seats in join order', () => {
    const a = newToken()
    const world = hostHandle(
      createWorld({ displayName: 'T', variant: 'Default', maxPlayers: 3, creator: { token: a, name: 'Ann' }, conn: 1 }),
      { t: 'hello', token: newToken(), name: 'Ben', heldRev: null, gameId: null },
      2,
    ).world
    const one = createGame(variant, multiplayerSeatOptions(world))
    const two = createGame(variant, multiplayerSeatOptions(JSON.parse(JSON.stringify(world))))
    expect(one.players.map((p) => p.name)).toEqual(['Ann', 'Ben'])
    expect(one.legions.map((l) => l.hexLabel)).toEqual(two.legions.map((l) => l.hexLabel))
    expect(() => assertHumanSeats(one)).not.toThrow()
  })

  it('refuses a game of one, and an AI seat, loudly', () => {
    const world = createWorld({ displayName: 'T', variant: 'Default', maxPlayers: 2, creator: { token: newToken(), name: 'A' }, conn: 1 })
    expect(() => multiplayerSeatOptions(world)).toThrow(/at least 2/)
    const ai = twoPlayerGame(1, { players: [{ name: 'A', kind: 'human' }, { name: 'CPU', kind: 'ai' }] })
    expect(() => assertHumanSeats(ai)).toThrow(/AI seat/)
  })
})
