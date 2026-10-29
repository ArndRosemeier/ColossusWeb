// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function fresh() { vi.resetModules(); return import('../presentationMode') }

describe('local presentation preference', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
  it('defaults to classic and validates stored values strictly', async () => {
    expect((await fresh()).getPresentationMode()).toBe('classic')
    for (const invalid of ['on', 'toString', 'ANIMATED', 'null']) {
      localStorage.setItem('colossus.presentationMode', invalid)
      expect((await fresh()).getPresentationMode()).toBe('classic')
    }
  })
  it('persists animated across a fresh load and notifies all subscribed consumers', async () => {
    const preference = await fresh()
    const setup = vi.fn(), game = vi.fn()
    const unsubscribe = preference.subscribePresentationMode(setup)
    preference.subscribePresentationMode(game)
    preference.setPresentationMode('animated')
    expect(setup).toHaveBeenCalledOnce()
    expect(game).toHaveBeenCalledOnce()
    unsubscribe()
    preference.setPresentationMode('classic')
    expect(setup).toHaveBeenCalledOnce()
    expect(game).toHaveBeenCalledTimes(2)
    preference.setPresentationMode('animated')
    expect((await fresh()).getPresentationMode()).toBe('animated')
  })
  it('rejects invalid writes before changing the preference or storage', async () => {
    const preference = await fresh()
    expect(() => preference.setPresentationMode('toString' as never)).toThrow('Invalid presentation mode')
    expect(localStorage.getItem('colossus.presentationMode')).toBeNull()
    expect(preference.getPresentationMode()).toBe('classic')
  })
  it('remains usable when optional browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('private mode') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('private mode') })
    const preference = await fresh()
    expect(preference.getPresentationMode()).toBe('classic')
    preference.setPresentationMode('animated')
    expect(preference.getPresentationMode()).toBe('animated')
  })
})
