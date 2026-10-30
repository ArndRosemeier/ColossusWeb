// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYLISTS } from '../musicPlayer'

describe('music playlists', () => {
  it('has tracks for the main board and for battle, and every file exists', () => {
    expect(PLAYLISTS.board.length).toBeGreaterThanOrEqual(2)
    expect(PLAYLISTS.battle.length).toBeGreaterThanOrEqual(2)
    for (const file of [...PLAYLISTS.board, ...PLAYLISTS.battle]) {
      expect(existsSync(resolve(process.cwd(), 'public/music', file)), file).toBe(true)
    }
  })
})

describe('music volume preference', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  it('defaults to zero, rejects bad stored values and remembers the choice', async () => {
    const music = await import('../music')
    expect(music.getMusicVolume()).toBe(0)
    for (const bad of ['', 'on', '-1', '101', '2.5', 'NaN']) {
      vi.resetModules()
      localStorage.setItem('colossus.musicVolume', bad)
      expect((await import('../music')).getMusicVolume()).toBe(0)
    }
    vi.resetModules()
    localStorage.setItem('colossus.musicVolume', '40')
    expect((await import('../music')).getMusicVolume()).toBe(40)
    expect(() => music.setMusicVolume(150)).toThrow(/Invalid music volume/)
  })
  it('renders the slider at zero by default', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { MusicVolume } = await import('../../components/MusicVolume')
    const markup = renderToStaticMarkup(createElement(MusicVolume))
    expect(markup).toContain('type="range"')
    expect(markup).toContain('aria-label="Music volume"')
    expect(markup).toContain('value="0"')
  })
})
