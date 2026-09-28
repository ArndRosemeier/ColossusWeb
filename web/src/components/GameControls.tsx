import { useState } from 'react'
import { AI_PROFILES } from '../ai/profiles'
import {
  activePlayer,
  canUndoMove,
  canUndoRecruit,
  playerLegions,
  resignRefusalReason,
  undoableSplitChildren,
  unseparatedSplitStacks,
} from '../engine/GameEngine'
import { publicViewSlots } from '../engine/publicKnowledge'
import type { GameCommand, GameState, PlayerState } from '../engine/types'
import { CreatureChit, UnknownChit } from './CreatureChit'
import {
  phaseEndCommand,
  phaseEndLabel,
  phaseKeyboardHints,
  undoCommandForLegion,
  undoLabelForCommand,
} from './LegionActions'
import { MarkerChit } from './MarkerChit'
import { hasBoardDecision, type PendingStrikeAnnounce } from './BoardDecisionOverlay'

export type { PendingStrikeAnnounce }

interface Props {
  state: GameState
  dispatch: (cmd: GameCommand) => void
  /** When false, phase actions are disabled (AI is acting). */
  interactive?: boolean
  /** Melee strike awaiting announced Strike-number (raised for carry). */
  pendingStrike?: PendingStrikeAnnounce | null
  /**
   * The seat this client holds in a multiplayer game; `null` in hotseat, where
   * one person holds every HUMAN side. It decides WHOSE "Give up" is offered —
   * exactly as `BoardDecisionOverlay`'s `myPlayerId` decides whose engagement
   * answer is shown (S8's seat question, not a second authority: this only
   * chooses which player's own control to render, `canResign` still owns WHEN).
   */
  myPlayerId?: string | null
}

/**
 * The human players this client may offer "Give up" for, in seating order.
 *
 * In multiplayer that is only its OWN seat: nobody may resign someone else's
 * game. In hotseat (`myPlayerId === null`) the one local human holds every human
 * side, which is how the app already treats an engagement — so each human still
 * alive gets their own named button.
 */
function resignablePlayers(state: GameState, myPlayerId: string | null): PlayerState[] {
  return state.players.filter(
    (p) => p.kind === 'human' && !p.dead && (myPlayerId === null || p.id === myPlayerId),
  )
}

export interface GiveUpSectionProps {
  state: GameState
  myPlayerId: string | null
  /** The player whose confirmation is being asked, or `null` for the first press. */
  confirmingPlayerId?: string | null
  onPress: (player: PlayerState, confirming: boolean) => void
}

/**
 * GIVE UP — the control, in ONE place, so its wording and its DISABLED state are
 * checkable without a browser (rendered server-side by `giveUp.test.ts`) and the
 * browser check drives exactly this markup.
 *
 * Two statements the panel makes, both from the ENGINE's own predicates:
 *
 *  - **Whose** give-up is offered: this client's own seat in multiplayer, each
 *    human side in hotseat (`resignablePlayers`), exactly as S8's seat question is
 *    answered for the engagement card.
 *  - **Whether** it may be pressed, and why not: `resignRefusalReason` — the ONE
 *    wording of the in-battle refusal. Inside a battle the control is DISABLED
 *    with that sentence beside it (and in its `title`), never silently absent, so
 *    "why can't I give up?" has an answer on screen.
 *
 * The CONFIRMATION is client state, not game state: it changes nothing another
 * client can observe, so it must not be a command and must not publish. The first
 * press asks; the second (the label says `— confirm`) sends the shared command.
 */
export function GiveUpSection({
  state,
  myPlayerId,
  confirmingPlayerId = null,
  onPress,
}: GiveUpSectionProps) {
  const resignables = resignablePlayers(state, myPlayerId)
  return (
    <div className="give-up">
      <h3>Give up</h3>
      {resignables.length === 0 && (
        <p className="hint">No player for this client left to give up.</p>
      )}
      {resignables.map((p) => {
        const refusal = resignRefusalReason(state, p.id)
        const awaiting = confirmingPlayerId === p.id
        const legions = playerLegions(state, p.id)
        return (
          <div key={`give-up-${p.id}`} className="give-up-row">
            <button
              type="button"
              className="danger give-up-btn"
              data-player={p.id}
              disabled={refusal !== null}
              title={refusal ?? `Give up the game as ${p.name} — irreversible`}
              onClick={() => onPress(p, awaiting)}
            >
              {awaiting
                ? `Give up as ${p.name} — confirm`
                : resignables.length > 1
                  ? `Give up (${p.name})`
                  : 'Give up the game'}
            </button>
            {refusal !== null && <span className="muted give-up-refusal">{refusal}</span>}
            {refusal === null && awaiting && (
              <span className="muted give-up-warning">
                Irreversible: every {p.name}&apos;s legion leaves the board
                {legions.length > 0
                  ? ` (${legions.length} legion${legions.length === 1 ? '' : 's'})`
                  : ''}
                ; an engaged enemy scores half their value. Press again to confirm, and the other
                players are told whose game just ended.
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function GameControls({
  state,
  dispatch,
  interactive = true,
  pendingStrike = null,
  myPlayerId = null,
}: Props) {
  // The confirmation is CLIENT state, not game state: it changes nothing anyone
  // else can observe, so it must not be a command and must not publish.
  const [confirmingResign, setConfirmingResign] = useState<string | null>(null)
  const player = activePlayer(state)
  const selected = state.selectedLegionId
    ? state.legions.find((l) => l.id === state.selectedLegionId)
    : null
  // During engagement reply on an AI mover's turn, do not list every AI stack —
  // the engagement panel shows on the board overlay.
  const engagementFocus = Boolean(state.activeEngagement && !state.battle)
  const myLegs = engagementFocus ? [] : playerLegions(state, player.id)
  const endLabel = phaseEndLabel(state)
  const endCmd = phaseEndCommand(state)
  const boardDecision = hasBoardDecision(state, pendingStrike)
  const keyHints = interactive ? phaseKeyboardHints(state, Boolean(pendingStrike)) : null
  // Don't duplicate Done/Skip while a board overlay owns the decision
  const showPhaseEnd =
    Boolean(endCmd) &&
    !(
      state.battle &&
      !state.battle.done &&
      (state.battle.phase === 'Summon' ||
        state.battle.phase === 'Recruit' ||
        state.battle.pendingCarry ||
        pendingStrike)
    ) &&
    !(state.phase === 'Fight' && state.activeEngagement && !state.battle)
  const undoCmd =
    selected && selected.playerId === player.id
      ? undoCommandForLegion(state, selected.id)
      : null
  const undoLabel = undoCmd ? undoLabelForCommand(undoCmd) : null
  const splitStacks = state.phase === 'Move' ? unseparatedSplitStacks(state) : []
  const splitHexes = new Set(splitStacks.map((g) => g.hexLabel))
  // Hide generic selection panel while resolving an engagement (focus on attacker).
  const showSelected = Boolean(selected && !engagementFocus)

  return (
    <aside className="controls">
      <div className="status">
        <div className="turn-line">
          <span className="swatch" style={{ background: player.color.css }} />
          <strong>{player.name}</strong>
          <span className="muted">
            Turn {state.turnNumber} · {state.phase}
            {state.movementRoll != null ? ` · roll ${state.movementRoll}` : ''}
            {player.kind === 'ai' ? ' · AI' : ''}
          </span>
          <span className="player-score-chip" title="Score / Titan power">
            {player.score}
            <span className="muted"> pts</span>
            <span className="score-chip-sep">·</span>
            T{player.titanPower}
          </span>
        </div>
        <p className="message">{state.message}</p>
        {!interactive && player.kind === 'ai' && (
          <p className="hint ai-watching">Watching AI — adjust speed in the top bar.</p>
        )}
        {keyHints && (
          <p className="hint phase-end-hint" aria-live="polite">
            {keyHints.space === keyHints.enter ? (
              <>
                <kbd>Space</kbd> / <kbd>Enter</kbd> — {keyHints.space}
              </>
            ) : (
              <>
                <kbd>Space</kbd> — {keyHints.space}
                <span className="key-hint-sep"> · </span>
                <kbd>Enter</kbd> — {keyHints.enter}
              </>
            )}
          </p>
        )}
      </div>

      <div className="scores">
        <h3>Scores</h3>
        {state.players.map((p) => (
          <div
            key={p.id}
            className={['score-row', p.id === player.id ? 'active' : '', p.dead ? 'dead' : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span className="swatch" style={{ background: p.color.css }} />
            <span className="score-name">
              {p.name}
              {p.kind === 'ai'
                ? ` (${p.aiProfileId ? AI_PROFILES[p.aiProfileId].label : 'AI'})`
                : ''}
              {p.dead ? ' ✝' : ''}
            </span>
            <span className="score-pts">{p.score}</span>
            <span className="score-titan muted" title="Titan power">
              T{p.titanPower}
            </span>
          </div>
        ))}
      </div>

      {showSelected && selected && (
        <div className="selected-legion">
          <div className="selected-head">
            <MarkerChit
              markerId={selected.markerId}
              color={state.players.find((p) => p.id === selected.playerId)?.color.css}
              size={36}
              height={selected.creatures.length}
            />
            <div>
              <strong>{selected.markerId}</strong>
              <div className="muted">@{selected.hexLabel}</div>
            </div>
          </div>
          {selected.playerId !== player.id && selected.musteredThisTurn ? (
            <p className="hint last-muster">
              Last muster: {selected.musteredThisTurn} @{selected.hexLabel}
            </p>
          ) : null}
          <div className="chit-row">
            {publicViewSlots(state, selected).map((slot, i) => {
              if (slot.kind === 'unknown') {
                return <UnknownChit key={`unk-${i}`} size={48} />
              }
              const t = state.variant.creatures[slot.type]
              const owner = state.players.find((p) => p.id === selected.playerId)!
              const power = slot.type === 'Titan' ? owner.titanPower : (t?.power ?? 1)
              return (
                <CreatureChit
                  key={`${slot.type}-${i}`}
                  creature={slot.type}
                  power={power}
                  skill={t?.skill ?? 2}
                  baseColor={t?.baseColor}
                  size={48}
                />
              )
            })}
          </div>
          {interactive && undoCmd && undoLabel && (
            <button
              type="button"
              className={
                undoCmd.type === 'undoRecruit' || undoCmd.type === 'undoMove'
                  ? 'primary'
                  : undefined
              }
              onClick={() => dispatch(undoCmd)}
            >
              {undoLabel}
              {undoCmd.type === 'undoRecruit' && selected?.musteredThisTurn
                ? ` (${selected.musteredThisTurn})`
                : ''}
              {undoCmd.type === 'undoMove' && selected?.moveOriginHex
                ? ` → ${selected.moveOriginHex}`
                : ''}
            </button>
          )}
        </div>
      )}

      {interactive && (
        <div className="phase-actions">
          {state.phase === 'Split' && (
            <>
              <p className="hint">
                {state.turnNumber === 1
                  ? 'Turn 1: click your legion, pick 4 with one Lord on the board overlay.'
                  : player.markersAvailable.length === 0
                    ? 'No free legion markers (12-legion limit). You cannot split until a legion is eliminated.'
                    : 'Click a legion to open the split board — click chits to move them between stacks. Undo split if you want a different split.'}
              </p>
              {undoableSplitChildren(state).map((l) => (
                <button
                  key={`undo-split-${l.id}`}
                  type="button"
                  onClick={() => dispatch({ type: 'undoSplit', childId: l.id })}
                >
                  Undo {l.markerId} split
                </button>
              ))}
              {endCmd && (
                <button type="button" className="primary" onClick={() => dispatch(endCmd)}>
                  {endLabel}
                </button>
              )}
            </>
          )}

          {state.phase === 'Move' && (
            <>
              <p className="hint">
                Select a legion to highlight moves. Copper = walk, violet = teleport; creature
                icons show the best muster if you end there. Click an enemy legion to preview
                where it can walk on rolls 1–6 (number on the hex). After moving, Undo appears
                below.
              </p>
              {splitStacks.map((g) => (
                <p key={`split-warn-${g.hexLabel}`} className="hint split-must-leave">
                  Split stacks on hex {g.hexLabel} must separate:{' '}
                  {g.legions.map((l) => l.markerId).join(' & ')}. Move one away.
                </p>
              ))}
              {state.mulliganAvailable && state.turnNumber === 1 && (
                <button type="button" onClick={() => dispatch({ type: 'mulligan' })}>
                  Mulligan (re-roll)
                </button>
              )}
              {myLegs
                .filter((l) => canUndoMove(state, l.id))
                .map((l) => (
                  <button
                    key={`undo-move-${l.id}`}
                    type="button"
                    onClick={() => dispatch({ type: 'undoMove', legionId: l.id })}
                  >
                    Undo {l.markerId} move
                    {l.moveOriginHex ? ` → ${l.moveOriginHex}` : ''}
                  </button>
                ))}
              {endCmd && (
                <button type="button" className="primary" onClick={() => dispatch(endCmd)}>
                  {endLabel}
                </button>
              )}
            </>
          )}

          {state.phase === 'Fight' && state.activeEngagement && (
            <p className="hint">Resolve the engagement on the board.</p>
          )}

          {state.phase === 'Fight' && !state.activeEngagement && (
            <>
              <p className="hint">Start an engagement or continue.</p>
              {state.pendingEngagements.map((e) => {
                const a = state.legions.find((l) => l.id === e.attackerId)
                const d = state.legions.find((l) => l.id === e.defenderId)
                return (
                  <button
                    key={`${e.attackerId}-${e.defenderId}`}
                    type="button"
                    className="primary fight-btn"
                    onClick={() =>
                      dispatch({
                        type: 'startEngagement',
                        attackerId: e.attackerId,
                        defenderId: e.defenderId,
                      })
                    }
                  >
                    {a && (
                      <MarkerChit
                        markerId={a.markerId}
                        color={state.players.find((p) => p.id === a.playerId)?.color.css}
                        size={28}
                        height={a.creatures.length}
                      />
                    )}
                    <span>vs</span>
                    {d && (
                      <MarkerChit
                        markerId={d.markerId}
                        color={state.players.find((p) => p.id === d.playerId)?.color.css}
                        size={28}
                        height={d.creatures.length}
                      />
                    )}
                  </button>
                )
              })}
              {showPhaseEnd && endCmd && (
                <button type="button" onClick={() => dispatch(endCmd)}>
                  {endLabel}
                </button>
              )}
            </>
          )}

          {state.phase === 'Muster' && (
            <>
              <p className="hint">
                Click a legion that moved — recruit choices appear beside it. Enter auto-musters
                only when the recruit is obvious; real choices (e.g. third Cyclops vs Gorgon)
                stay for you. After recruiting, the stack dims and Undo appears.
              </p>
              {myLegs
                .filter((l) => canUndoRecruit(state, l.id))
                .map((l) => (
                  <button
                    key={`undo-muster-${l.id}`}
                    type="button"
                    onClick={() => dispatch({ type: 'undoRecruit', legionId: l.id })}
                  >
                    Undo {l.markerId} recruit ({l.musteredThisTurn})
                  </button>
                ))}
              {showPhaseEnd && endCmd && (
                <button type="button" className="primary" onClick={() => dispatch(endCmd)}>
                  {endLabel}
                </button>
              )}
            </>
          )}

          {state.battle && !state.battle.done && (
            <>
              <p className="hint">
                Battle turn {state.battle.turn}/7 ({state.battle.activeHalf}) — {state.battle.phase}.
                {state.battle.phase === 'Move' ? ' Undo moves before Done if needed.' : ''}{' '}
                {boardDecision ? 'Choose on the board overlay.' : ''} Time-loss after turn 7:
                defender wins, no points.
              </p>
              {state.battle.phase === 'Move' &&
                state.battle.moveStack &&
                state.battle.moveStack.length > 0 && (
                <div className="battle-undo-row">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'battleUndoLastMove' })}
                  >
                    Undo last move
                  </button>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'battleUndoAllMoves' })}
                  >
                    Undo all moves
                  </button>
                </div>
              )}
              {showPhaseEnd && endCmd && (
                <button type="button" className="primary" onClick={() => dispatch(endCmd)}>
                  {`Done ${state.battle.phase}`}
                </button>
              )}
              <button
                type="button"
                className="danger"
                onClick={() => dispatch({ type: 'concedeBattle' })}
              >
                Concede
              </button>
            </>
          )}
        </div>
      )}

      {/*
        GIVE UP — outside battles, the owner's own scope. It is a SHARED command
        (`resign`), published like any other; the confirmation is client state
        (see `GiveUpSection`).
      */}
      {interactive && (
        <GiveUpSection
          state={state}
          myPlayerId={myPlayerId}
          confirmingPlayerId={confirmingResign}
          onPress={(p, confirming) => {
            if (!confirming) {
              setConfirmingResign(p.id)
              return
            }
            setConfirmingResign(null)
            dispatch({ type: 'resign', playerId: p.id })
          }}
        />
      )}

      {interactive && myLegs.length > 0 && (
        <div className="legion-list">
          <h3>Your legions</h3>
          {myLegs.map((leg) => {
            const owner = state.players.find((p) => p.id === leg.playerId)!
            return (
              <button
                key={leg.id}
                type="button"
                className={leg.id === state.selectedLegionId ? 'legion selected' : 'legion'}
                onClick={() => dispatch({ type: 'selectLegion', legionId: leg.id })}
              >
                <MarkerChit
                  className="legion-marker"
                  markerId={leg.markerId}
                  color={owner.color.css}
                  size={32}
                  height={leg.creatures.length}
                />
                <span className="legion-body">
                  <strong>
                    {leg.markerId} @{leg.hexLabel}
                  </strong>
                  <span className="mini-chits">
                    {leg.creatures.map((c, i) => {
                      const t = state.variant.creatures[c.type]
                      const power = c.type === 'Titan' ? owner.titanPower : (t?.power ?? 1)
                      return (
                        <CreatureChit
                          key={`${leg.id}-${i}`}
                          creature={c.type}
                          power={power}
                          skill={t?.skill ?? 2}
                          baseColor={t?.baseColor}
                          size={28}
                        />
                      )
                    })}
                  </span>
                  {leg.moved ? <span className="muted">moved</span> : null}
                  {state.phase === 'Move' && splitHexes.has(leg.hexLabel) && !leg.moved ? (
                    <span className="must-leave">must leave</span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="log">
        <h3>Log</h3>
        <ul>
          {[...state.log].slice(-12).reverse().map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

