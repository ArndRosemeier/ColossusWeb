import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MultiplayerStatus, type MultiplayerStatusProps } from '../MultiplayerStatus'

function render(over: Partial<MultiplayerStatusProps> = {}): string {
  return renderToStaticMarkup(
    createElement(MultiplayerStatus, {
      seat: 0,
      seatCount: 2,
      roomCode: 'K7Q2ZP',
      isHost: false,
      away: [],
      turnLabel: "Alice's turn",
      myTurn: true,
      gameOver: false,
      connection: 'online',
      failure: null,
      ...over,
    }),
  )
}

describe('the online status line', () => {
  it('says the seat, whose turn it is, and whether this client may act', () => {
    const mine = render()
    expect(mine).toContain('Seat 1/2')
    expect(mine).toContain("Alice&#x27;s turn")
    expect(mine).toContain('your turn')
    expect(render({ myTurn: false })).toContain('read-only')
    expect(render({ seat: -1 })).toContain('Watching (2 seats)')
  })

  it('says where it is connected, and when it is not', () => {
    expect(render({ isHost: true })).toContain('room K7Q2ZP · host')
    expect(render({ connection: 'reconnecting' })).toContain('reconnecting')
    expect(render({ roomCode: null })).toContain('room closed')
    expect(render({ away: ['Bob'] })).toContain('away: Bob')
  })

  it('a refused move is surfaced with its code, never swallowed', () => {
    const html = render({
      failure: { title: 'That move was not accepted.', code: 'not_your_turn', message: 'it is not your turn' },
    })
    expect(html).toContain('role="alert"')
    expect(html).toContain('not_your_turn')
  })
})
