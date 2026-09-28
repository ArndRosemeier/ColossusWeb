/**
 * The S7 pins — the board's PAINT and its CLICK GATE are ONE decision.
 *
 * The owner's live "I cannot move at all" was a seam bug: `MasterBoardView`
 * painted `listEnemyMovePreview` (the union over rolls 1–6) for a non-active
 * legion while `App.tsx`'s click gate silently dispatched `deselectLegion` when
 * `getMovesForSelected` came back empty — the fields vanished and NOTHING was
 * published. These pins hold the replacement: `boardInteraction` (what is
 * painted) and `boardClickVerdict` (what a click does) are driven by the SAME
 * `canAct`, so whatever is drawn as a destination is accepted, a drawn PREVIEW
 * is refused with a sentence and never deselects, and a client that may not act
 * paints no actionable field at all. See `docs/DECISION-LEDGER.md` row 13.
 */

import { describe, expect, it } from 'vitest'
import { dispatch, getMovesForSelected } from '../../engine/GameEngine'
import { listEnemyMovePreview } from '../../engine/movement'
import { turn1SplitChild, twoPlayerGame } from '../../engine/__tests__/helpers'
import type { GameState, Legion } from '../../engine/types'
import {
  boardBlockedReason,
  boardClickVerdict,
  boardInteraction,
  type BoardGate,
} from '../boardInteraction'

/** A real Move-phase state for seat 0, built through the engine. */
function movePhase(roll = 3): GameState {
  const start = twoPlayerGame(1)
  const parent = start.legions.find((l) => l.playerId === start.players[0]!.id)!
  const split = dispatch(start, {
    type: 'split',
    parentId: parent.id,
    childCreatures: turn1SplitChild(start, parent),
  })
  const next = structuredClone(dispatch(split, { type: 'doneSplit' }, () => 0.5))
  next.movementRoll = roll
  next.pendingDice = null
  return next
}

function own(state: GameState): Legion {
  return state.legions.find((l) => l.playerId === state.players[0]!.id)!
}

function enemy(state: GameState): Legion {
  return state.legions.find((l) => l.playerId === state.players[1]!.id)!
}

function selected(state: GameState, legionId: string): GameState {
  return { ...state, selectedLegionId: legionId }
}

function allHexes(state: GameState): string[] {
  return Object.keys(state.variant.board.hexByLabel)
}

function gate(canAct: boolean, refusal = 'not now'): BoardGate {
  return { canAct, refusal }
}

describe('the painted actionable set EQUALS the accepted set', () => {
  it('own legion selected: exactly the painted legal fields are the ones a click moves', () => {
    const base = movePhase(3)
    const state = selected(base, own(base).id)
    const { legal, preview } = boardInteraction(state, true)
    expect(legal.size).toBeGreaterThan(0)
    // The paint is the engine's own rule, not a second implementation.
    expect([...legal.keys()].sort()).toEqual([...getMovesForSelected(state).keys()].sort())
    expect(preview.size).toBe(0)
    for (const label of allHexes(state)) {
      const verdict = boardClickVerdict(state, gate(true), label)
      expect(verdict.kind === 'move', `hex ${label}`).toBe(legal.has(label))
      if (verdict.kind === 'move') expect(verdict.legionId).toBe(state.selectedLegionId)
    }
    expect(legal.size).toBeLessThan(allHexes(state).length)
  })

  it('opponent legion selected: the preview is painted, NO legal field is, and a preview click is refused', () => {
    const base = movePhase(3)
    const enemyId = enemy(base).id
    const state = selected(base, enemyId)
    const { legal, preview } = boardInteraction(state, true)
    expect(legal.size).toBe(0)
    expect(preview.size).toBeGreaterThan(0)
    for (const label of preview.keys()) {
      const verdict = boardClickVerdict(state, gate(true), label)
      expect(verdict.kind).toBe('refuse')
      if (verdict.kind === 'refuse') {
        expect(verdict.message.length).toBeGreaterThan(0)
        expect(verdict.message).toMatch(/preview/i)
      }
    }
    // The selection SURVIVES the refused click: the verdict is a decision, not a
    // state change, and nothing in it can deselect.
    expect(state.selectedLegionId).toBe(enemyId)
    expect(boardInteraction(state, true).selected?.id).toBe(enemyId)
  })

  it('a client that may not act paints NO actionable field, and a click surfaces a reason', () => {
    const base = movePhase(3)
    const state = selected(base, own(base).id)
    const { legal, preview } = boardInteraction(state, false)
    expect(legal.size).toBe(0)
    expect(preview.size).toBe(0)
    const refusal = boardBlockedReason(state, state.players[1]!.id)
    for (const label of allHexes(state).slice(0, 25)) {
      const verdict = boardClickVerdict(state, gate(false, refusal), label)
      expect(verdict.kind).toBe('refuse')
      if (verdict.kind === 'refuse') expect(verdict.message).toBe(refusal)
    }
    // A spectator is told the same way, in the words of the one reason builder.
    const watching = boardBlockedReason(state, null)
    expect(watching).toMatch(/watching/i)
    expect(boardClickVerdict(state, gate(false, watching), '1')).toEqual({
      kind: 'refuse',
      message: watching,
    })
  })

  it('a plain hex is still the DESELECT gesture', () => {
    const base = movePhase(3)
    const state = selected(base, own(base).id)
    const { legal, preview } = boardInteraction(state, true)
    const plain = allHexes(state).find((l) => !legal.has(l) && !preview.has(l))!
    expect(boardClickVerdict(state, gate(true), plain).kind).toBe('deselect')
    // ...and with nothing selected there is nothing to deselect.
    const none = { ...state, selectedLegionId: null }
    expect(boardClickVerdict(none, gate(true), plain).kind).toBe('ignore')
  })

  it("the preview is the ENGINE's own union, not a second implementation", () => {
    const base = movePhase(3)
    const enemyLegion = enemy(base)
    const state = selected(base, enemyLegion.id)
    const { preview } = boardInteraction(state, true)
    const oracle = listEnemyMovePreview(state, enemyLegion)
    expect([...preview.keys()].sort()).toEqual([...oracle.keys()].sort())
  })
})
