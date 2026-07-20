import type { LoadedVariant } from '../variant/loadVariant'
import type { GameState } from '../engine/types'

export const SAVE_STORAGE_KEY = 'colossusweb.save.v1'
export const SAVE_VERSION = 1 as const

/** GameState without the heavy variant payload (re-attached on load). */
export type SavedGameState = Omit<GameState, 'variant'>

export interface SavedGameBlob {
  version: typeof SAVE_VERSION
  savedAt: string
  variantName: string
  state: SavedGameState
}

export interface SavedGameMeta {
  savedAt: string
  variantName: string
  turnNumber: number
  phase: string
  players: string
}

function stripVariant(state: GameState): SavedGameState {
  const { variant: _variant, ...rest } = state
  return structuredClone(rest)
}

export function serializeGame(state: GameState): SavedGameBlob {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    variantName: state.variant.data.name,
    state: stripVariant(state),
  }
}

export function deserializeGame(blob: SavedGameBlob, variant: LoadedVariant): GameState {
  if (blob.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version: ${String(blob.version)}`)
  }
  if (blob.variantName !== variant.data.name) {
    throw new Error(
      `Save is for variant "${blob.variantName}", but loaded "${variant.data.name}"`,
    )
  }
  const s = blob.state
  if (!Array.isArray(s.players) || !Array.isArray(s.legions) || typeof s.phase !== 'string') {
    throw new Error('Save file is corrupt or incomplete')
  }
  const state = { ...structuredClone(s), variant } as GameState
  if (state.battle && !Array.isArray(state.battle.fallen)) {
    state.battle.fallen = []
  }
  if (state.diceRoll === undefined) {
    state.diceRoll = null
  }
  if (state.pendingDice === undefined) {
    state.pendingDice = null
  }
  if (state.diceMode === undefined) {
    state.diceMode = 'physical'
  }
  if (state.diceRoll && state.diceRoll.playerId === undefined) {
    state.diceRoll.playerId = state.players[state.activePlayerIndex]?.id ?? ''
  }
  return state
}

export function saveGameToLocalStorage(state: GameState): SavedGameBlob {
  const blob = serializeGame(state)
  localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(blob))
  return blob
}

export function readSavedGameBlob(): SavedGameBlob | null {
  const raw = localStorage.getItem(SAVE_STORAGE_KEY)
  if (!raw) return null
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') return null
  const blob = parsed as SavedGameBlob
  if (blob.version !== SAVE_VERSION || !blob.state || typeof blob.savedAt !== 'string') {
    return null
  }
  return blob
}

export function loadGameFromLocalStorage(variant: LoadedVariant): GameState | null {
  const blob = readSavedGameBlob()
  if (!blob) return null
  return deserializeGame(blob, variant)
}

export function clearSavedGame(): void {
  localStorage.removeItem(SAVE_STORAGE_KEY)
}

export function peekSavedGameMeta(): SavedGameMeta | null {
  const blob = readSavedGameBlob()
  if (!blob) return null
  const names = blob.state.players.map((p) => p.name).join(' vs ')
  return {
    savedAt: blob.savedAt,
    variantName: blob.variantName,
    turnNumber: blob.state.turnNumber,
    phase: blob.state.phase,
    players: names,
  }
}
