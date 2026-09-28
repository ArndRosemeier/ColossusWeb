/**
 * The multiplayer status pins — the rules a player must be able to SEE: whose
 * turn it is, whether this client may act, the poll state, and a FORK.
 *
 * Presentational, so it renders server-side with no browser and no store.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MultiplayerStatus, type MultiplayerStatusProps } from '../MultiplayerStatus'
import { formatFork } from '../../net/sync'
import type { PollStatus } from '../../net/sync'

function status(overrides: Partial<PollStatus> = {}): PollStatus {
  return {
    phase: 'polling',
    polls: 3,
    failures: 0,
    lastError: null,
    detail: null,
    lastPolledAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  }
}

function render(overrides: Partial<MultiplayerStatusProps> = {}): string {
  const props: MultiplayerStatusProps = {
    seat: 1,
    seatCount: 3,
    turnLabel: "bob's turn",
    myTurn: true,
    gameOver: false,
    status: status(),
    failure: null,
    ...overrides,
  }
  return renderToStaticMarkup(createElement(MultiplayerStatus, props))
}

describe('the status line states the rules a player needs', () => {
  it('says the seat, whose turn it is, and that I may act', () => {
    const markup = render()
    expect(markup).toContain('Seat 2/3')
    expect(markup).toContain("bob&#x27;s turn")
    expect(markup).toContain('your turn')
  })

  it('marks the board read-only when it is not my turn', () => {
    const markup = render({ myTurn: false })
    expect(markup).toContain('read-only')
    expect(markup).not.toContain('your turn')
  })

  it('tells a spectator they are watching, never that it is their seat', () => {
    const markup = render({ seat: -1 })
    expect(markup).toContain('Watching (3 seats)')
    expect(markup).not.toContain('Seat -1')
  })

  it('surfaces a FORK loudly, naming the writers — it is never silently resolved', () => {
    const markup = render({
      // The SAME wording function the poll puts on the status: the line renders
      // the fork sentence, it does not write its own.
      status: status({
        detail: formatFork({
          turn: 4,
          seq: 2,
          names: [
            'g.twin-1234abcd.s.0004.002.key_5e1a',
            'g.twin-1234abcd.s.0004.002.aaaabbbb',
          ],
        }),
      }),
    })
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('FORK at turn 4 seq 2')
    expect(markup).toContain('key_5e1a')
    expect(markup).toContain('aaaabbbb')
  })

  it('surfaces a sync failure with the service code and message', () => {
    const markup = render({
      status: status({ phase: 'error', failures: 2, lastError: null }),
      failure: {
        title: 'Could not reach the store.',
        code: 'transport_error',
        message: 'network down',
      },
    })
    expect(markup).toContain('sync error')
    expect(markup).toContain('transport_error')
    expect(markup).toContain('network down')
  })

  it('says the game is over instead of naming a turn', () => {
    const markup = render({ gameOver: true })
    expect(markup).toContain('game over')
    expect(markup).not.toContain('your turn')
  })
})
