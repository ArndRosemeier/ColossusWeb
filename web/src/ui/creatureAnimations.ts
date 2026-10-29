import registry from './creatureAnimationRegistry.json'

export type CreatureAnimationState = 'resting' | 'moving' | 'attacking'
export interface CreatureTimeline {
  atlas: string
  columns: number
  rows: number
  frameSize: number
  durations: number[]
}
export type CreatureAnimations = Record<CreatureAnimationState, CreatureTimeline>

/** Tiny metadata only; PNGs are requested solely by mounted animated renderers. */
export const CREATURE_ANIMATIONS: Readonly<Record<string, CreatureAnimations>> = registry

export function hasCreatureAnimation(creature: string): boolean {
  return Object.hasOwn(CREATURE_ANIMATIONS, creature)
}

export function creatureAtlasUrl(timeline: CreatureTimeline): string {
  return `${import.meta.env.BASE_URL}creature-animations/${timeline.atlas}`
}

const images = new Map<string, Promise<void>>()

/** One request/decode per atlas. A missing or malformed image is a visible failure. */
export function loadCreatureAtlas(timeline: CreatureTimeline): Promise<void> {
  const url = creatureAtlasUrl(timeline)
  let promise = images.get(url)
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        if (image.naturalWidth !== timeline.columns * timeline.frameSize || image.naturalHeight !== timeline.rows * timeline.frameSize) {
          reject(new Error(`Animated creature atlas has incorrect dimensions: ${timeline.atlas}`))
        } else resolve()
      }
      image.onerror = () => reject(new Error(`Cannot load animated creature artwork: ${timeline.atlas}`))
      image.src = url
    })
    images.set(url, promise)
  }
  return promise
}
