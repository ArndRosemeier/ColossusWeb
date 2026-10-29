import type { GameState } from '../engine/types'

/** Presentation observes the one immediate game commit; it never controls it. */
export type GamePresentationObserver = (previous: GameState | null, next: GameState | null, replacement?: boolean) => void
