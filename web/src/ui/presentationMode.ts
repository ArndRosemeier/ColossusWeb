import { useSyncExternalStore } from 'react'

/** Application-wide LOCAL presentation preference. Never part of a game or command. */
export type PresentationMode = 'classic' | 'animated'
const STORAGE_KEY = 'colossus.presentationMode'
const listeners = new Set<() => void>()
let preferred: PresentationMode | undefined

export function isPresentationMode(value: unknown): value is PresentationMode {
  return value === 'classic' || value === 'animated'
}

export function getPresentationMode(): PresentationMode {
  if (preferred === undefined) {
    let stored: unknown
    try { stored = localStorage.getItem(STORAGE_KEY) } catch { /* Optional preference unavailable. */ }
    preferred = isPresentationMode(stored) ? stored : 'animated'
  }
  return preferred
}

export function setPresentationMode(mode: PresentationMode): void {
  if (!isPresentationMode(mode)) throw new Error(`Invalid presentation mode: ${mode}`)
  preferred = mode
  try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* Still usable for this session. */ }
  for (const listener of listeners) listener()
}

export function subscribePresentationMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function usePresentationMode(): PresentationMode {
  // The client app has no SSR server; static renderers still read the same
  // available preference/default instead of injecting a Classic placeholder.
  return useSyncExternalStore(subscribePresentationMode, getPresentationMode, getPresentationMode)
}
