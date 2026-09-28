/**
 * S9 part B — the delete in the LOBBY: the watcher that runs it, and the panel's
 * words for it.
 *
 * The owner, verbatim: *"Anybody with a key needs to be able to delete all games
 * that have him as a participant. Right now, games just accumulate."* Two rules
 * that matter most here, both straight from the brief and from reality:
 *
 *  1. **Only games the caller was IN** are offered — `alreadyJoined` comes from
 *     the S5 per-game prefix listing, so the affordance and the refusal are the
 *     same fact.
 *  2. **A `403` must be LOUD and must never look like a success.** ServerStore
 *     makes `delete` opt-in and the owner's live keys are `read,write`, so a
 *     refusal is the EXPECTED outcome today: it is shown with the store's own
 *     `code` and `message`, the ONE actionable sentence, and the count of what was
 *     and was not removed.
 *
 * Everything runs against S1's in-memory twin: no test calls the live service and
 * no key material is used.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMemoryTransport, createMemoryTransportBackend } from '../memoryTransport'
import { GameDeletionError, createGame, joinGame, lobbyContext, type GameDeletionPlan, type GameListing } from '../lobby'
import { LobbyWatcher } from '../lobbyWatcher'
import { gameObjectName, playerObjectName, playerTagFor } from '../gameRecord'
import { SNAPSHOT_SCHEMA_VERSION, serializeSnapshot, snapshotObjectName } from '../snapshot'
import { ServerStoreError, type ServerStoreTransport, type StoreIdentity } from '../transport'
import { DeletionCard, LobbyPanelView, type DeletionNotice, type LobbyPanelViewProps } from '../../components/LobbyPanel'
import { TEST_STORE } from './transportHarness'
import type { FailureDescription } from '../failure'

const CREATOR: StoreIdentity = {
  id: 'key_5e1a1d3f',
  label: 'tom',
  stores: [TEST_STORE],
  perms: ['read', 'write'],
}
const OTHER: StoreIdentity = {
  id: 'AAAAbbbb1111',
  label: 'bob',
  stores: [TEST_STORE],
  perms: ['read', 'write'],
}

/** A game created and joined by `owner`, with `snapshots` snapshot objects. */
async function seed(
  transport: ServerStoreTransport,
  owner: StoreIdentity,
  displayName: string,
  snapshots: number,
): Promise<{ gameId: string; players: number; snapshots: number }> {
  const context = lobbyContext({ transport, identity: owner, store: TEST_STORE })
  const record = await createGame(context, { displayName, variant: 'Default', maxPlayers: 6 })
  await joinGame(context, record.gameId)
  for (let seq = 0; seq < snapshots; seq++) {
    const tag = playerTagFor(owner.id)
    const name = snapshotObjectName(record.gameId, 1, seq, tag)
    await transport.put(
      TEST_STORE,
      name,
      serializeSnapshot({
        header: {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          name,
          gameId: record.gameId,
          turn: 1,
          seq,
          writerTag: tag,
          seat: 0,
          parent: null,
          createdAt: '2026-09-29T10:00:00.000Z',
        },
        state: {
          version: 1,
          savedAt: '2026-09-29T10:00:00.000Z',
          variantName: 'Default',
          state: {},
        },
      }),
    )
  }
  return { gameId: record.gameId, players: 1, snapshots }
}

function render(overrides: Partial<LobbyPanelViewProps> = {}): string {
  const props: LobbyPanelViewProps = {
    identity: CREATOR,
    variantName: 'Default',
    maxPlayers: 6,
    displayName: 'My game',
    onDisplayNameChange: () => undefined,
    listing: { games: [], unreadable: [] },
    active: null,
    failure: null,
    notice: null,
    pollStatus: null,
    busy: false,
    onCreate: () => undefined,
    onJoin: () => undefined,
    onStart: () => undefined,
    onEnter: () => undefined,
    onLeave: () => undefined,
    onRefresh: () => undefined,
    onClose: () => undefined,
    ...overrides,
  }
  return renderToStaticMarkup(createElement(LobbyPanelView, props))
}

const PLAN: GameDeletionPlan = {
  gameId: 'toms-game-1234abcd',
  record: gameObjectName('toms-game-1234abcd'),
  snapshots: Array.from({ length: 100 }, (_, i) => ({
    store: TEST_STORE,
    name: `snap.toms-game-1234abcd.0001.${String(i).padStart(3, '0')}.key_5e1a`,
    sha256: 'x',
    size: 1,
    createdAt: '2026-09-29T10:00:00.000Z',
  })),
  players: [
    {
      store: TEST_STORE,
      name: playerObjectName('toms-game-1234abcd', 'key_5e1a'),
      sha256: 'x',
      size: 1,
      createdAt: '2026-09-29T10:00:00.000Z',
    },
    {
      store: TEST_STORE,
      name: playerObjectName('toms-game-1234abcd', 'aaaa1111'),
      sha256: 'x',
      size: 1,
      createdAt: '2026-09-29T10:00:00.000Z',
    },
  ],
}

function notice(overrides: Partial<DeletionNotice['state']> = {}): DeletionNotice {
  const state = {
    gameId: 'toms-game-1234abcd',
    plan: PLAN,
    deleted: 0,
    total: 103,
    absent: 0,
    running: false,
    failure: null,
    advice: null,
    ...overrides,
  }
  return {
    state,
    plan: PLAN,
    displayName: "Tom's Game!",
    deletePermitted: true,
    onConfirm: () => undefined,
    onCancel: () => undefined,
  }
}

describe('S9-B · the lobby offers delete only for games the caller was IN', () => {
  it('a game the caller joined shows a Delete affordance; one they did not does NOT', () => {
    const markup = render({
      listing: {
        games: [
          {
            objectName: gameObjectName('mine-1234abcd'),
            gameId: 'mine-1234abcd',
            record: {
              version: 2,
              gameId: 'mine-1234abcd',
              displayName: 'Mine',
              variant: 'Default',
              creator: { id: OTHER.id, label: OTHER.label },
              status: 'lobby',
              maxPlayers: 6,
              seatOrder: [],
              createdAt: '2026-09-29T09:00:00.000Z',
            },
            playerCount: 2,
            alreadyJoined: true,
          },
          {
            objectName: gameObjectName('theirs-1234abcd'),
            gameId: 'theirs-1234abcd',
            record: {
              version: 2,
              gameId: 'theirs-1234abcd',
              displayName: 'Theirs',
              variant: 'Default',
              creator: { id: OTHER.id, label: OTHER.label },
              status: 'lobby',
              maxPlayers: 6,
              seatOrder: [],
              createdAt: '2026-09-29T09:00:00.000Z',
            },
            playerCount: 1,
            alreadyJoined: false,
          },
        ],
        unreadable: [],
      } as GameListing,
    })
    expect(markup).toContain('data-game="mine-1234abcd"')
    expect(markup).not.toContain('data-game="theirs-1234abcd"')
  })
})

describe('S9-B · the confirmation names what goes, and the progress counts', () => {
  it('the card names the game, its snapshots, its players and the record', () => {
    const html = renderToStaticMarkup(createElement(DeletionCard, { notice: notice() }))
    expect(html).toContain("Tom&#x27;s Game!")
    expect(html).toContain('id toms-game-1234abcd')
    expect(html).toContain('100 snapshots')
    expect(html).toContain('2 player objects')
    expect(html).toContain('103 objects in all')
    expect(html).toContain('The record goes last')
    expect(html).toContain('Delete permanently')
    expect(html).toContain('Cancel')
  })

  it('a running delete shows its progress rather than looking frozen', () => {
    const html = renderToStaticMarkup(
      createElement(DeletionCard, {
        notice: notice({ running: true, deleted: 37, absent: 2, total: 103 }),
      }),
    )
    expect(html).toContain('Deleting… 37 / 103 objects')
    expect(html).toContain('2 already gone')
  })

  it('a key WITHOUT the delete permission is told so BEFORE the first request', () => {
    const html = renderToStaticMarkup(
      createElement(DeletionCard, { notice: { ...notice(), deletePermitted: false } }),
    )
    expect(html).toContain('do not include')
    expect(html).toContain('delete')
    expect(html).toContain('read,write')
    expect(html).toContain('the store will refuse')
  })
})

describe('S9-B · a 403 is LOUD and NEVER looks like a success', () => {
  const failure: FailureDescription = {
    title: 'The store refused the key.',
    code: 'forbidden',
    message: 'key is not allowed to delete objects',
  }
  const denied = notice({
    deleted: 0,
    total: 103,
    running: false,
    failure,
    advice:
      'this key cannot delete: ask the operator to grant the delete permission — the key has read,write today, and nothing was removed',
  })

  it('the card says NOT DELETED, carries the store’s own code and message, and says what remains', () => {
    const html = renderToStaticMarkup(createElement(DeletionCard, { notice: denied }))
    expect(html).toContain('Not deleted.')
    expect(html).toContain('Deleted 0 of 103 objects')
    expect(html).toContain('forbidden')
    expect(html).toContain('key is not allowed to delete objects')
    expect(html).toContain('ask the operator to grant the delete permission')
    expect(html).toContain('still there, and the game is still listed and still deletable')
    // It must NOT claim a success anywhere on the card.
    expect(html.toLowerCase()).not.toContain('deleted &quot;')
    expect(html).not.toContain('Deleted the game')
  })

  it('a PARTIAL delete reports exactly what was and was not removed', () => {
    const partial = notice({
      deleted: 12,
      absent: 1,
      total: 103,
      running: false,
      failure: { title: 'The store refused the key.', code: 'forbidden', message: 'nope' },
      advice: 'this key cannot delete: ask the operator to grant the delete permission',
    })
    const html = renderToStaticMarkup(createElement(DeletionCard, { notice: partial }))
    expect(html).toContain('Deleted 12 of 103 objects')
    expect(html).toContain('(1 were already gone)')
    // 103 total − 12 removed − 1 already gone = 90 remaining.
    expect(html).toContain('The remaining 90 objects')
  })

  it('the lobby view renders the card, so the refusal is on the app’s ONE surface', () => {
    const html = render({ listing: { games: [], unreadable: [] }, deletion: denied })
    expect(html).toContain('Not deleted.')
    expect(html).toContain('forbidden')
  })
})

describe('S9-B · the watcher runs the delete and reports it', () => {
  it('deletes every object of the game, clears the confirmation, and drops it from the list', async () => {
    const backend = createMemoryTransportBackend()
    const transport = createMemoryTransport({ identity: CREATOR, backend })
    const seeded = await seed(transport, CREATOR, 'Cleaned up', 4)
    const watcher = new LobbyWatcher({ transport, identity: CREATOR, store: TEST_STORE })
    watcher.start()
    await watcher.refresh()
    expect(watcher.getData().listing?.games.map((g) => g.gameId)).toEqual([seeded.gameId])

    const planned = await watcher.planDeletion(seeded.gameId)
    expect(planned?.total).toBe(4 + 1 + 1)
    expect(planned?.running).toBe(false)

    await watcher.deleteGame(seeded.gameId)

    // Gone from the STORE and from the listing, and nothing left to confirm.
    const objects = await transport.list(TEST_STORE)
    expect(objects.map((o) => o.name)).toEqual([])
    expect(watcher.getData().deletion).toBeNull()
    expect(watcher.getData().listing?.games).toEqual([])
    watcher.close()
  })

  it('a 403 from the store is stored LOUDLY with the counts, and the game is still listed', async () => {
    const backend = createMemoryTransportBackend()
    const transport = createMemoryTransport({ identity: CREATOR, backend })
    const seeded = await seed(transport, CREATOR, 'Keeps refusing', 3)
    const tag = playerTagFor(CREATOR.id)
    // ServerStore makes `delete` opt-in, and the owner's keys are `read,write`.
    backend.failures[`DELETE ${TEST_STORE}/snap.${seeded.gameId}.0001.001.${tag}`] =
      new ServerStoreError('forbidden', 'key is not allowed to delete objects', 403)

    const watcher = new LobbyWatcher({ transport, identity: CREATOR, store: TEST_STORE })
    watcher.start()
    await watcher.refresh()
    await watcher.planDeletion(seeded.gameId)
    const failure = await watcher.deleteGame(seeded.gameId).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(GameDeletionError)
    const state = watcher.getData().deletion
    expect(state).not.toBeNull()
    expect(state!.running).toBe(false)
    expect(state!.failure?.code).toBe('forbidden')
    expect(state!.failure?.message).toBe('key is not allowed to delete objects')
    // EXACT counts: the snapshots before the refusal are gone, the record is not.
    expect(state!.deleted).toBe(1)
    expect(state!.total).toBe(3 + 1 + 1)
    expect(state!.advice).toContain('ask the operator to grant the delete permission')
    expect(state!.advice).toContain('nothing was removed')
    // The game is STILL THERE and still listed — the app must not claim otherwise.
    const left = (await transport.list(TEST_STORE)).map((o) => o.name)
    expect(left).toContain(gameObjectName(seeded.gameId))
    expect(watcher.getData().listing?.games.map((g) => g.gameId)).toEqual([seeded.gameId])
    // The panel can render all of it from that one state.
    const html = renderToStaticMarkup(
      createElement(DeletionCard, {
        notice: {
          state: state!,
          plan: state!.plan,
          displayName: 'Keeps refusing',
          deletePermitted: false,
          onConfirm: () => undefined,
          onCancel: () => undefined,
        },
      }),
    )
    expect(html).toContain('Not deleted.')
    expect(html).toContain('forbidden')
    watcher.close()
  })

  it('refuses to plan a game the caller was never in, and offers no delete', async () => {
    const backend = createMemoryTransportBackend()
    const transport = createMemoryTransport({ identity: CREATOR, backend })
    const seeded = await seed(transport, OTHER, 'Not mine', 1)
    const watcher = new LobbyWatcher({ transport, identity: CREATOR, store: TEST_STORE })
    watcher.start()
    await watcher.refresh()

    const failure = await watcher.planDeletion(seeded.gameId).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ServerStoreError)
    expect((failure as ServerStoreError).code).toBe('not_a_participant')
    expect(watcher.getData().deletion).toBeNull()
    // Nothing was deleted.
    expect((await transport.list(TEST_STORE)).map((o) => o.name)).toContain(
      gameObjectName(seeded.gameId),
    )
    watcher.close()
  })

  it('a running delete publishes progress for each object', async () => {
    const backend = createMemoryTransportBackend()
    const transport = createMemoryTransport({ identity: CREATOR, backend })
    const seeded = await seed(transport, CREATOR, 'Big one', 6)
    const watcher = new LobbyWatcher({ transport, identity: CREATOR, store: TEST_STORE })
    watcher.start()
    await watcher.refresh()
    await watcher.planDeletion(seeded.gameId)

    const seen: number[] = []
    const unsubscribe = watcher.subscribe(() => {
      const state = watcher.getData().deletion
      if (state?.running) seen.push(state.deleted)
    })
    await watcher.deleteGame(seeded.gameId)
    unsubscribe()
    // From 0 up to the object before the last; the completion clears the state.
    expect(seen[0]).toBe(0)
    expect(Math.max(...seen)).toBe(6 + 1 + 1 - 1)
    expect(new Set(seen).size).toBeGreaterThan(4)
    watcher.close()
  })
})

