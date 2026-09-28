/**
 * The turn-sync pins, driven against the **in-memory twin** from S1 — never the
 * live service.
 *
 * Each `it` is a statement from the S3 brief, checked through the real modules:
 * publish/fetch/adopt over a real `MemoryTransport`, the one commit path, the
 * turn-authority predicate, and the poll loop with an injected visibility source
 * and fake timers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGame, dispatch, getMovesForSelected } from '../../engine/GameEngine'
import { loadDefaultVariant, turn1SplitChild, twoPlayerGame } from '../../engine/__tests__/helpers'
import type { GameCommand, GameState } from '../../engine/types'
import { forgetKey, installKey } from '../keyStore'
import { createMemoryTransport } from '../memoryTransport'
import {
  GAME_RECORD_VERSION,
  PLAYER_RECORD_VERSION,
  gameObjectName,
  parseGameRecord,
  playerObjectName,
  playerTagFor,
  serializeGameRecord,
  serializePlayerRecord,
  type GameRecord,
  type PlayerRecord,
} from '../gameRecord'
import { SAVE_VERSION, deserializeGame, serializeGame } from '../../persistence/saveGame'
import {
  SNAPSHOT_SCHEMA_VERSION,
  serializeSnapshot,
  snapshotObjectName,
  snapshotObjectPrefixFor,
  type SnapshotBody,
} from '../snapshot'
import {
  actingPlayerIds,
  adopt,
  assertHumanSeats,
  createCommitPath,
  createSyncSession,
  fetchLatest,
  gameSeedFor,
  isMyTurn,
  isSharedCommand,
  multiplayerSeatOptions,
  pollLatest,
  publishSnapshot,
  type VisibilitySource,
} from '../sync'
import type { ServerStoreTransport, StoreIdentity } from '../transport'
import { TEST_KEY, TEST_STORE } from './transportHarness'

const CREATOR: StoreIdentity = {
  id: 'key_5e1a1d3f',
  label: 'tom',
  stores: ['colossus'],
  perms: ['read', 'write'],
}
/** First 8 lowercased chars are `aaaabbbb` — sorts BEFORE the creator's tag. */
const JOINER: StoreIdentity = {
  id: 'AAAAbbbb1111',
  label: 'bob',
  stores: ['colossus'],
  perms: ['read', 'write'],
}
const STRANGER: StoreIdentity = {
  id: 'ZZZZ9999watching',
  label: 'caspar',
  stores: ['colossus'],
  perms: ['read'],
}

const GAME = 'twin-1234abcd'

async function seededGame(transport: ServerStoreTransport): Promise<{
  record: GameRecord
  players: PlayerRecord[]
}> {
  const players: PlayerRecord[] = [
    {
      version: PLAYER_RECORD_VERSION,
      gameId: GAME,
      playerId: CREATOR.id,
      label: CREATOR.label,
      joinedAt: '2026-09-28T10:01:00.000Z',
    },
    {
      version: PLAYER_RECORD_VERSION,
      gameId: GAME,
      playerId: JOINER.id,
      label: JOINER.label,
      joinedAt: '2026-09-28T10:02:00.000Z',
    },
  ]
  const record: GameRecord = {
    version: GAME_RECORD_VERSION,
    gameId: GAME,
    displayName: 'Twin Game',
    variant: 'Default',
    creator: { id: CREATOR.id, label: CREATOR.label },
    status: 'started',
    maxPlayers: 6,
    // Creator first, then the joiner — the order every client derives.
    seatOrder: [CREATOR.id, JOINER.id],
    createdAt: '2026-09-28T10:00:00.000Z',
  }
  await transport.put(TEST_STORE, gameObjectName(GAME), serializeGameRecord(record))
  for (const player of players) {
    await transport.put(
      TEST_STORE,
      playerObjectName(GAME, playerTagFor(player.playerId)),
      serializePlayerRecord(player),
    )
  }
  return { record, players }
}

/** A real engine state with one turn-1 split applied — a moved game, not a fresh one. */
function splitOnce(): GameState {
  const state = twoPlayerGame(1)
  const parent = state.legions.find((legion) => legion.playerId === state.players[0]!.id)!
  const childCreatures = turn1SplitChild(state, parent)
  return dispatch(state, { type: 'split', parentId: parent.id, childCreatures })
}

/**
 * A real Move-phase state built through the engine (`split` → `doneSplit`),
 * with the roll forced, so a pin can compare two DIFFERENT rolls on the same
 * board. `seed` picks which board.
 */
function draftState(roll: number, seed = 1): GameState {
  let state = twoPlayerGame(seed)
  const parent = state.legions.find((legion) => legion.playerId === state.players[0]!.id)!
  state = dispatch(state, {
    type: 'split',
    parentId: parent.id,
    childCreatures: turn1SplitChild(state, parent),
  })
  state = dispatch(state, { type: 'doneSplit' }, () => 0.5)
  return withMovementRoll(state, roll)
}

/** The same state with a different movement roll — the ONLY thing that changes. */
function withMovementRoll(state: GameState, roll: number): GameState {
  const next = structuredClone(state)
  next.movementRoll = roll
  return next
}

/**
 * The engine's OWN answer to "where may this legion go" for a state — the
 * oracle every adoption pin compares against, so the pins can never encode a
 * second implementation of the movement rule.
 */
function engineDestinations(state: GameState, legionId: string): string[] {
  return [...getMovesForSelected(dispatch(state, { type: 'selectLegion', legionId })).keys()]
}

/** Deep-copy without `variant`, with the per-client dice ids neutralised and the
 * LOCAL UI fields (selection/legal hexes) zeroed — they are deliberately kept
 * from the local state on adoption, so they are not part of "the game state". */
function normalise(state: GameState): Record<string, unknown> {
  const { variant: _variant, ...rest } = state
  const clone = structuredClone(rest) as Record<string, unknown>
  clone['diceRoll'] = null
  clone['pendingDice'] = null
  clone['selectedLegionId'] = null
  clone['legalHexes'] = []
  return clone
}

/** The `code` a thrown ServerStoreError carries. */
function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return (error as { code?: string }).code ?? ''
  }
  return '<no error>'
}

function names(objects: Array<{ name: string }>): string[] {
  return objects.map((object) => object.name).sort()
}

function withCallLog(base: ServerStoreTransport): {
  transport: ServerStoreTransport
  calls: string[]
} {
  const calls: string[] = []
  const wrapped = new Proxy(base, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') return value
      if (property === 'list' || property === 'get' || property === 'put' || property === 'remove') {
        return (...args: unknown[]) => {
          calls.push(`${String(property)} ${String(args[1] ?? args[0])}`)
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      return (value as (...a: unknown[]) => unknown).bind(target)
    },
  })
  return { transport: wrapped as ServerStoreTransport, calls }
}

class FakeVisibility implements VisibilitySource {
  private flag = true
  private readonly listeners = new Set<() => void>()

  visible(): boolean {
    return this.flag
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(visible: boolean): void {
    this.flag = visible
    for (const listener of [...this.listeners]) listener()
  }
}

afterEach(() => {
  forgetKey()
  vi.useRealTimers()
})

describe('publish → fetch → adopt', () => {
  it('a published snapshot round-trips: the state deserialises to an equal state', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const variant = loadDefaultVariant()
    const state = splitOnce()

    const published = await publishSnapshot(arm, CREATOR, record, state, { store: TEST_STORE })
    expect(published.body.header.turn).toBe(state.turnNumber)
    expect(published.body.header.seq).toBe(0)
    expect(published.body.header.parent).toBeNull()
    expect(published.body.header.seat).toBe(0)
    expect(published.body.header.writerTag).toBe('key_5e1a')

    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE })
    expect(latest).not.toBeNull()
    expect(latest!.body.header.name).toBe(published.name)
    expect(latest!.fork).toBeNull()

    const adopted = adopt(latest!.body, null, variant)
    expect(adopted.variant.data.name).toBe('Default')
    expect(normalise(adopted)).toEqual(normalise(state))
  })

  it('a local command publishes exactly ONE snapshot named for its turn/seq; UI-only commands publish none', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const session = createSyncSession({
      transport: arm,
      identity: CREATOR,
      record,
      store: TEST_STORE,
    })
    let current: GameState | null = twoPlayerGame(1)
    const path = createCommitPath({
      getState: () => current,
      setState: (next) => {
        current = next
      },
      getSession: () => session,
    })

    // The Start hand-off publishes the opening snapshot itself.
    path.publishCurrent()
    await path.settled()
    expect(names(await arm.list(TEST_STORE, snapshotObjectPrefixFor(GAME))).filter((name) => name.includes('.'))).toHaveLength(1)

    const state = current!
    const parent = state.legions.find((legion) => legion.playerId === state.players[0]!.id)!
    const split = {
      type: 'split' as const,
      parentId: parent.id,
      childCreatures: turn1SplitChild(state, parent),
    }
    path.local((prev) => dispatch(prev, split), split)
    await path.settled()
    const afterSplit = names(await arm.list(TEST_STORE, snapshotObjectPrefixFor(GAME))).filter((name) => name.includes('.'))
    expect(afterSplit).toHaveLength(2)
    // The prefix already scopes these to GAME; what is asserted is the ORDER
    // (the padded turn/seq the rename must not touch).
    expect(afterSplit[0]).toMatch(/\.0001\.000\.key_5e1a$/)
    expect(afterSplit[1]).toMatch(/\.0001\.001\.key_5e1a$/)

    // Selection is a UI-only command: the one commit path still changes state,
    // but it must NOT publish.
    const select = {
      type: 'selectLegion' as const,
      legionId: current!.legions[0]!.id,
    }
    const next = path.local((prev) => dispatch(prev, select), select)
    expect(next).not.toBeNull()
    await path.settled()
    expect(names(await arm.list(TEST_STORE, snapshotObjectPrefixFor(GAME))).filter((name) => name.includes('.'))).toHaveLength(2)
  })

  it('a state with a pending throw is NOT published until the throw is committed', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const session = createSyncSession({
      transport: arm,
      identity: CREATOR,
      record,
      store: TEST_STORE,
    })
    let current: GameState | null = { ...twoPlayerGame(1), pendingDice: { playerId: 'p0' } as never }
    const path = createCommitPath({
      getState: () => current,
      setState: (next) => {
        current = next
      },
      getSession: () => session,
    })
    path.local((prev) => ({ ...prev, message: 'throw' }))
    await path.settled()
    expect(names(await arm.list(TEST_STORE, snapshotObjectPrefixFor(GAME))).filter((name) => name.includes('.'))).toHaveLength(0)
  })

  it('refuses to publish for a caller who is not seated', async () => {
    const arm = createMemoryTransport({ identity: STRANGER })
    const { record } = await seededGame(arm)
    await expect(
      publishSnapshot(arm, STRANGER, record, twoPlayerGame(1), { store: TEST_STORE }),
    ).rejects.toMatchObject({ code: 'not_seated' })
  })

  it('a refusal notice reaches the ONE message surface and publishes NOTHING', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const session = createSyncSession({
      transport: arm,
      identity: CREATOR,
      record,
      store: TEST_STORE,
    })
    let current: GameState | null = twoPlayerGame(1)
    const path = createCommitPath({
      getState: () => current,
      setState: (next) => {
        current = next
      },
      getSession: () => session,
    })
    path.publishCurrent()
    await path.settled()
    const namesOf = async () =>
      names(await arm.list(TEST_STORE, snapshotObjectPrefixFor(GAME))).filter((name) =>
        name.includes('.'),
      )
    const before = await namesOf()
    expect(before).toHaveLength(1)

    // A refused board click (the owner's trap, ledger row 13) carries its
    // sentence through the ONE commit path and changes NO shared state.
    const notice: GameCommand = {
      type: 'notice',
      message: "Bu02 is Bob's legion — its fields are only a movement preview.",
    }
    expect(isSharedCommand(notice)).toBe(false)
    const next = path.local((prev) => dispatch(prev, notice), notice)
    expect(next).not.toBeNull()
    expect(next!.message).toBe(notice.message)
    // Nothing else changed — a notice cannot deselect the inspected legion.
    expect(next!.selectedLegionId).toBe(current!.selectedLegionId)
    expect(next!.legions).toEqual(current!.legions)
    await path.settled()
    expect(await namesOf()).toHaveLength(before.length)
  })
})

describe('adoption keeps the local UI and follows the chain', () => {
  it('a remote snapshot is adopted and the local UI-only fields survive', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const variant = loadDefaultVariant()
    const remoteState = splitOnce()
    const published = await publishSnapshot(arm, CREATOR, record, remoteState, {
      store: TEST_STORE,
    })
    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE })

    const local = twoPlayerGame(1)
    const inspected = remoteState.legions[0]!.id
    local.selectedLegionId = inspected
    local.legalHexes = ['0101', '0202']

    const adopted = adopt(latest!.body, local, variant)
    expect(adopted.selectedLegionId).toBe(inspected)
    // `legalHexes` is NOT a local UI field: it is DERIVED from the adopted state
    // and its own roll, so the local chips never survive.
    expect(adopted.legalHexes).not.toEqual(['0101', '0202'])
    expect(adopted.legalHexes).toEqual(
      [...getMovesForSelected({ ...adopted, selectedLegionId: inspected }).keys()],
    )
    // ...and what the LOCAL player had in their own hand is replaced by the
    // shared truth.
    expect(adopted.legions).toHaveLength(remoteState.legions.length)
    expect(adopted.turnNumber).toBe(remoteState.turnNumber)

    // A selection that no longer exists is dropped, not kept dangling.
    local.selectedLegionId = 'gone-forever'
    const reset = adopt(latest!.body, local, variant)
    expect(reset.selectedLegionId).toBeNull()
    expect(reset.legalHexes).toEqual([])
    expect(published.name).toBe(latest!.body.header.name)
  })

  it('adopting a state whose roll CHANGED shows the ADOPTED roll, not the previous one', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const variant = loadDefaultVariant()
    const published = await publishSnapshot(arm, CREATOR, record, draftState(3), {
      store: TEST_STORE,
    })
    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE })
    // The ADOPTED state as this client will see it (its ids are the deserialiser's).
    const remoteState = deserializeGame(latest!.body.state, variant)
    const inspected = remoteState.legions.find(
      (legion) => legion.playerId === remoteState.players[0]!.id,
    )!.id

    // The LOCAL client holds roll 6, this stack selected, and the set computed
    // for it.
    const local = withMovementRoll(remoteState, 6)
    local.selectedLegionId = inspected
    const onLocalRoll = engineDestinations(local, inspected)
    expect(onLocalRoll.length).toBeGreaterThan(0)

    // The ADOPTED state carries a DIFFERENT roll.
    const onAdoptedRoll = engineDestinations(remoteState, inspected)
    expect(onAdoptedRoll).not.toEqual(onLocalRoll)

    const adopted = adopt(latest!.body, local, variant)
    expect(adopted.movementRoll).toBe(remoteState.movementRoll)
    expect(adopted.legalHexes).toEqual(onAdoptedRoll)
    expect(adopted.legalHexes).not.toEqual(onLocalRoll)
    // The nicety that IS worth keeping: the inspected legion survives.
    expect(adopted.selectedLegionId).toBe(inspected)
    expect(published.name).toBe(latest!.body.header.name)
  })

  it('adopting a state where the inspected legion MOVED recomputes for its new position', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const variant = loadDefaultVariant()

    // The legion's position at the START of the turn and the destination a legal
    // move took it to — both from the ENGINE.
    const before = draftState(6)
    const inspected = before.legions.find(
      (legion) => legion.playerId === before.players[0]!.id,
    )!.id
    const originHex = before.legions.find((l) => l.id === inspected)!.hexLabel
    const destination = engineDestinations(before, inspected)[0]!
    expect(destination).not.toBe(originHex)
    const moved = dispatch(before, { type: 'move', legionId: inspected, toHex: destination })
    expect(moved.legions.find((l) => l.id === inspected)!.hexLabel).toBe(destination)

    // The REMOTE state is the NEXT turn: the same legion, now standing where it
    // moved to, selectable again. This is the state the client adopts.
    const remoteTurn = structuredClone(moved)
    const legion = remoteTurn.legions.find((l) => l.id === inspected)!
    legion.moved = false
    legion.moveOriginHex = null
    remoteTurn.selectedLegionId = null
    remoteTurn.legalHexes = []
    await publishSnapshot(arm, CREATOR, record, remoteTurn, { store: TEST_STORE })
    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE })
    const adoptedState = deserializeGame(latest!.body.state, variant)
    expect(
      adoptedState.legions.find((l) => l.id === inspected)!.hexLabel,
    ).toBe(destination)

    // The LOCAL client still holds what it computed BEFORE the move: the same
    // legion, selected at its ORIGIN position, with the set for that position.
    const local = structuredClone(adoptedState)
    local.selectedLegionId = inspected
    local.legions.find((l) => l.id === inspected)!.hexLabel = originHex
    const onOrigin = engineDestinations(local, inspected)
    expect(onOrigin.length).toBeGreaterThan(0)

    const adopted = adopt(latest!.body, local, variant)
    expect(adopted.legions.find((l) => l.id === inspected)!.hexLabel).toBe(destination)
    expect(adopted.legalHexes).toEqual(engineDestinations(adopted, inspected))
    // The set that belonged to the ORIGIN position must not survive.
    expect(adopted.legalHexes).not.toEqual(onOrigin)
  })

  it('a full owner-shaped turn sequence: 6, a remote turn, then 3 — and the move is accepted', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const variant = loadDefaultVariant()
    const session = createSyncSession({
      transport: arm,
      identity: CREATOR,
      record,
      store: TEST_STORE,
    })

    // 1. The owner's first turn: roll 6, one stack selected. This is the roll the
    //    client still holds when the next snapshot arrives.
    const first = draftState(6)
    const legion = first.legions.find((l) => l.playerId === first.players[0]!.id)!
    const firstTurn = dispatch(first, { type: 'selectLegion', legionId: legion.id })
    await publishSnapshot(arm, CREATOR, record, firstTurn, { store: TEST_STORE })

    // 2. The owner's NEXT turn (after a remote turn) is a DIFFERENT roll, with
    //    the same board: this is the snapshot the client adopts. The round
    //    advances exactly as the engine advances it, so the two publishes are
    //    DISTINCT names (the name carries the round).
    const remoteTurn = withMovementRoll(first, 3)
    remoteTurn.turnNumber = firstTurn.turnNumber + 1
    await publishSnapshot(arm, CREATOR, record, remoteTurn, { store: TEST_STORE })
    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE, heldName: null })
    expect(latest!.body.header.turn).toBe(remoteTurn.turnNumber)

    // The ids the adopting client will actually hold: the deserialiser's.
    const asAdopted = deserializeGame(latest!.body.state, variant)
    const inspected = asAdopted.legions.find(
      (l) => l.playerId === asAdopted.players[0]!.id,
    )!.id
    const onThree = engineDestinations(asAdopted, inspected)
    expect(onThree.length).toBeGreaterThan(0)
    const onSix = engineDestinations(withMovementRoll(asAdopted, 6), inspected)
    expect(onSix.length).toBeGreaterThan(onThree.length)
    expect(onSix).not.toEqual(onThree)

    // 3. The client adopts it with roll 6 still in hand.
    let current: GameState | null = withMovementRoll(asAdopted, 6)
    current.selectedLegionId = inspected
    current.legalHexes = onSix
    const path = createCommitPath({
      getState: () => current,
      setState: (next) => {
        current = next
      },
      getSession: () => session,
    })
    const adopted = path.remote(latest!.body, variant)
    expect(adopted).not.toBeNull()
    expect(current!.selectedLegionId).toBe(inspected)
    expect(current!.movementRoll).toBe(3)
    expect(current!.legalHexes).toEqual(onThree)
    expect(current!.legalHexes).not.toEqual(onSix)

    // 4. ... and a move that is legal for the NEW roll is accepted. Under the
    //    defect the client held the 45-hex set from roll 6 instead of this
    //    3-hex one, so the roll-6-only destinations were the ones it offered.
    //    `dispatch` reports a refused command through `message`, so an accepted
    //    move is one that changes the legion's position.
    const destination = onThree[0]!
    const rollSixOnly = onSix.filter((hex) => !onThree.includes(hex))
    expect(rollSixOnly.length).toBeGreaterThan(0)
    expect(onThree).not.toContain(rollSixOnly[0]!)
    const after: GameState = dispatch(current!, {
      type: 'move',
      legionId: inspected,
      toHex: destination,
    })
    expect(after.legions.find((l) => l.id === inspected)!.hexLabel).toBe(destination)
    expect(after.message).not.toMatch(/illegal/i)
  })

  it('a legion that no longer exists clears the selection AND the reachable set', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const variant = loadDefaultVariant()
    await publishSnapshot(arm, CREATOR, record, splitOnce(), { store: TEST_STORE })
    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE })

    const local = twoPlayerGame(1)
    local.selectedLegionId = 'gone-forever'
    local.legalHexes = ['0101', '0202']

    const adopted = adopt(latest!.body, local, variant)
    expect(adopted.legions.some((legion) => legion.id === 'gone-forever')).toBe(false)
    expect(adopted.selectedLegionId).toBeNull()
    expect(adopted.legalHexes).toEqual([])
  })

  it('the commit path adopts a REMOTE body through the same seam, and never publishes it', async () => {
    const arm = createMemoryTransport({ identity: JOINER })
    const { record } = await seededGame(arm)
    const variant = loadDefaultVariant()
    const remoteState = splitOnce()
    const published = await publishSnapshot(arm, CREATOR, record, remoteState, {
      store: TEST_STORE,
    })
    const { transport, calls } = withCallLog(arm)
    const session = createSyncSession({
      transport,
      identity: JOINER,
      record,
      store: TEST_STORE,
    })
    let current: GameState | null = twoPlayerGame(1)
    const path = createCommitPath({
      getState: () => current,
      setState: (next) => {
        current = next
      },
      getSession: () => session,
    })
    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE })
    path.remote(latest!.body, variant)
    await path.settled()
    expect(normalise(current!)).toEqual(normalise(remoteState))
    expect(calls.filter((call) => call.startsWith('put'))).toEqual([])
    // Adopting seeds the publish cursor, so this client's next write continues
    // the chain rather than restarting it.
    expect(session.tracker.last).toBe(published.name)
    expect(session.tracker.turn).toBe(published.body.header.turn)
    expect(session.tracker.seq).toBe(published.body.header.seq)

    // The same body adopted twice is a no-op the second time.
    expect(path.remote(latest!.body, variant)).toBeNull()
  })

  it('a resume adopts the LATEST snapshot instead of starting a new game', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const variant = loadDefaultVariant()
    const session = createSyncSession({
      transport: arm,
      identity: CREATOR,
      record,
      store: TEST_STORE,
    })
    await publishSnapshot(arm, CREATOR, record, twoPlayerGame(1), {
      store: TEST_STORE,
      tracker: session.tracker,
    })
    const moved = splitOnce()
    const second = await publishSnapshot(arm, CREATOR, record, moved, {
      store: TEST_STORE,
      tracker: session.tracker,
    })
    expect(second.body.header.parent).not.toBeNull()

    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE, heldName: null })
    expect(latest!.body.header.name).toBe(second.name)
    const resumed = adopt(latest!.body, null, variant)
    expect(normalise(resumed)).toEqual(normalise(moved))
    // A fresh local game would NOT have the split.
    expect(normalise(resumed)).not.toEqual(normalise(twoPlayerGame(1)))
  })
})

describe('a race is a visible FORK, resolved deterministically', () => {
  it('two writers at the same (turn, seq) produce two names; the fork is surfaced', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const held = snapshotObjectName(GAME, 0, 0, 'zzzzzzzz')

    await publishSnapshot(arm, CREATOR, record, twoPlayerGame(1), {
      store: TEST_STORE,
      parentName: held,
    })
    await publishSnapshot(arm, JOINER, record, twoPlayerGame(1), {
      store: TEST_STORE,
      parentName: null,
    })
    const stored = names(await arm.list(TEST_STORE, snapshotObjectPrefixFor(GAME))).filter((name) => name.includes('.'))
    expect(stored).toHaveLength(2)
    expect(new Set(stored).size).toBe(2)

    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE, heldName: null })
    expect(latest!.fork).not.toBeNull()
    expect(latest!.fork!.turn).toBe(1)
    expect(latest!.fork!.seq).toBe(0)
    expect(latest!.fork!.names).toHaveLength(2)
    // Deterministic with nothing held: the LOWEST tag.
    expect(latest!.body.header.writerTag).toBe('aaaabbbb')

    // Deterministic while holding one side of the fork: the one that continues it.
    const continuing = await fetchLatest(arm, GAME, { store: TEST_STORE, heldName: held })
    expect(continuing!.body.header.writerTag).toBe('key_5e1a')
    expect(continuing!.fork).not.toBeNull()
  })
})

describe('turn authority is the state, not a claim', () => {
  it('enables only the active seat, and follows a battle, a throw and a reinforcement', () => {
    const state = twoPlayerGame(1)
    const [first, second] = state.players
    expect(actingPlayerIds(state)).toEqual([first!.id])
    expect(isMyTurn(state, first!.id)).toBe(true)
    expect(isMyTurn(state, second!.id)).toBe(false)

    // A physical throw belongs to its thrower alone (committing someone else's
    // would fall back to the rng and diverge).
    const throwing = {
      ...state,
      pendingDice: { playerId: second!.id },
    } as unknown as GameState
    expect(actingPlayerIds(throwing)).toEqual([second!.id])

    // A battle step belongs to whoever the battle says is acting.
    const battling = {
      ...state,
      battle: { done: false, activePlayerId: second!.id },
    } as unknown as GameState
    expect(actingPlayerIds(battling)).toEqual([second!.id])
    expect(actingPlayerIds({ ...battling, battle: { ...battling.battle, done: true } } as GameState)).toEqual([
      first!.id,
    ])

    // The post-battle reinforcement belongs to the defender's legion owner.
    const defenderLegion = state.legions.find((legion) => legion.playerId === second!.id)!
    const reinforcing = {
      ...state,
      pendingPostBattleReinforce: { legionId: defenderLegion.id },
    } as unknown as GameState
    expect(actingPlayerIds(reinforcing)).toEqual([second!.id])

    // A pre-battle engagement involves BOTH parties: the defender must be able
    // to answer (flee / agree) while the active seat is the attacker.
    const attackerLegion = state.legions.find((legion) => legion.playerId === first!.id)!
    const engagement = {
      ...state,
      phase: 'Fight',
      activeEngagement: {
        attackerId: attackerLegion.id,
        defenderId: defenderLegion.id,
        revealed: true,
        proposal: null,
        proposedBy: null,
      },
    } as unknown as GameState
    expect(actingPlayerIds(engagement).sort()).toEqual([first!.id, second!.id].sort())
  })
})

describe('polling', () => {
  it('polls while visible, makes NO request while hidden, and stops when torn down', async () => {
    vi.useFakeTimers()
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const { transport, calls } = withCallLog(arm)
    const session = createSyncSession({ transport, identity: CREATOR, record, store: TEST_STORE })
    const visibility = new FakeVisibility()
    const handle = pollLatest(session, {
      intervalMs: 1000,
      visibility,
      onAdopt: () => undefined,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(calls.filter((call) => call.startsWith('list'))).toHaveLength(1)

    visibility.set(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.filter((call) => call.startsWith('list'))).toHaveLength(1)

    visibility.set(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.filter((call) => call.startsWith('list'))).toHaveLength(2)

    handle.stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(calls.filter((call) => call.startsWith('list'))).toHaveLength(2)
  })

  it('stops on an AbortSignal and backs off after an error', async () => {
    vi.useFakeTimers()
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const { transport, calls } = withCallLog(arm)
    const session = createSyncSession({ transport, identity: CREATOR, record, store: TEST_STORE })
    const controller = new AbortController()
    const handle = pollLatest(session, {
      intervalMs: 100,
      visibility: new FakeVisibility(),
      onAdopt: () => undefined,
      signal: controller.signal,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.filter((call) => call.startsWith('list'))).toHaveLength(1)
    controller.abort()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls.filter((call) => call.startsWith('list'))).toHaveLength(1)
    handle.stop()
  })
})

describe('seats, seeds and the AI rule', () => {
  it('every client derives the SAME board from the game record', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record, players } = await seededGame(arm)
    const options = multiplayerSeatOptions(record, players)
    expect(options.seed).toBe(gameSeedFor(GAME))
    expect(options.seed).toBe(gameSeedFor(GAME))
    expect(options.diceMode).toBe('physical')
    expect(options.players.map((player) => player.name)).toEqual(['tom', 'bob'])
    expect(options.players.every((player) => player.kind === 'human')).toBe(true)

    const variant = loadDefaultVariant()
    const first = createGame(variant, options)
    const second = createGame(variant, options)
    expect(normalise(first)).toEqual(normalise(second))
  })

  it('refuses a seat with no player record, loudly', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record, players } = await seededGame(arm)
    expect(codeOf(() => multiplayerSeatOptions(record, [players[0]!]))).toBe('missing_seat')
  })

  it('refuses an AI seat in a multiplayer game, loudly', () => {
    const aiGame = createGame(loadDefaultVariant(), {
      players: [
        { name: 'A', kind: 'human' },
        { name: 'B', kind: 'ai' },
      ],
      seed: 1,
    })
    expect(codeOf(() => assertHumanSeats(aiGame))).toBe('ai_seat_unsupported')
    expect(() => assertHumanSeats(twoPlayerGame(1))).not.toThrow()
  })
})

describe('the store body never carries key material, and migration is used', () => {
  it('a published body contains no key material and no key-shaped field', async () => {
    installKey(TEST_KEY)
    const arm = createMemoryTransport({ identity: CREATOR })
    const { record } = await seededGame(arm)
    const published = await publishSnapshot(arm, CREATOR, record, splitOnce(), {
      store: TEST_STORE,
    })
    const stored = (await arm.get(TEST_STORE, published.name)).value
    expect(stored).not.toContain(TEST_KEY)
    expect(stored).not.toContain(TEST_KEY.toLowerCase())
    expect(stored).not.toContain('ssk_')
    expect(Object.keys(published.body)).toEqual(['header', 'state'])
  })

  it('adopt runs deserializeGame, so a legacy field is MIGRATED, never left undefined', async () => {
    const arm = createMemoryTransport({ identity: CREATOR })
    await seededGame(arm)
    const blob = serializeGame(twoPlayerGame(1))
    delete (blob.state as unknown as Record<string, unknown>)['pendingPostBattleReinforce']
    const body: SnapshotBody = {
      header: {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        name: snapshotObjectName(GAME, 1, 0, 'key_5e1a'),
        gameId: GAME,
        turn: 1,
        seq: 0,
        writerTag: 'key_5e1a',
        seat: 0,
        parent: null,
        createdAt: '2026-09-28T10:00:00.000Z',
      },
      state: blob,
    }
    await arm.put(TEST_STORE, body.header.name, serializeSnapshot(body))
    const latest = await fetchLatest(arm, GAME, { store: TEST_STORE })
    const adopted = adopt(latest!.body, null, loadDefaultVariant())
    expect(adopted.pendingPostBattleReinforce).toBeNull()
    // `deserializeGame` carried the blob's own values through rather than
    // dropping them: the migration path ran on the adopted state.
    expect(adopted.diceMode).toBe('rng')
    expect(adopted.diceRoll).toBeNull()
    expect(SAVE_VERSION).toBe(body.state.version)
  })
})

it('the seeded game record parses under the strict v2 parser', async () => {
  const arm = createMemoryTransport({ identity: CREATOR })
  await seededGame(arm)
  const raw = (await arm.get(TEST_STORE, gameObjectName(GAME))).value
  const parsed = parseGameRecord(raw)
  expect(parsed.seatOrder).toEqual([CREATOR.id, JOINER.id])
  expect(parsed.status).toBe('started')
})
