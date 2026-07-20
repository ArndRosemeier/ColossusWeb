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

/** Split picker — toggle creatures to send into the new legion. */
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
  const [picked, setPicked] = useState<number[]>([])
  const toggle = (i: number) => {
    setPicked((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
  }
  const player = activePlayer(state)
  const selectedTypes = picked.map((i) => creatures[i]!)
  const childLords = selectedTypes.filter((t) => state.variant.creatures[t]?.lord).length
  const legal = turn1
    ? picked.length === 4 && childLords === 1
    : picked.length >= 2 && creatures.length - picked.length >= 2
  const chitSize = compact ? 40 : 48

  return (
    <div className={`split-form${compact ? ' compact' : ''}`}>
      <div className="split-form-chits">
        {creatures.map((c, i) => {
          const t = state.variant.creatures[c]
          const power = c === 'Titan' ? player.titanPower : (t?.power ?? 1)
          return (
            <button
              key={i}
              type="button"
              className={picked.includes(i) ? 'chip-chit on' : 'chip-chit'}
              onClick={() => toggle(i)}
              title={picked.includes(i) ? `Keep ${c} in parent` : `Split off ${c}`}
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
        })}
      </div>
      <p className="split-form-hint">
        {turn1
          ? 'Pick 4 with exactly one Lord'
          : `Split off ${picked.length || '…'} · keep ${creatures.length - picked.length}`}
      </p>
      <button type="button" className="primary" disabled={!legal} onClick={() => onSplit(selectedTypes)}>
        {turn1 ? 'Split 4:4' : 'Split off selected'}
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
