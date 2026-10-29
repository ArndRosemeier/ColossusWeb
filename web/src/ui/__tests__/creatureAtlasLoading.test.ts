// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('loads an atlas once and rejects missing or incorrectly sized supported artwork loudly', async () => {
  vi.resetModules()
  let requests = 0
  const pending: { onload: () => void; onerror: () => void; naturalWidth: number; naturalHeight: number }[] = []
  vi.stubGlobal('Image', class {
    naturalWidth = 1024
    naturalHeight = 512
    onload = () => {}
    onerror = () => {}
    set src(_value: string) { requests++; pending.push(this) }
  })
  const { CREATURE_ANIMATIONS, loadCreatureAtlas } = await import('../creatureAnimations')
  const resting = loadCreatureAtlas(CREATURE_ANIMATIONS.Ogre.resting)
  expect(loadCreatureAtlas(CREATURE_ANIMATIONS.Ogre.resting)).toBe(resting)
  expect(requests).toBe(1)
  pending[0].onload()
  await expect(resting).resolves.toBeUndefined()

  const missing = loadCreatureAtlas(CREATURE_ANIMATIONS.Ogre.moving)
  pending[1].onerror()
  await expect(missing).rejects.toThrow('Cannot load animated creature artwork: Ogre/moving-atlas.png')

  const malformed = loadCreatureAtlas(CREATURE_ANIMATIONS.Dragon.resting)
  pending[2].onload()
  await expect(malformed).rejects.toThrow('incorrect dimensions: Dragon/resting-atlas.png')
})
