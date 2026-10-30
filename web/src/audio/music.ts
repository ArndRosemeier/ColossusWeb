import { useEffect, useSyncExternalStore } from 'react'
import { MusicPlayer, type MusicScene } from './musicPlayer'

/**
 * Application-wide LOCAL music preference (off by default), the current music
 * scene and the last playback error. The one seam between the UI and the player.
 */
const STORAGE_KEY = 'colossus.music'
const listeners = new Set<() => void>()
let enabled: boolean | undefined
let scene: MusicScene = 'board'
let error: string | null = null
let player: MusicPlayer | null = null
let unlockInstalled = false
let initialized = false

export function isMusicSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Audio === 'function'
}

export function getMusicEnabled(): boolean {
  if (enabled === undefined) {
    let stored: unknown
    try { stored = localStorage.getItem(STORAGE_KEY) } catch { /* Optional preference unavailable. */ }
    enabled = stored === 'on'
  }
  return enabled
}

export function getMusicError(): string | null { return error }

export function setMusicEnabled(on: boolean): void {
  enabled = on
  error = null
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off') } catch { /* Still usable for this session. */ }
  notify()
  sync()
}

function notify(): void { for (const listener of listeners) listener() }

export function subscribeMusic(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useMusicEnabled(): boolean {
  return useSyncExternalStore(subscribeMusic, getMusicEnabled, getMusicEnabled)
}

export function useMusicError(): string | null {
  return useSyncExternalStore(subscribeMusic, getMusicError, getMusicError)
}

/** Tells the music which part of the game is on screen. */
export function useMusicScene(next: MusicScene): void {
  useEffect(() => {
    if (scene === next && initialized) return
    // The first mounted screen also starts music left on from an earlier visit.
    initialized = true
    scene = next
    sync()
  }, [next])
}

function sync(): void {
  if (!getMusicEnabled()) {
    player?.stop()
    return
  }
  // Unsupported browsers show the Sound checkbox disabled with the reason.
  if (!isMusicSupported()) return
  installGestureUnlock()
  player ??= new MusicPlayer(message => { error = message; notify() })
  player.play(scene)
}

/**
 * Browsers block audio until the user interacts with the page. When music was
 * left on from an earlier visit, the first click or key starts it.
 */
function installGestureUnlock(): void {
  if (unlockInstalled) return
  unlockInstalled = true
  const unlock = () => { if (getMusicEnabled()) player?.resume() }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}
