/**
 * S8's UI-side pin: WHOSE client shows the defender's flee/stand window.
 *
 * The engine cannot tell one browser from another — during an engagement both
 * parties are "may act" (`actingPlayerIds`, `sync.ts`, S7's ONE authority), and
 * the engine's only seat notion (`activePlayer`) is the ATTACKER throughout. So
 * the seat question is decided where it is answerable: the card maps each side's
 * controls to THIS client's seat. `myPlayerId === null` is hotseat, where one
 * person holds both sides and every human-controlled part of the card is theirs.
 *
 * These render server-side with no browser and no store (same method as
 * `lobbyUi.test.ts`): every assertion is about the props-to-markup rule.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { dispatch } from '../../engine/GameEngine'
import type { GameCommand, GameState, Legion } from '../../engine/types'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { BoardDecisionOverlay } from '../BoardDecisionOverlay'

/** Two HUMAN seats around a revealed engagement whose defender can flee. */
function engagementState(seed = 71): {
  state: GameState
  attackerPlayerId: string
  defenderPlayerId: string
} {
  const state = twoPlayerGame(seed)
  const attacker: Legion = state.legions[0]!
  const defender: Legion = state.legions[1]!
  defender.creatures = [
    { type: 'Centaur', hits: 0 },
    { type: 'Ogre', hits: 0 },
  ]
  defender.knownPublic = ['Centaur', 'Ogre']
  attacker.hexLabel = defender.hexLabel
  state.phase = 'Fight'
  state.pendingEngagements = [{ attackerId: attacker.id, defenderId: defender.id }]
  const opened = dispatch(state, {
    type: 'startEngagement',
    attackerId: attacker.id,
    defenderId: defender.id,
  })
  return {
    state: opened,
    attackerPlayerId: attacker.playerId,
    defenderPlayerId: defender.playerId,
  }
}

function markup(state: GameState, myPlayerId: string | null): string {
  return renderToStaticMarkup(
    createElement(BoardDecisionOverlay, {
      state,
      dispatch: (_cmd: GameCommand) => {},
      myPlayerId,
    }),
  )
}

describe('S8 engagement overlay — whose client shows which choice', () => {
  it('the DEFENDER’s client is asked to stand or flee, and gets no battle button', () => {
    const { state, defenderPlayerId } = engagementState()
    expect(state.activeEngagement?.fleeDeclined).toBe(false)
    const html = markup(state, defenderPlayerId)
    expect(html).toContain('Stand and fight')
    expect(html).toContain('Flee')
    expect(html).not.toContain('Fight!')
    expect(html).toContain('choose how your legion answers')
  })

  it('the ATTACKER’s client shows it is WAITING and offers no way past the defender', () => {
    const { state, attackerPlayerId } = engagementState(72)
    const html = markup(state, attackerPlayerId)
    // The owner's bug: this client used to hold a button that began the battle.
    expect(html).not.toContain('Fight!')
    expect(html).not.toContain('Stand and fight')
    expect(html).not.toContain('>Flee<')
    expect(html).toMatch(/Waiting for .* to choose: stand and fight, or flee/)
  })

  it('after the defender stands, the attacker’s client may demand the battle', () => {
    const { state, attackerPlayerId } = engagementState(73)
    const stood = dispatch(state, { type: 'standFight' })
    const attackerHtml = markup(stood, attackerPlayerId)
    expect(attackerHtml).toContain('Fight!')
    expect(attackerHtml).not.toContain('Stand and fight')
  })

  it('hotseat (myPlayerId null) keeps BOTH sides’ controls in one client', () => {
    const { state } = engagementState(74)
    const html = markup(state, null)
    expect(html).toContain('Stand and fight')
    expect(html).toContain('Flee')
    // Fight! waits for the defender's answer even in hotseat — the one sitting
    // still completes, because both controls are on the same screen.
    expect(html).not.toContain('Fight!')
  })

  it('a client that is neither party gets no party’s controls', () => {
    // The app never renders the overlay for such a seat (`interactive` is false
    // for a spectator, App.tsx), so this is the belt to that braces: even if it
    // renders, neither side's buttons appear.
    const { state } = engagementState(75)
    const html = markup(state, 'seat-neither-party')
    expect(html).not.toContain('Stand and fight')
    expect(html).not.toContain('Flee')
    expect(html).not.toContain('Fight!')
  })
})
