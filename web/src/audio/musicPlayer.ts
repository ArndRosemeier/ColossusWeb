/**
 * Streams the background music files in `public/music` through audio elements.
 * Each scene has its own playlist; a scene change fades the current track out
 * while the next one fades in. Tracks were generated with Google Lyria (see
 * `public/music/README.md`).
 */

export type MusicScene = 'board' | 'battle'

export const PLAYLISTS: Record<MusicScene, readonly string[]> = {
  board: ['board-highlands.mp3', 'board-shepherd.mp3'],
  battle: ['battle-clash.mp3', 'battle-siege.mp3'],
}

const FADE_MS = 1500
const FADE_STEP_MS = 50

interface Channel { audio: HTMLAudioElement; fade: ReturnType<typeof setInterval> | null }

export class MusicPlayer {
  private current: Channel | null = null
  private scene: MusicScene | null = null
  private next: Record<MusicScene, number> = { board: 0, battle: 0 }
  /** Element volume, 0 to 1. */
  private level = 0

  private readonly onError: (message: string) => void

  constructor(onError: (message: string) => void) { this.onError = onError }

  /** Starts (or switches to) the playlist for a scene. */
  play(scene: MusicScene): void {
    if (this.scene === scene && this.current) { this.resume(); return }
    this.scene = scene
    this.fadeOutCurrent()
    this.startTrack(scene)
  }

  /** Sets the playback volume (0 to 1); a running fade-in heads for the new level. */
  setLevel(level: number): void {
    if (!(level >= 0 && level <= 1)) throw new Error(`Invalid music volume: ${level}`)
    this.level = level
    if (this.current && this.current.fade === null) this.current.audio.volume = level
  }

  stop(): void {
    this.fadeOutCurrent()
    this.scene = null
  }

  /** Browsers block audio until the user interacts; retried on the next click or key. */
  resume(): void {
    const audio = this.current?.audio
    if (audio && audio.paused) this.start(audio)
  }

  private startTrack(scene: MusicScene): void {
    const list = PLAYLISTS[scene]
    const file = list[this.next[scene] % list.length]
    this.next[scene] += 1
    const audio = new Audio(`${import.meta.env.BASE_URL}music/${file}`)
    audio.preload = 'auto'
    audio.volume = 0
    const channel: Channel = { audio, fade: null }
    audio.addEventListener('ended', () => {
      if (this.current === channel && this.scene) { this.current = null; this.startTrack(this.scene) }
    })
    audio.addEventListener('error', () => {
      if (this.current === channel) this.onError(`Music file ${file} could not be played.`)
    })
    this.current = channel
    this.start(audio)
    this.fadeTo(channel, () => this.level)
  }

  private start(audio: HTMLAudioElement): void {
    audio.play().catch((error: unknown) => {
      // Autoplay blocked until a gesture is expected; anything else is a real failure.
      if (error instanceof DOMException && error.name === 'NotAllowedError') return
      if (error instanceof DOMException && error.name === 'AbortError') return
      this.onError(`Music could not start: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private fadeOutCurrent(): void {
    const old = this.current
    if (!old) return
    this.current = null
    this.fadeTo(old, 0, () => { old.audio.pause(); old.audio.removeAttribute('src'); old.audio.load() })
  }

  private fadeTo(channel: Channel, targetLevel: number | (() => number), done?: () => void): void {
    if (channel.fade !== null) clearInterval(channel.fade)
    const target = () => (typeof targetLevel === 'number' ? targetLevel : targetLevel())
    const start = channel.audio.volume
    const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS))
    let step = 0
    channel.fade = setInterval(() => {
      step += 1
      channel.audio.volume = Math.min(1, Math.max(0, start + (target() - start) * (step / steps)))
      if (step >= steps) {
        if (channel.fade !== null) clearInterval(channel.fade)
        channel.fade = null
        done?.()
      }
    }, FADE_STEP_MS)
  }
}
