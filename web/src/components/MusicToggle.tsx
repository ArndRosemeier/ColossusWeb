import { isMusicSupported, setMusicEnabled, useMusicEnabled, useMusicError } from '../audio/music'

/** One native checkbox for the shared local music preference (off by default). */
export function MusicToggle({ className }: { className?: string }) {
  const on = useMusicEnabled()
  const error = useMusicError()
  const supported = isMusicSupported()
  const title = !supported ? 'This browser cannot play audio, so music is unavailable.'
    : error ?? 'Play background music: calm melodies on the main board, faster ones in battle.'
  return (
    <label className={`presentation-mode-toggle${className ? ` ${className}` : ''}`} title={title}>
      <input type="checkbox" aria-label="Sound" checked={on && supported} disabled={!supported}
        onChange={event => setMusicEnabled(event.currentTarget.checked)} />
      <span>Sound</span>
      {error && <span className="music-error" role="alert">{error}</span>}
    </label>
  )
}
