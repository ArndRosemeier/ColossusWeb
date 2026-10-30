import { isMusicSupported, setMusicVolume, useMusicError, useMusicVolume } from '../audio/music'

/** Background music volume slider for the shared local preference (0 = silent, the default). */
export function MusicVolume({ className }: { className?: string }) {
  const volume = useMusicVolume()
  const error = useMusicError()
  const supported = isMusicSupported()
  const title = !supported ? 'This browser cannot play audio, so music is unavailable.'
    : error ?? 'Background music volume: calm tracks on the main board, faster ones in battle. 0 turns it off.'
  return (
    <label className={`music-volume${className ? ` ${className}` : ''}`} title={title}>
      <span>Music</span>
      <input type="range" min={0} max={100} step={1} aria-label="Music volume"
        value={supported ? volume : 0} disabled={!supported}
        onChange={event => setMusicVolume(Number(event.currentTarget.value))} />
      {error && <span className="music-error" role="alert">{error}</span>}
    </label>
  )
}
