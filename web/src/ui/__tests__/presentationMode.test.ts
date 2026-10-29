// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function fresh() { vi.resetModules(); return import('../presentationMode') }

describe('local presentation preference', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
  it('defaults to animated and validates stored values strictly', async () => {
    expect((await fresh()).getPresentationMode()).toBe('animated')
    for (const invalid of ['on', 'toString', 'ANIMATED', 'null']) {
      localStorage.setItem('colossus.presentationMode', invalid)
      expect((await fresh()).getPresentationMode()).toBe('animated')
    }
  })
  it('preserves an explicit Classic preference on first read and after reload', async () => {
    localStorage.setItem('colossus.presentationMode', 'classic')
    const preference = await fresh()
    expect(preference.getPresentationMode()).toBe('classic')
    preference.setPresentationMode('animated')
    preference.setPresentationMode('classic')
    expect((await fresh()).getPresentationMode()).toBe('classic')
    expect(localStorage.getItem('colossus.presentationMode')).toBe('classic')
  })
  it('renders a fresh native checkbox checked and an explicit Classic snapshot unchecked', async () => {
    const preference = await fresh()
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { PresentationModeToggle } = await import('../../components/PresentationModeToggle')
    const markup = () => renderToStaticMarkup(createElement(PresentationModeToggle))
    expect(markup()).toContain('type="checkbox"')
    expect(markup()).toContain('checked=""')
    preference.setPresentationMode('classic')
    expect(markup()).not.toContain('checked=')
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
    expect(preference.getPresentationMode()).toBe('animated')
  })
  it('remains usable when optional browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('private mode') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('private mode') })
    const preference = await fresh()
    expect(preference.getPresentationMode()).toBe('animated')
    preference.setPresentationMode('classic')
    expect(preference.getPresentationMode()).toBe('classic')
  })
})
