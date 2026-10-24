// @vitest-environment jsdom
/**
 * The cued.de pass, built exactly as cued builds it (HS256, base64url), read by
 * the copied `cued.ts` and by ColossusWeb's `readCuedPlayer`.
 */
import { createHmac } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { CuedBadge } from '../../components/CuedBadge'
import { CuedPassError, decodeCuedPass } from '../cued'
import { CUED_STORAGE_KEY, cuedPlayerName, cuedRoom, readCuedPlayer } from '../cuedPlayer'
import { createWorld, parseRoomMeta, roomMeta } from '../room'
import { newToken } from '../identity'

function makePass(claims: Record<string, unknown>, key = 'test-key'): string {
  const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(claims))
  const sig = createHmac('sha256', key).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

const now = Math.floor(Date.now() / 1000)
const CLAIMS = {
  iss: 'cued', aud: 'colossusweb', iat: now, exp: now + 6 * 3600, sub: '7',
  name: 'Arnd Ü', kuerzel: 'A', hg: 'rgb(31, 58, 50)', schrift: 'rgb(124, 240, 208)', bild: '', raum: null,
  cued: 'https://cued.de/',
}

function open(hash: string) {
  window.history.replaceState(null, '', `/ColossusWeb/?room=K7Q2ZP${hash}`)
}

afterEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('reading the pass', () => {
  it('reads every claim and fails loudly on a malformed pass', () => {
    const id = decodeCuedPass(makePass(CLAIMS))
    expect(id).toMatchObject({ playerId: '7', name: 'Arnd Ü', initials: 'A', avatarUrl: null, room: null })
    expect(() => decodeCuedPass('a.b.c')).toThrow(CuedPassError)
    expect(() => decodeCuedPass(makePass({ ...CLAIMS, iss: 'elsewhere' }))).toThrow(/issuer/)
  })

  it('takes the pass from the fragment, strips it from the address bar, and keeps it across a reload', () => {
    open(`#cued=${makePass({ ...CLAIMS, raum: 'r1' })}`)
    const player = readCuedPlayer()
    expect(cuedPlayerName(player)).toBe('Arnd Ü')
    expect(cuedRoom(player)).toBe('r1')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('?room=K7Q2ZP')
    // A reload inside the frame has no fragment any more: the tab's copy is used.
    expect(cuedPlayerName(readCuedPlayer())).toBe('Arnd Ü')
    expect(window.sessionStorage.getItem(CUED_STORAGE_KEY)).not.toBeNull()
  })

  it('without a pass the game runs as before', () => {
    open('')
    expect(readCuedPlayer()).toEqual({ identity: null, expired: false, failure: null })
  })

  it('a malformed pass is a visible failure, never an invented player', () => {
    open('#cued=not.a.pass')
    const player = readCuedPlayer()
    expect(player.identity).toBeNull()
    expect(player.failure?.code).toBe('bad_cued_pass')
    expect(renderToStaticMarkup(createElement(CuedBadge, { cued: player }))).toContain('role="alert"')
  })

  it('an expired pass names no player for online play, and says to reopen from cued', () => {
    open(`#cued=${makePass({ ...CLAIMS, exp: now - 1 })}`)
    const player = readCuedPlayer()
    expect(player.expired).toBe(true)
    expect(cuedPlayerName(player)).toBeNull()
    expect(renderToStaticMarkup(createElement(CuedBadge, { cued: player }))).toContain('reopen Colossus from cued')
  })
})

describe('the badge', () => {
  it('shows the avatar image, or the initials circle in cued’s colours', () => {
    const withImage = renderToStaticMarkup(
      createElement(CuedBadge, { cued: { identity: decodeCuedPass(makePass({ ...CLAIMS, bild: 'https://cued.de/gast/bild/x/' })), expired: false, failure: null } }),
    )
    expect(withImage).toContain('src="https://cued.de/gast/bild/x/"')
    expect(withImage).toContain('Arnd Ü')
    const initials = renderToStaticMarkup(
      createElement(CuedBadge, { cued: { identity: decodeCuedPass(makePass(CLAIMS)), expired: false, failure: null } }),
    )
    expect(initials).toContain('background:rgb(31, 58, 50)')
    expect(initials).toContain('>A<')
  })
})

describe('invitations', () => {
  it('a game created for a cued room carries it in the lobby meta', () => {
    const world = createWorld({ displayName: 'T', variant: 'Default', maxPlayers: 2, creator: { token: newToken(), name: 'A' }, conn: 1, cuedRaum: 'r1' })
    expect(parseRoomMeta(roomMeta(world))?.cuedRaum).toBe('r1')
    const plain = createWorld({ displayName: 'T', variant: 'Default', maxPlayers: 2, creator: { token: newToken(), name: 'A' }, conn: 1 })
    expect(parseRoomMeta(roomMeta(plain))?.cuedRaum).toBeNull()
  })
})
