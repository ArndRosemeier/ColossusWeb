import { AI_PROFILES } from '../ai/profiles'
import { activePlayer, canUndoMove, canUndoRecruit, playerLegions } from '../engine/GameEngine'
import { publicViewSlots } from '../engine/publicKnowledge'
import type { GameCommand, GameState } from '../engine/types'
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
}

export function GameControls({
  state,
  dispatch,
  interactive = true,
  pendingStrike = null,
}: Props) {
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

      {showSelected && selected && (
        <div className="selected-legion">
          <div className="selected-head">
            <MarkerChit
              markerId={selected.markerId}
              size={36}
              height={selected.creatures.length}
            />
            <div>
              <strong>{selected.markerId}</strong>
              <div className="muted">@{selected.hexLabel}</div>
            </div>
          </div>
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
                    : 'Click a legion on the board to split beside it. Undo split from the selected legion.'}
              </p>
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
                icons show the best muster if you end there. After moving, Undo appears below.
              </p>
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
                      <MarkerChit markerId={a.markerId} size={28} height={a.creatures.length} />
                    )}
                    <span>vs</span>
                    {d && (
                      <MarkerChit markerId={d.markerId} size={28} height={d.creatures.length} />
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
                Click a legion that moved — recruit choices appear beside it. Best possible
                musters show on each legion. After recruiting, Undo appears on the legion and
                below.
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
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="scores">
        <h3>Scores</h3>
        {state.players.map((p) => (
          <div key={p.id} className="score-row">
            <span className="swatch" style={{ background: p.color.css }} />
            {p.name}{' '}
            {p.kind === 'ai'
              ? `(${p.aiProfileId ? AI_PROFILES[p.aiProfileId].label : 'AI'})`
              : ''}{' '}
            — {p.score}
            {p.dead ? ' ✝' : ''}
          </div>
        ))}
      </div>

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

