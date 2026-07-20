export type BackgroundAtmosphereId = 'off' | 'ember' | 'wave' | 'ash'

export const BACKGROUND_ATMOSPHERES: Record<
  BackgroundAtmosphereId,
  { label: string; blurb: string }
> = {
  off: { label: 'Off', blurb: 'Static war-table — no motion.' },
  ember: { label: 'Ember', blurb: 'Slow copper and blood glow drift.' },
  wave: { label: 'Wave', blurb: 'Soft copper–teal bands that gently undulate.' },
  ash: { label: 'Ash', blurb: 'Sparse motes rising through the dark.' },
}

const STORAGE_KEY = 'colossus.backgroundAtmosphere'

export const BACKGROUND_ATMOSPHERE_IDS = Object.keys(
  BACKGROUND_ATMOSPHERES,
) as BackgroundAtmosphereId[]

type Listener = (id: BackgroundAtmosphereId) => void

const listeners = new Set<Listener>()
let preferred: BackgroundAtmosphereId = 'ember'
let booted = false

export function isBackgroundAtmosphereId(value: string): value is BackgroundAtmosphereId {
  return value in BACKGROUND_ATMOSPHERES
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function migrateStoredId(raw: string): BackgroundAtmosphereId | null {
  if (isBackgroundAtmosphereId(raw)) return raw
  // Former Hex option → Wave
  if (raw === 'hex') return 'wave'
  return null
}

function readStored(): BackgroundAtmosphereId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const id = migrateStoredId(raw)
      if (id) {
        if (raw !== id) localStorage.setItem(STORAGE_KEY, id)
        return id
      }
    }
  } catch {
    /* private mode */
  }
  // First visit: respect OS reduced-motion as the default only.
  return prefersReducedMotion() ? 'off' : 'ember'
}

function paint(): void {
  // Honor the user's explicit choice — OS reduced-motion only sets the default.
  document.documentElement.dataset.bgAtmosphere = preferred
}

export function getBackgroundAtmosphere(): BackgroundAtmosphereId {
  if (!booted) {
    preferred = readStored()
    booted = true
  }
  return preferred
}

export function setBackgroundAtmosphere(id: BackgroundAtmosphereId): void {
  preferred = id
  booted = true
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* private mode */
  }
  paint()
  for (const fn of listeners) fn(id)
}

/** Apply stored preference. Call once at startup. */
export function initBackgroundAtmosphere(): void {
  preferred = readStored()
  booted = true
  paint()
}

export function subscribeBackgroundAtmosphere(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
