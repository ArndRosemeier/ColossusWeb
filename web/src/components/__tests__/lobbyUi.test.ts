/**
 * The lobby's props-to-markup rules, rendered with `react-dom/server` (no
 * browser, no server): Start only for the host and its refusal in words, the
 * resume card, and invite links.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LobbyPanelView, roomCodeFromUrl, roomLink, type LobbyPanelViewProps } from '../LobbyPanel'
import { newToken } from '../../net/identity'
import { createWorld, hostHandle, type RoomWorld } from '../../net/room'

const ME = newToken()
const OTHER = newToken()
const noop = () => {}

function props(over: Partial<LobbyPanelViewProps> = {}): LobbyPanelViewProps {
  return {
    connection: 'online',
    playerName: 'Arnd',
    onPlayerNameChange: noop,
    nameFromCued: false,
    awaitingCuedGame: false,
    myToken: ME,
    variantName: 'Default',
    maxPlayers: 6,
    gameName: "Arnd's game",
    onGameNameChange: noop,
    rooms: [],
    room: null,
    resume: null,
    failure: null,
    busy: false,
    onCreate: noop,
    onJoin: noop,
    onStart: noop,
    onEnter: noop,
    onLeave: noop,
    onReopen: noop,
    onForget: noop,
    ...over,
  }
}

const render = (p: LobbyPanelViewProps) => renderToStaticMarkup(createElement(LobbyPanelView, p))

function lobbyWorld(creator: string, players = 1): RoomWorld {
  let world = createWorld({ displayName: 'Friday', variant: 'Default', maxPlayers: 4, creator: { token: creator, name: 'C' }, conn: 1 })
  if (players > 1) {
    const joiner = creator === ME ? OTHER : ME
    world = hostHandle(world, { t: 'hello', token: joiner, name: 'J', heldRev: null, gameId: null }, 2).world
  }
  return world
}

describe('the lobby view', () => {
  it('the host alone sees Start, disabled, with the reason in words', () => {
    const html = render(props({ room: { code: 'K7Q2ZP', world: lobbyWorld(ME), isHost: true, link: 'x' } }))
    expect(html).toContain('Start game')
    expect(html).toContain('disabled')
    expect(html).toContain('not_enough_players')
  })

  it('with two players the host may Start; a joiner sees no Start at all', () => {
    const host = render(props({ room: { code: 'K7Q2ZP', world: lobbyWorld(ME, 2), isHost: true, link: 'x' } }))
    expect(host).toContain('Start game')
    expect(host).not.toContain('not_enough_players')
    const joiner = render(props({ room: { code: 'K7Q2ZP', world: lobbyWorld(OTHER, 2), isHost: false, link: 'x' } }))
    expect(joiner).not.toContain('Start game')
    expect(joiner).toContain('Waiting for the host')
    expect(joiner).toContain('(you)')
  })

  it('a closed game is offered for re-opening; a live one for rejoining', () => {
    const world = lobbyWorld(ME, 2)
    const closed = render(props({ resume: { copy: { code: 'OLD', world }, live: null } }))
    expect(closed).toContain('Re-open game')
    const live = render(
      props({
        resume: {
          copy: { code: 'OLD', world },
          live: { code: 'NEW123', name: 'Friday', connected: 1, meta: { kind: 'colossus', v: 1, gameId: world.gameId, variant: 'Default', status: 'started', maxPlayers: 4, members: 2, cuedRaum: null } },
        },
      }),
    )
    expect(live).toContain('Rejoin')
    expect(live).toContain('NEW123')
  })

  it('a failure is shown with its code and message', () => {
    const html = render(
      props({ failure: { title: 'Online play is not set up in this build.', code: 'hub_not_configured', message: 'set VITE_GAMEHUB_KEY' } }),
    )
    expect(html).toContain('hub_not_configured')
    expect(html).toContain('set VITE_GAMEHUB_KEY')
  })

  it('Create needs a name', () => {
    const html = render(props({ playerName: '' }))
    expect(html).toContain('Enter your name first.')
  })
})

describe('from cued', () => {
  it('the name is the cued name and cannot be edited; an invitee is told it will join', () => {
    const html = render(props({ nameFromCued: true, awaitingCuedGame: true }))
    expect(html).toMatch(/readOnly|readonly/)
    expect(html).toContain('Your name on cued')
    expect(html).toContain('Opened from a cued invitation')
  })
})

describe('invite links', () => {
  it('reads ?room=CODE and writes it', () => {
    expect(roomCodeFromUrl('?room=k7q2zp')).toBe('K7Q2ZP')
    expect(roomCodeFromUrl('?room=<script>')).toBeNull()
    expect(roomCodeFromUrl('')).toBeNull()
    expect(roomLink('K7Q2ZP', 'https://apps.futuremagic.de/ColossusWeb/?x=1#y')).toBe(
      'https://apps.futuremagic.de/ColossusWeb/?room=K7Q2ZP',
    )
  })
})
