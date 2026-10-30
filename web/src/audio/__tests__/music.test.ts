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

describe('music preference', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  it('is off by default and remembers the choice', async () => {
    const music = await import('../music')
    expect(music.getMusicEnabled()).toBe(false)
    music.setMusicEnabled(false)
    expect(localStorage.getItem('colossus.music')).toBe('off')
    vi.resetModules()
    localStorage.setItem('colossus.music', 'on')
    expect((await import('../music')).getMusicEnabled()).toBe(true)
  })
  it('renders the Sound checkbox unchecked by default', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { MusicToggle } = await import('../../components/MusicToggle')
    const markup = renderToStaticMarkup(createElement(MusicToggle))
    expect(markup).toContain('aria-label="Sound"')
    expect(markup).not.toContain('checked=')
  })
})
