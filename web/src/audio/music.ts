import { useEffect, useSyncExternalStore } from 'react'
import { MusicPlayer, type MusicScene } from './musicPlayer'

/**
 * Application-wide LOCAL music volume (0 to 100, default 0 = silent), the current music
 * scene and the last playback error. The one seam between the UI and the player.
 */
const STORAGE_KEY = 'colossus.musicVolume'
const listeners = new Set<() => void>()
let volume: number | undefined
let scene: MusicScene = 'board'
let error: string | null = null
let player: MusicPlayer | null = null
let unlockInstalled = false
let initialized = false

export function isMusicSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Audio === 'function'
}

export function isMusicVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
}

/** Slider value, 0 (silent, the default) to 100. */
export function getMusicVolume(): number {
  if (volume === undefined) {
    let stored: string | null = null
    try { stored = localStorage.getItem(STORAGE_KEY) } catch { /* Optional preference unavailable. */ }
    const parsed = stored === null || stored.trim() === '' ? NaN : Number(stored)
    volume = isMusicVolume(parsed) ? parsed : 0
  }
  return volume
}

export function getMusicError(): string | null { return error }

export function setMusicVolume(next: number): void {
  if (!isMusicVolume(next)) throw new Error(`Invalid music volume: ${next}`)
  if (next === volume) return
  volume = next
  error = null
  try { localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* Still usable for this session. */ }
  notify()
  sync()
}

function notify(): void { for (const listener of listeners) listener() }

export function subscribeMusic(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useMusicVolume(): number {
  return useSyncExternalStore(subscribeMusic, getMusicVolume, getMusicVolume)
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
  const level = getMusicVolume()
  if (level === 0) {
    player?.stop()
    return
  }
  // Unsupported browsers show the Music slider disabled with the reason.
  if (!isMusicSupported()) return
  installGestureUnlock()
  player ??= new MusicPlayer(message => { error = message; notify() })
  // Squared so the slider feels even to the ear.
  player.setLevel((level / 100) ** 2)
  player.play(scene)
}

/**
 * Browsers block audio until the user interacts with the page. When music was
 * left on from an earlier visit, the first click or key starts it.
 */
function installGestureUnlock(): void {
  if (unlockInstalled) return
  unlockInstalled = true
  const unlock = () => { if (getMusicVolume() > 0) player?.resume() }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}
