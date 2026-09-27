/**
 * The lobby UI pins — the part that is a RULE rather than a rendering detail:
 * **Start appears only for the creator**, and a refusal is shown with the
 * service's own code and message, never as a blank or a silent reset.
 *
 * `LobbyPanelView` is presentational, so it renders server-side with no browser
 * and no store: every assertion below is about the props-to-markup rule, which is
 * exactly where "only the creator" lives.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LobbyPanelView, type LobbyPanelViewProps } from '../LobbyPanel'
import type { FailureDescription } from '../../net/failure'
import type { GameRecord, PlayerRecord } from '../../net/gameRecord'
import type { ActiveLobby, GameListing } from '../../net/lobby'
import type { StoreIdentity } from '../../net/transport'

const CREATOR: StoreIdentity = {
  id: 'key_5e1a1d3f',
  label: 'tom',
  stores: ['colossus'],
  perms: ['read', 'write'],
}
const OTHER: StoreIdentity = {
  id: 'AAAAbbbb1111',
  label: 'bob',
  stores: ['colossus'],
  perms: ['read', 'write'],
}

function game(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    version: 2,
    gameId: 'toms-game-1234abcd',
    displayName: "Tom's Game!",
    variant: 'Default',
    creator: { id: CREATOR.id, label: CREATOR.label },
    status: 'lobby',
    maxPlayers: 6,
    seatOrder: [],
    createdAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  }
}

function player(id: string, label: string): PlayerRecord {
  return {
    version: 1,
    gameId: 'toms-game-1234abcd',
    playerId: id,
    label,
    joinedAt: '2026-09-28T10:01:00.000Z',
  }
}

function listing(overrides: Partial<GameListing> = {}): GameListing {
  return { games: [], unreadable: [], ...overrides }
}

function active(record: GameRecord, players: PlayerRecord[]): ActiveLobby {
  return { record, players }
}

function render(overrides: Partial<LobbyPanelViewProps> = {}): string {
  const props: LobbyPanelViewProps = {
    identity: CREATOR,
    variantName: 'Default',
    maxPlayers: 6,
    displayName: 'My game',
    onDisplayNameChange: () => undefined,
    listing: null,
    active: null,
    failure: null,
    notice: null,
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

/** The opening tag of the first button whose text is `label`. */
function buttonTagFor(markup: string, label: string): string {
  const match = new RegExp(`<button[^>]*>${label}</button>`).exec(markup)
  if (match === null) throw new Error(`no button labelled ${JSON.stringify(label)} in markup`)
  return match[0]
}

describe('the lobby panel is reachable only once a key is connected', () => {
  it('asks for a connection instead of showing dead actions', () => {
    const markup = render({ identity: null })
    expect(markup).toContain('Connect a ServerStore key')
    expect(markup).not.toContain('Create Multiplayer')
    expect(markup).not.toContain('Join Multiplayer')
    expect(markup).not.toContain('Start Multiplayer')
  })
})

describe('Create and Join', () => {
  it('offers Create with the selected variant and its player cap', () => {
    const markup = render({ variantName: 'Abyssal3', maxPlayers: 3 })
    expect(markup).toContain('Create Multiplayer')
    expect(markup).toContain('Abyssal3')
    expect(markup).toContain('up to 3 players')
  })

  it('lists a joinable game with its creator, variant and player count', () => {
    const markup = render({
      listing: listing({
        games: [
          {
            objectName: 'g.toms-game-1234abcd.game',
            gameId: 'toms-game-1234abcd',
            record: game(),
            playerCount: 2,
            alreadyJoined: false,
          },
        ],
      }),
    })
    expect(markup).toContain("Tom&#x27;s Game!")
    expect(markup).toContain('Join Multiplayer')
    expect(markup).toContain('2/6')
    expect(markup).toContain('tom')
  })

  it('marks a started game and a full game as Unavailable, with the reason', () => {
    const markup = render({
      listing: listing({
        games: [
          {
            objectName: 'g.started-1111aaaa.game',
            gameId: 'started-1111aaaa',
            record: game({ gameId: 'started-1111aaaa', status: 'started' }),
            playerCount: 2,
            alreadyJoined: false,
          },
          {
            objectName: 'g.full-2222bbbb.game',
            gameId: 'full-2222bbbb',
            record: game({ gameId: 'full-2222bbbb', maxPlayers: 2 }),
            playerCount: 2,
            alreadyJoined: false,
          },
        ],
      }),
    })
    expect(markup.match(/Unavailable/g)).toHaveLength(2)
    expect(markup).toContain('game_started')
    expect(markup).toContain('game_full')
  })

  it('offers Open for a game the caller is already in, not Join', () => {
    const markup = render({
      listing: listing({
        games: [
          {
            objectName: 'g.toms-game-1234abcd.game',
            gameId: 'toms-game-1234abcd',
            record: game(),
            playerCount: 1,
            alreadyJoined: true,
          },
        ],
      }),
    })
    expect(markup).toContain('Open')
    expect(markup).not.toContain('>Join Multiplayer</button>')
  })

  it('surfaces an unreadable game record with the service code and message', () => {
    const failure: FailureDescription = {
      title: 'A game record could not be read.',
      code: 'bad_game_record',
      message: 'game record.status is "paused"',
    }
    const markup = render({
      listing: listing({
        unreadable: [
          { objectName: 'g.broken-3333cccc.game', gameId: 'broken-3333cccc', failure },
        ],
      }),
    })
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('g.broken-3333cccc.game')
    expect(markup).toContain('bad_game_record')
    expect(markup).toContain('game record.status is')
  })
})

describe('Start Multiplayer is the creator alone', () => {
  const twoPlayers = [player(CREATOR.id, 'tom'), player(OTHER.id, 'bob')]

  it('shows an enabled Start to the creator of a lobby with two players', () => {
    const markup = render({ identity: CREATOR, active: active(game(), twoPlayers) })
    const start = buttonTagFor(markup, 'Start Multiplayer \\(creator\\)')
    expect(start).not.toContain('disabled')
    expect(markup).not.toContain('not_enough_players')
  })

  it('shows NO Start at all to a player who is not the creator', () => {
    const markup = render({ identity: OTHER, active: active(game(), twoPlayers) })
    expect(markup).not.toContain('Start Multiplayer')
    expect(markup).toContain('Leave game')
    expect(markup).toContain('Created by tom')
  })

  it('shows the creator a disabled Start, with the reason, until a second player joins', () => {
    const markup = render({
      identity: CREATOR,
      active: active(game(), [player(CREATOR.id, 'tom')]),
    })
    const start = buttonTagFor(markup, 'Start Multiplayer \\(creator\\)')
    expect(start).toContain('disabled')
    expect(markup).toContain('not_enough_players')
  })

  it('offers Enter game to a SEATED player once the game has started', () => {
    const started = game({ status: 'started', seatOrder: [CREATOR.id, OTHER.id] })
    const markup = render({ identity: CREATOR, active: active(started, twoPlayers) })
    expect(markup).not.toContain('>Start Multiplayer (creator)</button>')
    expect(markup).toContain('Enter game')
    expect(markup).not.toContain('Watching')
  })

  it('tells a SPECTATOR they are watching, never treating them as seat 0', () => {
    const started = game({ status: 'started', seatOrder: [CREATOR.id, OTHER.id] })
    const stranger: StoreIdentity = {
      id: 'ZZZZ9999watching',
      label: 'caspar',
      stores: ['colossus'],
      perms: ['read'],
    }
    const markup = render({ identity: stranger, active: active(started, twoPlayers) })
    expect(markup).toContain('Watching')
    expect(markup).not.toContain('Enter game')
  })
})

describe('refusals and notices are visible', () => {
  it('renders a refusal with its title, code and the service message', () => {
    const markup = render({
      failure: {
        title: 'The lobby refused.',
        code: 'game_full',
        message: '"Tom\'s Game!" is full (6 players)',
      },
    })
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('game_full')
    expect(markup).toContain('is full (6 players)')
  })

  it('renders a success notice', () => {
    const markup = render({ notice: 'Created "My game". Waiting for players.' })
    expect(markup).toContain('role="status"')
    expect(markup).toContain('Waiting for players')
  })
})
