/**
 * Turn sync — the rules that make a started online game PLAYABLE, independent
 * of the wire.
 *
 * The authoritative state is the room's {@link RoomWorld} on the GameHub host
 * (`room.ts`); `session.ts` carries it over the socket. This module owns what
 * does NOT depend on the transport:
 *
 * | Idea | The ONE implementation |
 * | --- | --- |
 * | reading/writing state | `serializeGame` / `deserializeGame` (`persistence/saveGame.ts`) — never a second format |
 * | the opening board every client builds | {@link multiplayerSeatOptions} |
 * | adopting a remote state | {@link adopt} (deserialise + preserve local UI fields) |
 * | a local command changing state | {@link createCommitPath} — the only path that sends a move |
 * | whose turn a seat may act | {@link actingPlayerIds} / {@link isMyTurn} |
 *
 * The host validates every move with the SAME {@link actingPlayerIds} the board
 * uses to decide `interactive`, so "painted", "accepted locally" and "accepted by
 * the host" are one rule.
 */

import { getMovesForSelected } from '../engine/GameEngine'
import type { GameCommand, GameState, NewGameOptions, PlayerKind } from '../engine/types'
import { PLAYER_COLORS } from '../engine/types'
import { deserializeGame, type SavedGameBlob } from '../persistence/saveGame'
import type { LoadedVariant } from '../variant/loadVariant'
import { NetError } from './failure'
import type { RoomWorld } from './room'

/**
 * The seed for the opening board, derived from the `gameId` so every client that
 * builds it locally builds the SAME one.
 */
export function gameSeedFor(gameId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < gameId.length; i++) {
    hash ^= gameId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * The engine options for an online game: seats in join order (creator first),
 * capped at the room's `maxPlayers`, every one a HUMAN, the game's own seed, and
 * physical dice (the thrower's faces travel in the state).
 */
export function multiplayerSeatOptions(world: RoomWorld): NewGameOptions {
  const seated =
    world.status === 'started'
      ? world.seats.map((token) => world.members.find((m) => m.token === token))
      : world.members.slice(0, world.maxPlayers)
  if (seated.length < 2) {
    throw new NetError(
      'not_enough_players',
      `"${world.displayName}" has ${seated.length} player(s); a game needs at least 2`,
    )
  }
  const players = seated.map((member, index) => {
    if (member === undefined) {
      throw new NetError('bad_world', `seat ${index} of "${world.displayName}" has no member`)
    }
    const kind: PlayerKind = 'human'
    return {
      name: member.name || `Player ${index + 1}`,
      kind,
      colorId: PLAYER_COLORS[index % PLAYER_COLORS.length]!.id,
    }
  })
  return {
    variantName: world.variant,
    seed: gameSeedFor(world.gameId),
    diceMode: 'physical',
    players,
  }
}

/**
 * An online game is humans only. A state that somehow contains an AI seat is
 * refused LOUDLY rather than played: two clients would each drive the same AI
 * and diverge.
 */
export function assertHumanSeats(state: Pick<GameState, 'players'>): void {
  const ai = state.players.filter((player) => player.kind !== 'human')
  if (ai.length > 0) {
    throw new NetError(
      'ai_seat_unsupported',
      `online seats are people; this game has ${ai.length} AI seat(s): ${ai.map((p) => p.name).join(', ')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

/**
 * The local-only fields of `GameState` — the ones that describe what THIS client
 * is looking at rather than what the game is. Adoption keeps them: a remote move
 * must not deselect the legion I was inspecting.
 *
 * **`legalHexes` deliberately is NOT on this list.** It is DERIVED — "where may
 * the selected legion go, with the current roll, from here" — and preserving it
 * across an adoption keeps a set computed for the PREVIOUS roll and board
 * (ledger row 12). It is recomputed from the ADOPTED state through the engine's
 * ONE rule.
 */
export const LOCAL_UI_FIELDS = ['selectedLegionId'] as const

function preserveLocalUi(next: GameState, local: GameState): void {
  next.selectedLegionId =
    local.selectedLegionId !== null &&
    next.legions.some((legion) => legion.id === local.selectedLegionId)
      ? local.selectedLegionId
      : null
  next.legalHexes = [...getMovesForSelected(next).keys()]
}

/**
 * Adopt a remote state: `deserializeGame` (the ONE deserialiser — it validates
 * the save version, the variant and the state shape, and migrates) plus the
 * local UI fields. `local` may be null (the first adoption).
 */
export function adopt(
  remote: SavedGameBlob,
  local: GameState | null,
  variant: LoadedVariant,
): GameState {
  const next = deserializeGame(remote, variant)
  if (local !== null) preserveLocalUi(next, local)
  return next
}

// ---------------------------------------------------------------------------
// Turn authority
// ---------------------------------------------------------------------------

/** The part of a state turn authority reads — a saved blob's state qualifies too. */
export type TurnView = Pick<
  GameState,
  | 'pendingDice'
  | 'battle'
  | 'pendingPostBattleReinforce'
  | 'legions'
  | 'activeEngagement'
  | 'phase'
  | 'players'
  | 'activePlayerIndex'
>

/**
 * The seats that may act RIGHT NOW. Titan's rule gives one seat the turn, but
 * the engine has places where another seat legitimately acts:
 *
 *  - a **pre-battle engagement** — the defender chooses flee/fight and answers
 *    an agreement, while the active (attacking) seat may propose; and
 *  - a pending physical **throw**, which only its thrower may commit.
 *
 * A battle step belongs to `battle.activePlayerId`, which alternates; the
 * post-battle reinforcement belongs to the defender. Everything else is the
 * active seat. The host enforces this on every move; the engine's own refusal is
 * the backstop.
 */
export function actingPlayerIds(state: TurnView): string[] {
  if (state.pendingDice) return [state.pendingDice.playerId]
  if (state.battle && !state.battle.done) return [state.battle.activePlayerId]
  if (state.pendingPostBattleReinforce) {
    const legion = state.legions.find(
      (l) => l.id === state.pendingPostBattleReinforce!.legionId,
    )
    if (legion) return [legion.playerId]
  }
  if (state.activeEngagement && state.phase === 'Fight') {
    const engagement = state.activeEngagement
    const ids = [engagement.attackerId, engagement.defenderId]
      .map((legionId) => state.legions.find((l) => l.id === legionId)?.playerId)
      .filter((id): id is string => typeof id === 'string')
    return [...new Set(ids)]
  }
  const active = state.players[state.activePlayerIndex]
  return active ? [active.id] : []
}

/** The primary actor — whose turn it is for display. */
export function actingPlayerId(state: TurnView): string {
  return actingPlayerIds(state)[0] ?? ''
}

/** May this player act now? The predicate the board's `interactive` flag uses. */
export function isMyTurn(state: TurnView, playerId: string): boolean {
  return actingPlayerIds(state).includes(playerId)
}

/**
 * Commands that only touch the local UI. They go through the ONE commit path
 * (state is state), but they are NOT sent: selection is preserved on adoption
 * and sending it would bump the shared rev for something nobody else observes.
 */
const LOCAL_ONLY_COMMANDS: ReadonlySet<GameCommand['type']> = new Set([
  'selectLegion',
  'deselectLegion',
  // A refusal message is this client's OWN surface (ledger row 13).
  'notice',
])

export function isSharedCommand(command: GameCommand): boolean {
  return !LOCAL_ONLY_COMMANDS.has(command.type)
}

// ---------------------------------------------------------------------------
// The ONE commit path
// ---------------------------------------------------------------------------

/** Where a shared local change goes. `session.ts`'s `HubSession` is the real one. */
export interface MoveSink {
  /** Send the new state as this client's move. */
  commit(state: GameState): void
}

export interface CommitPathOptions {
  getState: () => GameState | null
  /** The single setter; the ONLY thing that writes the app's game state. */
  setState: (next: GameState) => void
  /** The open online game, or null for hotseat/AI. */
  getSink: () => MoveSink | null
}

export interface CommitPath {
  /**
   * Run a LOCAL reducer (one command) through the one path: state changes AND,
   * for a shared command in an online game with no pending throw, the new state
   * is sent as a move. Returns the new state, or null when nothing changed.
   */
  local(mutator: (prev: GameState) => GameState, command?: GameCommand): GameState | null
  /** Adopt a remote state through the SAME path. NEVER sends. */
  remote(blob: SavedGameBlob, variant: LoadedVariant): GameState
}

/**
 * The app's ONE state-changing seam. Every local command and every remote
 * adoption goes through this object, so no path can change the game state
 * without the send question being asked — and adoption can never send.
 */
export function createCommitPath(options: CommitPathOptions): CommitPath {
  return {
    local(mutator, command) {
      const prev = options.getState()
      if (prev === null) return null
      const next = mutator(prev)
      if (next === prev) return null
      options.setState(next)
      const sink = options.getSink()
      if (sink && (command === undefined || isSharedCommand(command)) && !next.pendingDice) {
        sink.commit(next)
      }
      return next
    },
    remote(blob, variant) {
      const next = adopt(blob, options.getState(), variant)
      options.setState(next)
      return next
    },
  }
}
