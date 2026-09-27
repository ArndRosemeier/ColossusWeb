// @vitest-environment jsdom
/**
 * The resume pointer pins: it lives in ONE `localStorage` entry, holds only a
 * legal game id, survives a reload, and is LOUD about a corrupt value rather than
 * pretending there is nothing to resume.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACTIVE_GAME_STORAGE_KEY,
  forgetActiveGame,
  readActiveGame,
  rememberActiveGame,
} from '../activeGame'

const GAME = 'twin-1234abcd'

beforeEach(() => {
  globalThis.localStorage.clear()
})

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return (error as { code?: string }).code ?? ''
  }
  return '<no error>'
}

describe('the one resume pointer', () => {
  it('round-trips a game id through the ONE named entry, and forgets it', () => {
    expect(readActiveGame()).toBeNull()
    rememberActiveGame(GAME)
    expect(readActiveGame()).toBe(GAME)
    expect(Object.keys(globalThis.localStorage)).toEqual([ACTIVE_GAME_STORAGE_KEY])
    forgetActiveGame()
    expect(readActiveGame()).toBeNull()
    forgetActiveGame()
  })

  it('never writes a seat, a snapshot or key material', () => {
    rememberActiveGame(GAME)
    const raw = globalThis.localStorage.getItem(ACTIVE_GAME_STORAGE_KEY)!
    expect(JSON.parse(raw)).toEqual({ version: 1, gameId: GAME })
    expect(raw).not.toContain('ssk_')
    expect(raw).not.toContain('.s.')
  })

  it('refuses to remember an illegal game id, loudly', () => {
    expect(codeOf(() => rememberActiveGame('UPPER'))).toBe('bad_active_game')
  })

  it('is LOUD about a corrupt pointer instead of quietly resuming nothing', () => {
    globalThis.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, 'not json')
    expect(codeOf(() => readActiveGame())).toBe('bad_active_game')
    globalThis.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, JSON.stringify({ version: 2, gameId: GAME }))
    expect(codeOf(() => readActiveGame())).toBe('bad_active_game')
    globalThis.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, JSON.stringify({ version: 1, gameId: 'UPPER' }))
    expect(codeOf(() => readActiveGame())).toBe('bad_active_game')
  })
})
