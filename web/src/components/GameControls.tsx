import { AI_PROFILES } from '../ai/profiles'
import { engagementNeedsHumanInput } from '../ai/engagementDecision'
import { listBattleReinforceOptions, listBattleSummonSources } from '../engine/battle'
import { canFlee } from '../engine/engagement'
import { activePlayer, playerLegions } from '../engine/GameEngine'
import { publicViewSlots } from '../engine/publicKnowledge'
import type { GameCommand, GameState, Legion } from '../engine/types'
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
  // During engagement reply on an AI mover's turn, do not list every AI stack —
  // the engagement panel shows the attacking legion only.
  const engagementFocus = Boolean(state.activeEngagement && !state.battle)
  const myLegs = engagementFocus ? [] : playerLegions(state, player.id)
  const endLabel = phaseEndLabel(state)
  const endCmd = phaseEndCommand(state)
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
        {interactive && endLabel && !engagementFocus && (
          <p className="hint phase-end-hint">
            {state.phase === 'Muster' && !(state.battle && !state.battle.done)
              ? `Space: ${endLabel} · Enter: muster best for all, then done`
              : `Space / Enter: ${endLabel}`}
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
            <EngagementActions state={state} dispatch={dispatch} />
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
                {state.battle.phase === 'Move' ? ' Undo moves before Done if needed.' : ''}{' '}
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
              {endCmd && (
                <button type="button" className="primary" onClick={() => dispatch(endCmd)}>
                  {state.battle.phase === 'Recruit' || state.battle.phase === 'Summon'
                    ? endLabel
                    : `Done ${state.battle.phase}`}
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

function LegionContents({ state, legion }: { state: GameState; legion: Legion }) {
  const owner = state.players.find((p) => p.id === legion.playerId)!
  return (
    <div className="engagement-legion">
      <div className="selected-head">
        <MarkerChit markerId={legion.markerId} size={36} height={legion.creatures.length} />
        <div>
          <strong>{legion.markerId}</strong>
          <div className="muted">@{legion.hexLabel}</div>
        </div>
      </div>
      <div className="chit-row">
        {publicViewSlots(state, legion).map((slot, i) => {
          if (slot.kind === 'unknown') {
            return <UnknownChit key={`eng-unk-${i}`} size={40} />
          }
          const t = state.variant.creatures[slot.type]
          const power = slot.type === 'Titan' ? owner.titanPower : (t?.power ?? 1)
          return (
            <CreatureChit
              key={`${slot.type}-${i}`}
              creature={slot.type}
              power={power}
              skill={t?.skill ?? 2}
              baseColor={t?.baseColor}
              size={40}
            />
          )
        })}
      </div>
    </div>
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
  const opts = listBattleReinforceOptions(state, battle)
  if (opts.length === 0) return null
  return (
    <div className="recruit-list">
      <p className="hint">Defender reinforce (turn 4):</p>
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
  const sources = listBattleSummonSources(state, battle)
  if (sources.length === 0) return null
  return (
    <div className="recruit-list">
      <p className="hint">Summon an angel from another legion:</p>
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
    </div>
  )
}

/** Role-aware engagement choices — never decide flee/concede for an AI opponent. */
function EngagementActions({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: (cmd: GameCommand) => void
}) {
  const eng = state.activeEngagement!
  const attacker = state.legions.find((l) => l.id === eng.attackerId)
  const defender = state.legions.find((l) => l.id === eng.defenderId)
  if (!attacker || !defender) return null
  const atkP = state.players.find((p) => p.id === attacker.playerId)
  const defP = state.players.find((p) => p.id === defender.playerId)
  const humans = state.players.filter((p) => p.kind === 'human' && !p.dead)
  // Local hotseat: any living human may act for their side
  const humanControlsAttacker = humans.some((h) => h.id === attacker.playerId)
  const humanControlsDefender = humans.some((h) => h.id === defender.playerId)
  const bothHuman = atkP?.kind === 'human' && defP?.kind === 'human'
  const canHumanFlee = humanControlsDefender && canFlee(state, defender)
  const waitingOnHuman = engagementNeedsHumanInput(state)

  const hints: string[] = []
  if (canHumanFlee) hints.push('flee')
  hints.push('fight')
  if (bothHuman) hints.push('agree')

  return (
    <div className="engagement-panel">
      <p className="hint">
        {waitingOnHuman && atkP?.kind === 'ai'
          ? `${atkP.name} attacks with ${attacker.markerId}`
          : `Engagement — ${hints.join(' or ')}`}
        {defP?.kind === 'ai' && humanControlsAttacker ? ' AI declined to flee.' : ''}
      </p>
      <LegionContents state={state} legion={attacker} />
      <div className="engagement-actions">
        {canHumanFlee && (
          <button type="button" onClick={() => dispatch({ type: 'flee' })}>
            Flee
          </button>
        )}
        {bothHuman && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'proposeAgreement', kind: 'mutual' })}
          >
            Propose mutual elimination
          </button>
        )}
        {bothHuman && eng.proposal && eng.proposal !== 'fight' && (
          <>
            <button type="button" onClick={() => dispatch({ type: 'acceptAgreement' })}>
              Accept agreement
            </button>
            <button type="button" onClick={() => dispatch({ type: 'refuseAgreement' })}>
              Refuse
            </button>
          </>
        )}
        {(humanControlsAttacker || humanControlsDefender) && (
          <button
            type="button"
            className="primary"
            onClick={() => dispatch({ type: 'proposeAgreement', kind: 'fight' })}
          >
            Fight!
          </button>
        )}
      </div>
    </div>
  )
}
