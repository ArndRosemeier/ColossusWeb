import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CREATURE_ANIMATIONS, creatureAtlasUrl } from '../creatureAnimations'
import { loadDefaultVariant } from '../../engine/__tests__/helpers'

describe('approved creature atlases and timelines', () => {
  const directory = new URL('../../../public/creature-animations/', import.meta.url)
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', directory), 'utf8'))
  it('covers exactly the 24 standard creatures, with Dragon normalized deliberately', () => {
    const names = Object.keys(CREATURE_ANIMATIONS).sort()
    expect(names).toHaveLength(24)
    expect(names).toEqual(Object.keys(loadDefaultVariant().creatures).sort())
  })
  for (const [name, animations] of Object.entries(CREATURE_ANIMATIONS)) {
    it(`${name}: preserves all three approved PNGs, dimensions and timeline slots`, () => {
      expect(Object.keys(animations).sort()).toEqual(['attacking', 'moving', 'resting'])
      for (const timeline of Object.values(animations)) {
        const bytes = readFileSync(fileURLToPath(new URL(timeline.atlas, directory)))
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.inputs[timeline.atlas])
        expect(bytes.toString('hex', 0, 8)).toBe('89504e470d0a1a0a')
        expect(bytes.readUInt32BE(16)).toBe(timeline.columns * timeline.frameSize)
        expect(bytes.readUInt32BE(20)).toBe(timeline.rows * timeline.frameSize)
        expect(timeline.durations).toHaveLength(name === 'Dragon' ? 12 : 8)
        expect(timeline.columns * timeline.rows).toBe(timeline.durations.length)
        expect(timeline.durations.every(ms => Number.isInteger(ms) && ms > 0)).toBe(true)
        expect(creatureAtlasUrl(timeline)).toContain(`/creature-animations/${timeline.atlas}`)
      }
    })
  }
  it('retains deliberate long attack holds rather than inventing a uniform frame rate', () => {
    expect(CREATURE_ANIMATIONS.Ogre.attacking.durations).toEqual([600, 180, 140, 100, 100, 180, 400, 1900])
    expect(CREATURE_ANIMATIONS.Dragon.attacking.durations).toEqual([600, 160, 140, 100, 80, 80, 100, 140, 180, 220, 300, 1500])
  })
})
