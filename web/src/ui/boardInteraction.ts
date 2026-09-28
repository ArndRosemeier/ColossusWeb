import { activePlayer, getMovesForSelected } from '../engine/GameEngine'
import { listEnemyMovePreview } from '../engine/movement'
import type { GameState, Legion } from '../engine/types'
import { actingPlayerId } from '../net/sync'

/**
 * THE seam between what the board PAINTS and what a click ACCEPTS.
 *
 * Before this module there were two authorities: the paint derived the
 * destination set from `activePlayer(state)` (`MasterBoardView`) while the click
 * gate derived "may I act at all" from `actingPlayerIds` (`sync.ts`), and the
 * rings were not gated by `interactive` at all. On the owner's state that meant
 * the board painted `listEnemyMovePreview`'s UNION over rolls 1–6 as if it were
 * a set of destinations, and a click on one found no move and silently
 * deselected the legion — the highlights vanished and NOTHING was published,
 * because `deselectLegion` is local-only (`docs/DECISION-LEDGER.md` row 13).
 *
 * The fix is one rule: **the same `canAct` that decides the board is
 * interactive decides what is PAINTED and what is ACCEPTED.** `App.tsx` computes
 * `canAct` from the ONE turn authority (`isMyTurn` / `actingPlayerIds`); this
 * module turns that same boolean into the painted field maps
 * (`boardInteraction`) and into the click verdict (`boardClickVerdict`), so the
 * two can never disagree.
 *
 * An inspected OPPONENT's legion is still a feature — its reachable set over
 * rolls 1–6 is painted as a PREVIEW (cyan, each field carrying its cheapest
 * roll), never as your own destinations (orange/teleport). A click on a preview
 * field is REFUSED with a sentence on the ONE message surface; it is never a
 * deselect.
 */

/** A legal destination of the selected, locally-owned legion. */
export interface BoardLegalField {
  readonly side: string
  readonly teleport: boolean
}

/** A field an inspected opponent legion could reach, and the cheapest roll for it. */
export interface BoardPreviewField {
  readonly minRoll: number
  readonly teleport: boolean
}

export interface BoardInteraction {
  /** Fields painted as the local player's own destinations. */
  readonly legal: ReadonlyMap<string, BoardLegalField>
  /** Fields painted as an inspected opponent's movement preview. */
  readonly preview: ReadonlyMap<string, BoardPreviewField>
  /** The legion whose fields are painted, when the phase and selection allow it. */
  readonly selected: Legion | null
}

/**
 * What the board paints for THIS client. `canAct` is the ONE authority's answer
 * (`App.tsx`'s `interactive`), and it is the same value `boardClickVerdict`
 * takes — so "painted" and "accepted" are one computation, not two.
 *
 * With `canAct === false` (a spectator, the other seat's turn, an AI playing) the
 * board paints NO actionable fields at all: a watcher must never see
 * action-looking hexes that every click refuses.
 */
export function boardInteraction(state: GameState, canAct: boolean): BoardInteraction {
  const selected =
    state.phase === 'Move' && state.selectedLegionId !== null
      ? (state.legions.find((l) => l.id === state.selectedLegionId) ?? null)
      : null
  if (!canAct || selected === null) {
    return { legal: new Map(), preview: new Map(), selected }
  }
  if (selected.playerId === activePlayer(state).id) {
    // The engine's ONE rule for "where may THIS legion go, with THIS roll".
    return { legal: getMovesForSelected(state), preview: new Map(), selected }
  }
  return { legal: new Map(), preview: listEnemyMovePreview(state, selected), selected }
}

/**
 * The board's authority for ONE client, in one value: whether it may act, and
 * the sentence the message surface carries when it may not.
 */
export interface BoardGate {
  readonly canAct: boolean
  readonly refusal: string
}

export type BoardClickVerdict =
  | { readonly kind: 'move'; readonly legionId: string; readonly toHex: string; readonly teleport: boolean }
  | { readonly kind: 'deselect' }
  | { readonly kind: 'ignore' }
  | { readonly kind: 'refuse'; readonly message: string }

/**
 * The sentence for "you may not act now", derived from the ONE turn authority
 * so it names the player who CAN act. `localPlayerId` is this client's player,
 * or null for a spectator (seat -1).
 */
export function boardBlockedReason(state: GameState, localPlayerId: string | null): string {
  const actor = state.players.find((p) => p.id === actingPlayerId(state))
  const who = actor?.name ?? 'the active player'
  if (localPlayerId === null) {
    return `You are watching this game — only ${who} may move.`
  }
  return `It is ${who}'s turn — you cannot move your legions now.`
}

/**
 * What a click on `label` DOES, decided by the same `boardInteraction` the board
 * paints from:
 *
 *  - `move`   — a painted legal destination of the selected, locally-owned legion;
 *  - `deselect` — a plain hex, which is still the board's deselect gesture;
 *  - `refuse` — a painted PREVIEW field (an opponent's legion), or any click
 *               while this client may not act. It carries the sentence for the
 *               message surface and NEVER deselects;
 *  - `ignore` — nothing selected in the Move phase, so nothing to do.
 */
export function boardClickVerdict(
  state: GameState,
  gate: BoardGate,
  label: string,
): BoardClickVerdict {
  if (!gate.canAct) return { kind: 'refuse', message: gate.refusal }
  const { legal, preview, selected } = boardInteraction(state, true)
  if (selected === null) return { kind: 'ignore' }
  const move = legal.get(label)
  if (move !== undefined) {
    return { kind: 'move', legionId: selected.id, toHex: label, teleport: move.teleport === true }
  }
  if (preview.has(label)) {
    const owner = state.players.find((p) => p.id === selected.playerId)
    return {
      kind: 'refuse',
      message:
        `${selected.markerId} is ${owner?.name ?? "an opponent"}'s legion — its fields are ` +
        'only a movement preview (rolls 1–6), not a destination you can move to. ' +
        'Select one of your own legions to move.',
    }
  }
  return { kind: 'deselect' }
}
