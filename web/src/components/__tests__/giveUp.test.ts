/**
 * S9 part A — the UI half of GIVE UP: WHOSE control is offered, and WHEN it is
 * refused. The engine owns what resigning DOES (`rules-resign.test.ts`); these
 * render `GiveUpSection` server-side with no browser and no store, the same
 * method `engagementChoice.test.ts` and `lobbyUi.test.ts` use, so every assertion
 * is about the props-to-markup rule.
 *
 * The seat rule is S8's, not a second one: `myPlayerId` says which client is
 * looking, exactly as `BoardDecisionOverlay` asks whose engagement answer to show.
 * The refusal wording is the ENGINE's (`resignRefusalReason`) — the panel must not
 * invent a second sentence for the same rule.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createGame, dispatch } from '../../engine/GameEngine'
import type { GameState } from '../../engine/types'
import { loadDefaultVariant, twoPlayerGame } from '../../engine/__tests__/helpers'
import { GiveUpSection } from '../GameControls'

function render(
  state: GameState,
  myPlayerId: string | null,
  confirmingPlayerId: string | null = null,
): string {
  return renderToStaticMarkup(
    createElement(GiveUpSection, {
      state,
      myPlayerId,
      confirmingPlayerId,
      onPress: () => {},
    }),
  )
}

function human(id: string, name: string) {
  return { name, kind: 'human' as const }
}

describe('S9-A · the give-up control', () => {
  it('online it is offered to the caller’s OWN seat ONLY — never for the opponent', () => {
    const state = twoPlayerGame(11)
    const alice = state.players[0]!
    const bob = state.players[1]!

    const mine = render(state, alice.id)
    expect(mine).toContain('data-player="p0"')
    expect(mine).not.toContain(`data-player="${bob.id}"`)
    expect(mine).toContain('Give up the game')

    const theirs = render(state, bob.id)
    expect(theirs).toContain(`data-player="${bob.id}"`)
    expect(theirs).not.toContain(`data-player="${alice.id}"`)
  })

  it('hotseat offers one NAMED control per human side (one person, both seats)', () => {
    const state = twoPlayerGame(11)
    const html = render(state, null)
    expect(html).toContain('data-player="p0"')
    expect(html).toContain('data-player="p1"')
    // The active player is seat 0, but the OTHER human may give up too — the app
    // already treats hotseat as one person holding every human side.
    expect(html).toContain('Give up (Alice)')
    expect(html).toContain('Give up (Bob)')
  })

  it('an AI seat is never offered a give-up control', () => {
    const state = createGame(loadDefaultVariant(), {
      players: [human('Alice', 'Alice'), { name: 'Bot', kind: 'ai' as const }],
      seed: 11,
    })
    const html = render(state, null)
    expect(html).toContain('data-player="p0"')
    expect(html).not.toContain('data-player="p1"')
    // Exactly ONE control: the bot has none.
    expect(html.match(/give-up-btn/g)).toHaveLength(1)
  })

  it('the FIRST press asks; the confirmation names the player and says it is irreversible', () => {
    const state = twoPlayerGame(11)
    const alice = state.players[0]!

    const first = render(state, alice.id)
    expect(first).toContain('>Give up the game</button>')
    expect(first).not.toContain('confirm')

    const asking = render(state, alice.id, alice.id)
    expect(asking).toContain('Give up as Alice — confirm')
    expect(asking).toContain('Irreversible')
    expect(asking).toContain('every Alice&#x27;s legion leaves the board')
    expect(asking).toContain('an engaged enemy scores half their value')
    // The other players are TOLD whose game ended — that is the published log line
    // AND this sentence, which says so before the press.
    expect(asking).toContain('the other players are told whose game just ended')
  })

  it('inside a battle the control is DISABLED, with the engine’s own reason on screen', () => {
    const base = twoPlayerGame(61)
    const attacker = base.legions[0]!
    const defender = base.legions[1]!
    defender.creatures = [
      { type: 'Centaur', hits: 0 },
      { type: 'Ogre', hits: 0 },
    ]
    defender.knownPublic = ['Centaur', 'Ogre']
    attacker.hexLabel = defender.hexLabel
    base.phase = 'Fight'
    base.pendingEngagements = [{ attackerId: attacker.id, defenderId: defender.id }]
    const opened = dispatch(base, {
      type: 'startEngagement',
      attackerId: attacker.id,
      defenderId: defender.id,
    })
    const standing = dispatch(opened, { type: 'standFight' })
    const battle = dispatch(standing, {
      type: 'startEngagement',
      attackerId: attacker.id,
      defenderId: defender.id,
    })
    expect(battle.battle).not.toBeNull()

    const html = render(battle, battle.players[0]!.id)
    expect(html).toContain('disabled')
    expect(html).toContain('Cannot give up during a battle — concede the battle instead')
  })

  it('a player who is already dead is not offered a control at all', () => {
    const state = twoPlayerGame(11)
    const alice = state.players[0]!
    const ended = dispatch(state, { type: 'resign', playerId: alice.id })
    expect(render(ended, null)).not.toContain(`data-player="${alice.id}"`)
    expect(render(ended, null)).toContain('data-player="p1"')
  })
})
