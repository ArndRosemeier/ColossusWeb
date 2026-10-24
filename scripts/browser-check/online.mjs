#!/usr/bin/env node
/**
 * Online play in a REAL browser: two Chromium contexts (two players, separate
 * localStorage) drive the BUILT app, and the GameHub WebSocket is answered by a
 * small fake server inside this script (Playwright `routeWebSocket`), speaking
 * the wire protocol of the gameserver repo's `docs/PROTOCOL.md`. No live server,
 * no real key.
 *
 * Build first (from the repo root):
 *   (cd web && VITE_GAMEHUB_URL=https://hub.test VITE_GAMEHUB_KEY=ghk_colossus_test \
 *     npx vite build --mode test --outDir ../scripts/browser-check/online-dist)
 * Then:
 *   node scripts/browser-check/online.mjs
 *
 * Exit 0 = every statement held; exit 1 names each failed statement. The browser
 * is closed in `finally`, so it dies on the failure path too.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'online-dist')

// --- a static server for the built app -------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' }
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = decodeURIComponent(url.pathname)
  if (path === '/__cued.html') {
    // cued's own frame, exactly as docs/CUED.md §3 shows it.
    const pass = url.searchParams.get('pass')
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><iframe id="game" src="/#cued=${pass}" style="width:1300px;height:900px"
      allow="fullscreen; gamepad; autoplay" allowfullscreen referrerpolicy="origin"
      sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-forms"></iframe>`)
    return
  }
  const file = join(DIST, path.endsWith('/') ? path + 'index.html' : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => http.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${http.address().port}`

// --- the fake GameHub --------------------------------------------------------
let nextId = 1
let nextRoom = 1
const rooms = new Map() // code -> { summary, members: Map<id, conn>, snapshot, seq }
const conns = new Set()
const wire = []

function summary(room) {
  return { ...room.summary, players: room.members.size }
}
function lobbyBroadcast(room) {
  for (const c of conns) {
    if (!c.lobby) continue
    if (room.summary.public && room.members.size > 0) c.send({ t: 'room+', room: summary(room) })
    else c.send({ t: 'room-', id: room.summary.id })
  }
}
function leave(c) {
  const room = c.room
  if (!room) return
  room.members.delete(c.id)
  c.room = null
  for (const o of room.members.values()) o.send({ t: 'player-', id: c.id })
  if (room.summary.host === c.id && room.members.size > 0) {
    room.summary.host = Math.min(...room.members.keys())
    for (const o of room.members.values()) o.send({ t: 'host', id: room.summary.host })
  }
  lobbyBroadcast(room)
}
function enter(c, room, req) {
  for (const o of room.members.values()) o.send({ t: 'player+', player: { id: c.id, name: c.name } })
  room.members.set(c.id, c)
  c.room = room
  c.send({
    t: 'joined',
    req,
    room: summary(room),
    you: c.id,
    host: room.summary.host,
    players: [...room.members.values()].map((m) => ({ id: m.id, name: m.name })),
    state: { seq: room.seq, snapshotSeq: room.seq, snapshot: room.snapshot, deltas: [], complete: true },
  })
  lobbyBroadcast(room)
}

async function routeHub(context) {
  await context.routeWebSocket(/wss:\/\/hub\.test\/.*/, (ws) => {
    const url = new URL(ws.url())
    if (url.searchParams.get('key') !== 'ghk_colossus_test') {
      ws.close({ code: 1008 })
      return
    }
    const c = { id: nextId++, name: '', lobby: false, room: null, send: (m) => ws.send(JSON.stringify(m)) }
    conns.add(c)
    c.send({ t: 'welcome', you: c.id, name: c.name, app: 'colossus' })
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw))
      wire.push({ from: c.id, t: m.t })
      const err = (code) => c.send({ t: 'error', code, req: m.req })
      switch (m.t) {
        case 'hello':
          c.name = String(m.name).slice(0, 32)
          c.send({ t: 'welcome', you: c.id, name: c.name, app: 'colossus', req: m.req })
          break
        case 'lobby':
          c.lobby = Boolean(m.on)
          if (c.lobby) c.send({ t: 'rooms', req: m.req, rooms: [...rooms.values()].filter((r) => r.summary.public && r.members.size > 0).map(summary) })
          break
        case 'create': {
          if (c.room) return err('already_in_room')
          const code = 'R' + String(nextRoom++).padStart(5, '0')
          const room = { summary: { id: code, name: m.room?.name ?? 'room', public: m.room?.public ?? true, players: 0, maxPlayers: m.room?.maxPlayers ?? 16, meta: m.room?.meta ?? null, host: c.id, createdAt: Date.now() }, members: new Map(), snapshot: null, seq: 0 }
          rooms.set(code, room)
          enter(c, room, m.req)
          break
        }
        case 'join': {
          if (c.room) return err('already_in_room')
          const room = rooms.get(String(m.id).toUpperCase())
          if (!room) return err('no_such_room')
          if (room.members.size >= room.summary.maxPlayers) return err('room_full')
          if (room.members.size === 0) room.summary.host = c.id
          enter(c, room, m.req)
          break
        }
        case 'leave':
          leave(c)
          c.send({ t: 'left', req: m.req })
          break
        case 'state': {
          const room = c.room
          if (!room || room.summary.host !== c.id) return err('not_host')
          room.seq += 1
          room.snapshot = m.data
          for (const o of room.members.values()) if (o !== c) o.send({ t: 'state', seq: room.seq, data: m.data })
          break
        }
        case 'meta': {
          const room = c.room
          if (!room || room.summary.host !== c.id) return err('not_host')
          if (m.meta !== undefined) room.summary.meta = m.meta
          if (m.name !== undefined) room.summary.name = m.name
          for (const o of room.members.values()) o.send({ t: 'room', room: summary(room) })
          lobbyBroadcast(room)
          break
        }
        case 'msg': {
          const room = c.room
          if (!room) return err('not_in_room')
          for (const o of room.members.values()) {
            if (o === c || (m.to !== undefined && o.id !== m.to)) continue
            o.send({ t: 'msg', from: c.id, data: m.data })
          }
          break
        }
        default:
          err('unknown_type')
      }
    })
    ws.onClose(() => {
      conns.delete(c)
      leave(c)
    })
  })
}

// --- the scenario -------------------------------------------------------------
const results = []
const check = (statement, ok, detail = '') => {
  results.push({ statement, ok })
  console.log(`${ok ? 'HELD  ' : 'FAILED'}  ${statement}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
try {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  await routeHub(ctxA)
  await routeHub(ctxB)
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  for (const [p, n] of [[a, 'A'], [b, 'B']]) p.on('pageerror', (e) => console.log(`[${n} pageerror]`, e.message))

  await a.goto(ORIGIN + '/')
  await b.goto(ORIGIN + '/')
  await a.getByText('Online · the list updates live').waitFor()
  await b.getByText('Online · the list updates live').waitFor()
  check('both browsers connect to the game server and say so', true)

  await a.getByLabel('Your name').fill('Alice')
  await a.getByLabel('Game name').fill('Friday Titan')
  await a.getByRole('button', { name: 'Create', exact: true }).click()
  await a.getByText('room R00001').first().waitFor()
  const startA = a.getByRole('button', { name: 'Start game' })
  check('the creator is in its room, Start is shown and disabled while alone', await startA.isDisabled())
  check('...with the reason in words', await a.getByText('not_enough_players').isVisible())

  await b.getByLabel('Your name').fill('Bob')
  const row = b.locator('li.lobby-game', { hasText: 'Friday Titan' })
  await row.waitFor({ timeout: 5000 })
  check('the new game appears in the other browser with no refresh', true)
  await row.getByRole('button', { name: 'Join' }).click()
  await b.getByText('Waiting for the host to start').waitFor()
  await a.getByText('Bob').waitFor({ timeout: 5000 })
  check('the join appears on the host at once', true)
  await a.waitForFunction(() => {
    const el = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Start game')
    return el && !el.disabled
  })
  check('Start becomes enabled with two players, no refresh', true)
  await startA.click()

  const statusA = a.getByTestId('multiplayer-status')
  const statusB = b.getByTestId('multiplayer-status')
  await statusA.waitFor({ timeout: 10000 })
  await statusB.waitFor({ timeout: 10000 })
  check('Start moves BOTH players into the game (the joiner without a click)', true)
  const textA = await statusA.innerText()
  const textB = await statusB.innerText()
  check('the host is seat 1 and may act', /Seat 1\/2/.test(textA) && /your turn/.test(textA), textA.replace(/\s+/g, ' '))
  check('the joiner is seat 2 and is read-only', /Seat 2\/2/.test(textB) && /read-only/.test(textB), textB.replace(/\s+/g, ' '))

  // A second tab of the SAME browser (same token) joins the game and takes the
  // seat's connection; the first tab must still be able to split (live bug:
  // "not_seated only a seated player may move" on the first split).
  const a2 = await ctxA.newPage()
  await a2.goto(ORIGIN + '/')
  await a2.getByTestId('multiplayer-status').waitFor({ timeout: 10000 })
  await a.locator('[data-legion="leg-1"]').first().click()
  for (const c of ['Angel', 'Ogre', 'Ogre', 'Centaur']) await a.getByTitle(`Move ${c} to new legion`).first().click()
  await a.getByRole('button', { name: 'Confirm 4:4 split' }).click()
  await b.locator('[data-legion="leg-3"]').first().waitFor({ timeout: 5000 })
  const afterSplit = await statusA.innerText()
  check('with a second tab open, the first tab still splits and the other player sees it', !/not_seated/.test(afterSplit), afterSplit.replace(/\s+/g, ' '))
  await a2.close()

  // A reload drops the socket; the browser must come straight back into its seat.
  await b.reload()
  await b.getByTestId('multiplayer-status').waitFor({ timeout: 10000 })
  const afterReload = await b.getByTestId('multiplayer-status').innerText()
  check('a reload goes straight back into the same game and seat', /Seat 2\/2/.test(afterReload), afterReload.replace(/\s+/g, ' '))

  // The HOST reloads: the other player takes over hosting, and the old host comes
  // back into its seat as a plain player.
  await a.reload()
  await a.getByTestId('multiplayer-status').waitFor({ timeout: 10000 })
  await b.getByText('room R00001 · host').waitFor({ timeout: 10000 })
  const hostBack = await a.getByTestId('multiplayer-status').innerText()
  check('when the host reloads, the other player hosts on and the old host is back in seat 1', /Seat 1\/2/.test(hostBack) && /your turn/.test(hostBack) && !/host/.test(hostBack), hostBack.replace(/\s+/g, ' '))

  // A shared move through the real UI: Alice gives up (two presses).
  await a.getByRole('button', { name: 'Give up the game' }).click()
  await a.getByRole('button', { name: /Give up as Alice — confirm/ }).click()
  await a.getByText('Bob wins!').first().waitFor({ timeout: 5000 })
  check("the move ends the game on the mover's screen", true)
  await b.getByText('Bob wins!').first().waitFor({ timeout: 5000 })
  check("...and on the other player's screen, pushed with no refresh", true)

  const commits = wire.filter((w) => w.t === 'state').length
  check('every change travelled as host state frames (no polling)', commits >= 3, `${commits} state frames`)

  // --- cued.de: two friends open the game from a cued invitation (room r1) ---
  const pass = (sub, name, raum) => {
    const b64 = (t) => Buffer.from(t, 'utf8').toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = b64(JSON.stringify({ iss: 'cued', aud: 'colossusweb', iat: now, exp: now + 21600, sub, name, kuerzel: name[0], hg: 'rgb(31, 58, 50)', schrift: 'rgb(124, 240, 208)', bild: '', raum, cued: 'https://cued.de/' }))
    return `${head}.${body}.${createHmac('sha256', 'k').update(`${head}.${body}`).digest('base64url')}`
  }
  const ctxC = await browser.newContext()
  const ctxD = await browser.newContext()
  await routeHub(ctxC)
  await routeHub(ctxD)
  const c = await ctxC.newPage()
  const d = await ctxD.newPage()
  await c.goto(`${ORIGIN}/__cued.html?pass=${pass('7', 'Carla', 'r1')}`)
  const fc = c.frameLocator('#game')
  await fc.getByText('Online · the list updates live').waitFor({ timeout: 10000 })
  check('inside cued’s sandboxed frame the game loads and reaches the game server', true)
  check('the cued player is shown by name', await fc.getByText('Playing as').isVisible())
  const frameUrl = c.frames().find((f) => f.url().startsWith(ORIGIN + '/') && !f.url().includes('__cued'))?.url() ?? ''
  check('the pass is stripped from the frame’s address', !frameUrl.includes('cued='), frameUrl)
  const nameInput = fc.getByLabel('Your name')
  check('the lobby uses the cued name and locks it', (await nameInput.inputValue()) === 'Carla' && (await nameInput.getAttribute('readonly')) !== null)
  await fc.getByLabel('Game name').fill('Cued Titan')
  await fc.getByRole('button', { name: 'Create', exact: true }).click()
  await fc.getByText('Start game').waitFor()

  await d.goto(`${ORIGIN}/__cued.html?pass=${pass('8', 'Dirk', 'r1')}`)
  const fd = d.frameLocator('#game')
  await fd.getByText('Waiting for the host to start').waitFor({ timeout: 10000 })
  check('an invitee from the same cued room joins that game by itself', true)
  await fc.getByText('Dirk').waitFor({ timeout: 5000 })
  check('...and the host sees them under their cued name', true)
  await fc.getByRole('button', { name: 'Start game' }).click()
  await fd.getByTestId('multiplayer-status').waitFor({ timeout: 10000 })
  check('Start works inside the frame for both', await fc.getByTestId('multiplayer-status').isVisible())
} catch (error) {
  check('the scenario ran to the end', false, String(error?.message ?? error).split('\n')[0])
} finally {
  await browser.close()
  http.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} statements held`)
process.exit(failed.length === 0 ? 0 : 1)
