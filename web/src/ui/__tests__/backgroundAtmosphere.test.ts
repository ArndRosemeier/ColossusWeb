// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'colossus.backgroundAtmosphere'

async function fresh() {
  vi.resetModules()
  return import('../backgroundAtmosphere')
}

describe('background atmosphere default', () => {
  beforeEach(() => localStorage.clear())

  it('is Off on a first visit (animation is opt-in)', async () => {
    const bg = await fresh()
    bg.initBackgroundAtmosphere()
    expect(bg.getBackgroundAtmosphere()).toBe('off')
    expect(document.documentElement.dataset.bgAtmosphere).toBe('off')
  })

  it('keeps a background the player chose', async () => {
    localStorage.setItem(STORAGE_KEY, 'ember')
    const bg = await fresh()
    bg.initBackgroundAtmosphere()
    expect(bg.getBackgroundAtmosphere()).toBe('ember')
  })
})
