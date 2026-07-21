/**
 * Mandatory decisions that block play — shown over the board, not buried in the sidebar.
 */
import type { ReactNode } from 'react'
import { engagementNeedsHumanInput } from '../ai/engagementDecision'
import { battleLand, listBattleReinforceOptions, listBattleSummonSources } from '../engine/battle'
import { listStrikeRaiseOptions } from '../engine/battleStrike'
import { canFlee } from '../engine/engagement'
import { publicViewSlots } from '../engine/publicKnowledge'
import type { GameCommand, GameState, Legion } from '../engine/types'
import { CreatureChit, UnknownChit } from './CreatureChit'
import { MarkerChit } from './MarkerChit'

export type PendingStrikeAnnounce = {
  attackerId: string
  defenderId: string
}

interface Props {
  state: GameState
  dispatch: (cmd: GameCommand) => void
  interactive?: boolean
  pendingStrike?: PendingStrikeAnnounce | null
  onCancelPendingStrike?: () => void
}

export function hasBoardDecision(
  state: GameState,
  pendingStrike?: PendingStrikeAnnounce | null,
): boolean {
  if (engagementNeedsHumanInput(state)) return true
  const battle = state.battle
  if (!battle || battle.done) return false
  if (battle.pendingCarry) return true
  if (pendingStrike) return true
  if (battle.phase === 'Summon' || battle.phase === 'Recruit') return true
  return false
}

export function BoardDecisionOverlay({
  state,
  dispatch,
  interactive = true,
  pendingStrike = null,
  onCancelPendingStrike,
}: Props) {
  if (!interactive) return null

  const engagement = engagementNeedsHumanInput(state) ? (
    <EngagementCard state={state} dispatch={dispatch} />
  ) : null

  let battleCard: ReactNode = null
  const battle = state.battle
  if (battle && !battle.done) {
    if (battle.pendingCarry) {
      battleCard = <CarryCard state={state} dispatch={dispatch} />
    } else if (pendingStrike) {
      battleCard = (
        <StrikeAnnounceCard
          state={state}
          dispatch={dispatch}
          pending={pendingStrike}
          onCancel={onCancelPendingStrike}
        />
      )
    } else if (battle.phase === 'Summon') {
      battleCard = <SummonCard state={state} dispatch={dispatch} />
    } else if (battle.phase === 'Recruit') {
      battleCard = <ReinforceCard state={state} dispatch={dispatch} />
    }
  }

  const card = engagement ?? battleCard
  if (!card) return null

  return (
    <div className="board-decision-overlay" role="dialog" aria-modal="true">
      <div className="board-decision-card">{card}</div>
    </div>
  )
}

function CarryCard({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: (cmd: GameCommand) => void
}) {
  const pending = state.battle!.pendingCarry!
  return (
    <>
      <h3 className="board-decision-title">Carry leftover hits</h3>
      <p className="hint">Choose an adjacent target for the extra damage.</p>
      <div className="recruit-list">
        {pending.targetIds.map((tid) => {
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
    </>
  )
}

function StrikeAnnounceCard({
  state,
  dispatch,
  pending,
  onCancel,
}: {
  state: GameState
  dispatch: (cmd: GameCommand) => void
  pending: PendingStrikeAnnounce
  onCancel?: () => void
}) {
  const battle = state.battle!
  const atk = battle.units.find((u) => u.id === pending.attackerId)
  const def = battle.units.find((u) => u.id === pending.defenderId)
  if (!atk || !def) return null
  const land = battleLand(state, battle)
  const { naturalNeed, options } = listStrikeRaiseOptions(state, battle, land, atk, def)
  const nameOf = (id: string) => battle.units.find((u) => u.id === id)?.creatureType ?? id
  return (
    <>
      <h3 className="board-decision-title">Announce strike</h3>
      <p className="hint">
        {atk.creatureType} → {def.creatureType}. Raise the Strike-number to allow carry onto
        harder adjacent targets.
      </p>
      <div className="recruit-list">
        <button
          type="button"
          className="primary"
          onClick={() =>
            dispatch({
              type: 'battleStrike',
              attackerId: pending.attackerId,
              defenderId: pending.defenderId,
            })
          }
        >
          Need {naturalNeed}+ (normal)
        </button>
        {options.map((opt) => (
          <button
            key={opt.need}
            type="button"
            onClick={() =>
              dispatch({
                type: 'battleStrike',
                attackerId: pending.attackerId,
                defenderId: pending.defenderId,
                raisedStrikeNumber: opt.need,
              })
            }
          >
            Raise to {opt.need}+ (carry → {opt.newlyEnabledIds.map(nameOf).join(', ')})
          </button>
        ))}
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </>
  )
}

function SummonCard({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: (cmd: GameCommand) => void
}) {
  const sources = listBattleSummonSources(state, state.battle!)
  return (
    <>
      <h3 className="board-decision-title">Summon angel</h3>
      <p className="hint">Bring an angel from another legion, or skip.</p>
      <div className="recruit-list">
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
    </>
  )
}

function ReinforceCard({
  state,
  dispatch,
}: {
  state: GameState
  dispatch: (cmd: GameCommand) => void
}) {
  const opts = listBattleReinforceOptions(state, state.battle!)
  return (
    <>
      <h3 className="board-decision-title">Defender reinforce</h3>
      <p className="hint">Turn 4 — muster a reinforcement, or skip.</p>
      <div className="recruit-list">
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
    </>
  )
}

function LegionContents({
  state,
  legion,
  tone = 'attack',
}: {
  state: GameState
  legion: Legion
  tone?: 'attack' | 'defend'
}) {
  const owner = state.players.find((p) => p.id === legion.playerId)!
  return (
    <div className={`engagement-legion engagement-legion--${tone}`}>
      <div className="selected-head">
        <MarkerChit
          markerId={legion.markerId}
          color={owner.color.css}
          size={36}
          height={legion.creatures.length}
        />
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

function EngagementCard({
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
    <>
      <h3 className="board-decision-title">Engagement</h3>
      <p className="hint">
        {waitingOnHuman && atkP?.kind === 'ai'
          ? `${atkP.name} attacks with ${attacker.markerId}`
          : `Choose how to resolve — ${hints.join(' or ')}`}
        {defP?.kind === 'ai' && humanControlsAttacker ? ' AI declined to flee.' : ''}
      </p>
      <p className="hint muted">
        {humanControlsAttacker ? 'Your legion (attacker)' : 'Attacker'}
      </p>
      <LegionContents state={state} legion={attacker} tone="attack" />
      <p className="hint muted">
        {humanControlsDefender ? 'Your legion (defender)' : 'Defender'}
      </p>
      <LegionContents state={state} legion={defender} tone="defend" />
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
    </>
  )
}
