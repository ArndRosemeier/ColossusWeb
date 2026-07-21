import { useState } from 'react'
import {
  activePlayer,
  canUndoMove,
  canUndoRecruit,
  canUndoSplit,
  dispatch,
  legionsWithPendingMuster,
} from '../engine/GameEngine'
import { bestRecruit } from '../engine/recruit'
import type { GameCommand, GameState } from '../engine/types'
import { CreatureChit } from './CreatureChit'

/** Split picker — click a chit to move it between parent and new legion. */
export function SplitForm({
  state,
  creatures,
  onSplit,
  turn1 = false,
  compact = false,
}: {
  state: GameState
  creatures: string[]
  onSplit: (child: string[]) => void
  turn1?: boolean
  compact?: boolean
}) {
  /** Indices currently in the new (child) legion; the rest stay on the parent. */
  const [childIdx, setChildIdx] = useState<number[]>([])
  const toggle = (i: number) => {
    setChildIdx((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
  }
  const player = activePlayer(state)
  const childTypes = childIdx.map((i) => creatures[i]!)
  const childLords = childTypes.filter((t) => state.variant.creatures[t]?.lord).length
  const parentCount = creatures.length - childIdx.length
  const legal = turn1
    ? childIdx.length === 4 && childLords === 1
    : childIdx.length >= 2 && parentCount >= 2
  const chitSize = compact ? 40 : 48

  const renderChit = (i: number) => {
    const c = creatures[i]!
    const t = state.variant.creatures[c]
    const power = c === 'Titan' ? player.titanPower : (t?.power ?? 1)
    const inChild = childIdx.includes(i)
    return (
      <button
        key={i}
        type="button"
        className={inChild ? 'chip-chit on' : 'chip-chit'}
        onClick={() => toggle(i)}
        title={inChild ? `Move ${c} back to parent` : `Move ${c} to new legion`}
      >
        <CreatureChit
          creature={c}
          power={power}
          skill={t?.skill ?? 2}
          baseColor={t?.baseColor}
          size={chitSize}
        />
      </button>
    )
  }

  const parentIndices = creatures.map((_, i) => i).filter((i) => !childIdx.includes(i))

  return (
    <div className={`split-form${compact ? ' compact' : ''}`}>
      <div className="split-form-columns">
        <div className="split-form-pile">
          <div className="split-form-pile-label">Stay ({parentCount})</div>
          <div className="split-form-chits">
            {parentIndices.length > 0 ? (
              parentIndices.map(renderChit)
            ) : (
              <span className="split-form-empty">Click a chit below to move it back</span>
            )}
          </div>
        </div>
        <div className="split-form-pile split-form-pile-child">
          <div className="split-form-pile-label">New legion ({childIdx.length})</div>
          <div className="split-form-chits">
            {childIdx.length > 0 ? (
              childIdx.map(renderChit)
            ) : (
              <span className="split-form-empty">Click a chit above to split it off</span>
            )}
          </div>
        </div>
      </div>
      <p className="split-form-hint">
        {turn1
          ? 'Click chits to build a 4:4 split (exactly one Lord each side)'
          : 'Click a chit to move it between stacks · each side needs at least 2'}
      </p>
      <button
        type="button"
        className="primary"
        disabled={!legal}
        onClick={() => onSplit(childTypes)}
      >
        {turn1 ? 'Confirm 4:4 split' : 'Confirm split'}
      </button>
    </div>
  )
}

/** Muster picker — one-click recruit options. */
export function MusterForm({
  state,
  recruits,
  onRecruit,
}: {
  state: GameState
  recruits: string[]
  onRecruit: (creatureType: string) => void
}) {
  return (
    <div className="muster-form">
      <div className="recruit-list">
        {recruits.map((r) => {
          const t = state.variant.creatures[r]
          return (
            <button
              key={r}
              type="button"
              className="recruit-btn"
              onClick={() => onRecruit(r)}
              title={`Recruit ${r}`}
            >
              <CreatureChit
                creature={r}
                power={t?.power ?? 1}
                skill={t?.skill ?? 2}
                baseColor={t?.baseColor}
                size={44}
              />
              <span>{r}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function phaseEndCommand(state: GameState): GameCommand | null {
  if (state.pendingDice) return null
  if (state.battle && !state.battle.done) {
    if (state.battle.pendingCarry) return null
    if (state.battle.phase === 'Recruit') return { type: 'battleSkipReinforce' }
    if (state.battle.phase === 'Summon') return { type: 'battleSkipSummon' }
    return { type: 'battleDonePhase' }
  }
  switch (state.phase) {
    case 'Split':
      return { type: 'doneSplit' }
    case 'Move':
      return { type: 'doneMove' }
    case 'Muster':
      return { type: 'doneMuster' }
    case 'Fight':
      if (!state.activeEngagement && state.pendingEngagements.length === 0) {
        return { type: 'pass' }
      }
      return null
    default:
      return null
  }
}

/**
 * Enter key phase end. Same as Space except Muster: every legion that can
 * still muster takes its best recruit (board preview), then the phase ends.
 * In battle, Space and Enter both advance (skip reinforce/summon when needed).
 */
export function applyEnterKeyPhaseEnd(state: GameState): GameState {
  if (state.pendingDice) return state
  if (state.battle && !state.battle.done) {
    const cmd = phaseEndCommand(state)
    if (!cmd) return state
    return dispatch(state, cmd)
  }
  if (state.phase === 'Muster') {
    let s = state
    for (;;) {
      const pending = legionsWithPendingMuster(s)
      let progressed = false
      for (const leg of pending) {
        const creatureType = bestRecruit(s, leg)
        if (!creatureType) continue
        s = dispatch(s, { type: 'recruit', legionId: leg.id, creatureType })
        progressed = true
        break
      }
      if (!progressed) break
    }
    return dispatch(s, { type: 'doneMuster' })
  }
  const cmd = phaseEndCommand(state)
  if (!cmd) return state
  return dispatch(state, cmd)
}

export function phaseEndLabel(state: GameState): string | null {
  const cmd = phaseEndCommand(state)
  if (!cmd) return null
  switch (cmd.type) {
    case 'doneSplit':
      return 'Done splitting'
    case 'doneMove':
      return 'Done moving'
    case 'doneMuster':
      return 'Done mustering'
    case 'pass':
      return 'Continue to muster'
    case 'battleDonePhase':
      return 'Done with phase'
    case 'battleSkipReinforce':
      return 'Skip reinforce'
    case 'battleSkipSummon':
      return 'Skip summon'
    default:
      return null
  }
}

/** What Space / Enter do right now — null when neither key has an effect. */
export function phaseKeyboardHints(
  state: GameState,
  pendingStrike = false,
): { space: string; enter: string } | null {
  if (state.pendingDice) return null
  if (pendingStrike) {
    return { space: 'Cancel strike announce', enter: 'Cancel strike announce' }
  }
  if (state.battle && !state.battle.done) {
    if (state.battle.pendingCarry) return null
    const label = phaseEndLabel(state)
    if (!label) return null
    return { space: label, enter: label }
  }
  if (state.phase === 'Muster') {
    return {
      space: 'Done mustering',
      enter: 'Muster best for all, then done',
    }
  }
  const label = phaseEndLabel(state)
  if (!label) return null
  return { space: label, enter: label }
}

/** Per-legion undo for the current selection (Colossus-style). */
export function undoCommandForLegion(
  state: GameState,
  legionId: string,
): GameCommand | null {
  if (state.pendingDice) return null
  if (canUndoSplit(state, legionId)) return { type: 'undoSplit', childId: legionId }
  if (canUndoMove(state, legionId)) return { type: 'undoMove', legionId }
  if (canUndoRecruit(state, legionId)) return { type: 'undoRecruit', legionId }
  return null
}

export function undoLabelForCommand(cmd: GameCommand): string | null {
  switch (cmd.type) {
    case 'undoSplit':
      return 'Undo split'
    case 'undoMove':
      return 'Undo move'
    case 'undoRecruit':
      return 'Undo recruit'
    default:
      return null
  }
}
