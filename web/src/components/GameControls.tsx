import { AI_PROFILES } from '../ai/profiles'
import { activePlayer, getLegalRecruits, playerLegions } from '../engine/GameEngine'
import { publicViewSlots } from '../engine/publicKnowledge'
import type { GameCommand, GameState } from '../engine/types'
import { CreatureChit, UnknownChit } from './CreatureChit'
import {
  phaseEndCommand,
  phaseEndLabel,
  undoCommandForLegion,
  undoLabelForCommand,
} from './LegionActions'
import { MarkerChit } from './MarkerChit'

interface Props {
  state: GameState
  dispatch: (cmd: GameCommand) => void
  /** When false, phase actions are disabled (AI is acting). */
  interactive?: boolean
}

export function GameControls({ state, dispatch, interactive = true }: Props) {
  const player = activePlayer(state)
  const selected = state.selectedLegionId
    ? state.legions.find((l) => l.id === state.selectedLegionId)
    : null
  const myLegs = playerLegions(state, player.id)
  const endLabel = phaseEndLabel(state)
  const endCmd = phaseEndCommand(state)
  const undoCmd =
    selected && selected.playerId === player.id
      ? undoCommandForLegion(state, selected.id)
      : null
  const undoLabel = undoCmd ? undoLabelForCommand(undoCmd) : null

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
        {interactive && endLabel && (
          <p className="hint rmb-hint">Right-click board: {endLabel}</p>
        )}
      </div>

      {selected && (
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
            <button type="button" onClick={() => dispatch(undoCmd)}>
              {undoLabel}
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
                icons show the best muster if you end there. Undo a move from the selected legion.
              </p>
              {state.mulliganAvailable && state.turnNumber === 1 && (
                <button type="button" onClick={() => dispatch({ type: 'mulligan' })}>
                  Mulligan (re-roll)
                </button>
              )}
              {endCmd && (
                <button type="button" className="primary" onClick={() => dispatch(endCmd)}>
                  {endLabel}
                </button>
              )}
            </>
          )}

          {state.phase === 'Fight' && state.activeEngagement && (
            <>
              <p className="hint">Resolve engagement: reveal, flee, agree, concede, or fight.</p>
              <button type="button" onClick={() => dispatch({ type: 'revealEngagement' })}>
                Reveal stacks
              </button>
              <button type="button" onClick={() => dispatch({ type: 'flee' })}>
                Defender flees
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: 'concedeEngagement',
                    loserId: state.activeEngagement!.attackerId,
                  })
                }
              >
                Attacker concedes
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: 'concedeEngagement',
                    loserId: state.activeEngagement!.defenderId,
                  })
                }
              >
                Defender concedes
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'proposeAgreement', kind: 'mutual' })}
              >
                Propose mutual elimination
              </button>
              {state.activeEngagement.proposal && state.activeEngagement.proposal !== 'fight' && (
                <>
                  <button type="button" onClick={() => dispatch({ type: 'acceptAgreement' })}>
                    Accept agreement
                  </button>
                  <button type="button" onClick={() => dispatch({ type: 'refuseAgreement' })}>
                    Refuse
                  </button>
                </>
              )}
              <button
                type="button"
                className="primary"
                onClick={() => dispatch({ type: 'proposeAgreement', kind: 'fight' })}
              >
                Fight!
              </button>
            </>
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
              {endCmd && (
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
                musters show on each legion. Undo a recruit from the selected legion.
              </p>
              {endCmd && (
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
                Time-loss after turn 7: defender wins, no points.
              </p>
              {state.battle.pendingCarry && (
                <div className="recruit-list">
                  <p className="hint">Carry leftover hits to another target:</p>
                  {state.battle.pendingCarry.targetIds.map((tid) => {
                    const u = state.battle!.units.find((x) => x.id === tid)
                    return (
                      <button
                        key={tid}
                        type="button"
                        className="primary"
                        onClick={() => dispatch({ type: 'battleCarry', targetId: tid })}
                      >
                        Carry → {u?.creatureType ?? tid}
                      </button>
                    )
                  })}
                </div>
              )}
              {state.battle.phase === 'Recruit' && (
                <BattleReinforceControls state={state} dispatch={dispatch} />
              )}
              {state.battle.phase === 'Summon' && (
                <BattleSummonControls state={state} dispatch={dispatch} />
              )}
              {state.battle.phase !== 'Recruit' && state.battle.phase !== 'Summon' && endCmd && (
                <button type="button" className="primary" onClick={() => dispatch(endCmd)}>
                  Done {state.battle.phase}
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

      {interactive && (
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

function BattleReinforceControls({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: (cmd: GameCommand) => void
}) {
  const battle = state.battle!
  const def = state.legions.find((l) => l.id === battle.defenderLegionId)
  if (!def) return null
  const opts = getLegalRecruits(
    { ...state, legions: state.legions.map((l) => (l.id === def.id ? { ...l, moved: true } : l)) },
    def.id,
  )
  return (
    <div className="recruit-list">
      <p className="hint">Defender reinforce (turn 4) or skip:</p>
      {opts.map((r) => {
        const t = state.variant.creatures[r]
        return (
          <button
            key={r}
            type="button"
            className="recruit-btn"
            onClick={() => dispatch({ type: 'battleReinforce', creatureType: r })}
          >
            <CreatureChit
              creature={r}
              power={t?.power ?? 1}
              skill={t?.skill ?? 2}
              baseColor={t?.baseColor}
              size={40}
            />
            <span>{r}</span>
          </button>
        )
      })}
      <button type="button" onClick={() => dispatch({ type: 'battleSkipReinforce' })}>
        Skip reinforce
      </button>
    </div>
  )
}

function BattleSummonControls({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: (cmd: GameCommand) => void
}) {
  const battle = state.battle!
  const atk = state.legions.find((l) => l.id === battle.attackerLegionId)
  if (!atk) return null
  const sources = state.legions.filter((l) => {
    if (l.playerId !== atk.playerId || l.id === atk.id) return false
    if (state.legions.some((e) => e.hexLabel === l.hexLabel && e.playerId !== l.playerId)) {
      return false
    }
    return l.creatures.some((c) => state.variant.creatures[c.type]?.summonable)
  })
  return (
    <div className="recruit-list">
      <p className="hint">Summon an angel from another legion, or skip:</p>
      {sources.map((src) => (
        <button
          key={src.id}
          type="button"
          className="primary"
          onClick={() => dispatch({ type: 'battleSummon', fromLegionId: src.id })}
        >
          Summon from {src.markerId}
        </button>
      ))}
      <button type="button" onClick={() => dispatch({ type: 'battleSkipSummon' })}>
        Skip summon
      </button>
    </div>
  )
}
