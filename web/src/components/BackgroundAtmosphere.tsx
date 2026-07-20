import { useSyncExternalStore } from 'react'
import {
  BACKGROUND_ATMOSPHERE_IDS,
  BACKGROUND_ATMOSPHERES,
  getBackgroundAtmosphere,
  setBackgroundAtmosphere,
  subscribeBackgroundAtmosphere,
  type BackgroundAtmosphereId,
} from '../ui/backgroundAtmosphere'

const ASH_MOTES = [
  { left: '5%', delay: '0s', duration: '14s', size: 5 },
  { left: '12%', delay: '2s', duration: '16s', size: 4 },
  { left: '19%', delay: '5s', duration: '13s', size: 6 },
  { left: '27%', delay: '1s', duration: '17s', size: 4.5 },
  { left: '34%', delay: '7s', duration: '15s', size: 5.5 },
  { left: '42%', delay: '3s', duration: '18s', size: 4 },
  { left: '50%', delay: '9s', duration: '14s', size: 6 },
  { left: '57%', delay: '4s', duration: '16s', size: 4.5 },
  { left: '64%', delay: '11s', duration: '13s', size: 5 },
  { left: '72%', delay: '2.5s', duration: '17s', size: 5.5 },
  { left: '79%', delay: '6s', duration: '15s', size: 4 },
  { left: '86%', delay: '8s', duration: '14s', size: 6 },
  { left: '93%', delay: '1.5s', duration: '16s', size: 4.5 },
  { left: '8%', delay: '10s', duration: '19s', size: 3.5 },
  { left: '46%', delay: '12s', duration: '12s', size: 5 },
  { left: '68%', delay: '13s', duration: '18s', size: 3.5 },
  { left: '23%', delay: '14s', duration: '15s', size: 4 },
  { left: '88%', delay: '15s', duration: '13s', size: 5 },
] as const

function usePreferredAtmosphere(): BackgroundAtmosphereId {
  return useSyncExternalStore(
    subscribeBackgroundAtmosphere,
    getBackgroundAtmosphere,
    getBackgroundAtmosphere,
  )
}

/** Fixed atmosphere layers. Mount once beside App. CSS is driven by html[data-bg-atmosphere]. */
export function BackgroundAtmosphere() {
  return (
    <div className="bg-atmosphere" aria-hidden="true">
      <div className="bg-hex-lattice" />
      <div className="bg-waves">
        <div className="bg-wave bg-wave-a" />
        <div className="bg-wave bg-wave-b" />
        <div className="bg-wave bg-wave-c" />
        <svg className="bg-wave-ribbons" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true">
          <path
            className="bg-wave-path bg-wave-path-a"
            d="M-100 120 C 100 40, 200 200, 400 120 S 700 40, 900 130 S 1100 200, 1300 110"
          />
          <path
            className="bg-wave-path bg-wave-path-b"
            d="M-100 220 C 80 160, 260 280, 440 210 S 720 150, 900 230 S 1080 290, 1300 200"
          />
          <path
            className="bg-wave-path bg-wave-path-c"
            d="M-100 300 C 120 250, 280 350, 460 290 S 740 240, 920 310 S 1100 360, 1300 280"
          />
        </svg>
      </div>
      <div className="bg-ember-orb bg-ember-orb-a" />
      <div className="bg-ember-orb bg-ember-orb-b" />
      <div className="bg-ember-orb bg-ember-orb-c" />
      <div className="bg-ash">
        {ASH_MOTES.map((m, i) => (
          <span
            key={i}
            className="bg-ash-mote"
            style={{
              left: m.left,
              animationDelay: m.delay,
              animationDuration: m.duration,
              width: m.size,
              height: m.size,
            }}
          />
        ))}
      </div>
    </div>
  )
}

interface SelectProps {
  className?: string
  showBlurb?: boolean
}

export function BackgroundAtmosphereSelect({ className, showBlurb = false }: SelectProps) {
  const mode = usePreferredAtmosphere()

  return (
    <label className={className ?? 'bg-atmosphere-select'}>
      <span className="muted">Background</span>
      <select
        value={mode}
        aria-label="Background atmosphere"
        onChange={(e) => setBackgroundAtmosphere(e.target.value as BackgroundAtmosphereId)}
      >
        {BACKGROUND_ATMOSPHERE_IDS.map((id) => (
          <option key={id} value={id}>
            {BACKGROUND_ATMOSPHERES[id].label}
          </option>
        ))}
      </select>
      {showBlurb && <p className="hint bg-atmosphere-blurb">{BACKGROUND_ATMOSPHERES[mode].blurb}</p>}
    </label>
  )
}
