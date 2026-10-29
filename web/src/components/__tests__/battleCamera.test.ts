// @vitest-environment jsdom
import { act, createElement, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatch } from '../../engine/GameEngine'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import type { GameState } from '../../engine/types'
import { battleCameraBoundary, battleCameraFocus, validCameraRect } from '../../ui/battleCamera'
import { cloneCameraSvg } from '../../ui/battleCameraOverlay'
import { useBattleCamera } from '../../ui/useBattleCamera'
import { setPresentationMode } from '../../ui/presentationMode'

function encounter(players = 3) {
  const game = twoPlayerGame(517, { players: ([{ name: 'Alice', kind: 'human' }, { name: 'Bob', kind: 'human' }, { name: 'Charlie', kind: 'human' }] as const).slice(0, players) })
  const [attacker, defender] = game.legions
  const hex = Object.values(game.variant.board.hexByLabel).find(item => item.terrain === 'Desert')!.label
  for (const legion of [attacker, defender]) {
    legion.hexLabel = hex
    legion.creatures = [{ type: 'Titan', hits: 0 }, { type: 'Ogre', hits: 0 }]
  }
  attacker.enteredFrom = 'Left'
  game.phase = 'Fight'
  game.pendingEngagements = [{ attackerId: attacker.id, defenderId: defender.id }]
  const before = dispatch(game, { type: 'startEngagement', attackerId: attacker.id, defenderId: defender.id })
  const battle = dispatch(before, { type: 'proposeAgreement', kind: 'fight' }, () => .5)
  const after = dispatch(battle, { type: 'concedeBattle' }, () => .5)
  return { before, battle, after, hex }
}

describe('battle camera boundaries and actual spatial focus', () => {
  it('observes engine battle entry/exit once, including eliminated legions, without depending on commands', () => {
    const { before, battle, after, hex } = encounter()
    expect(battle.battle?.done).toBe(false)
    expect(after.battle === null || after.battle.done).toBe(true)
    expect(after.legions.length).toBeLessThan(battle.legions.length)
    expect(battleCameraBoundary(before, battle)).toEqual({ direction: 'enter', hexLabel: hex })
    expect(battleCameraBoundary(battle, after)).toEqual({ direction: 'exit', hexLabel: hex })
    expect(battleCameraBoundary(null, battle)).toBeNull()
    expect(battleCameraBoundary(battle, null)).toBeNull()
    expect(battleCameraBoundary(battle, dispatch(battle, { type: 'notice', message: 'ordinary update' }))).toBeNull()
    expect(battleCameraBoundary(after, dispatch(after, { type: 'notice', message: 'same main board' }))).toBeNull()
    const ended = encounter(2)
    expect(ended.after.winnerId).toBeTruthy()
    expect(battleCameraBoundary(ended.battle, ended.after)).toEqual({ direction: 'exit', hexLabel: ended.hex })
  })
  it('maps the off-center encounter to the destination center after rotation and zoom, including scrolled coordinates', () => {
    const board = { left: -90, top: 85, width: 1100, height: 900 }
    const hex = { left: 650, top: 300, width: 90, height: 78 }
    const destination = { left: 30, top: 120, width: 700, height: 590 }
    const focus = battleCameraFocus(board, hex, destination)
    const radians = focus.angle * Math.PI / 180
    const hx = hex.left + hex.width / 2 - board.left, hy = hex.top + hex.height / 2 - board.top
    expect(board.left + focus.x + focus.scale * (Math.cos(radians) * hx - Math.sin(radians) * hy)).toBeCloseTo(destination.left + destination.width / 2)
    expect(board.top + focus.y + focus.scale * (Math.sin(radians) * hx + Math.cos(radians) * hy)).toBeCloseTo(destination.top + destination.height / 2)
    expect(focus.scale).toBeGreaterThan(5)
    expect(focus.angle).toBeGreaterThanOrEqual(-10)
    expect(validCameraRect({ ...hex, width: 0 })).toBe(false)
    expect(() => battleCameraFocus(board, { ...hex, left: NaN }, destination)).toThrow('invalid board geometry')
  })
  it('clones only revealed art, namespaces SVG references and removes interactive targets without changing live DOM', () => {
    const source = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="clip"><rect width="5" height="5"/></clipPath></defs><g data-hex="8" tabindex="0" onclick="bad()" clip-path="url(#clip)"><use href="#clip"/><foreignObject><button>Control</button><span>Revealed art</span></foreignObject></g></svg>', 'image/svg+xml').documentElement as unknown as SVGSVGElement
    const original = source.outerHTML
    const clone = cloneCameraSvg(source, 'snapshot')
    expect(clone.querySelector('#snapshot-clip')).not.toBeNull()
    expect(clone.querySelector('g')!.getAttribute('clip-path')).toBe('url(#snapshot-clip)')
    expect(clone.querySelector('use')!.getAttribute('href')).toBe('#snapshot-clip')
    expect(clone.querySelector('[data-hex], [tabindex], [onclick], button')).toBeNull()
    expect(clone.textContent).toContain('Revealed art')
    expect(clone.getAttribute('aria-hidden')).toBe('true')
    expect(source.outerHTML).toBe(original)
  })
  it('copies the already-visible canvas bitmap for an unsupported creature instead of losing its token in a DOM clone', () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    const source = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
    const canvas = document.createElement('canvas'); canvas.width = 28; canvas.height = 28
    foreign.append(canvas); source.append(foreign)
    const clone = cloneCameraSvg(source, 'canvas-copy')
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0)
    expect(clone.querySelector('canvas')).not.toBe(canvas)
    expect(source.querySelector('canvas')).toBe(canvas)
  })
})

let root: Root, host: HTMLDivElement
let reduced = false, missingHex = false
const listeners = new Set<() => void>(), notify = vi.fn()
type RecordedAnimation = { frames: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn>; finish: () => void }
let animations: RecordedAnimation[] = []
const api: { commit: (next: GameState | null, replacement?: boolean) => void; state: GameState | null } = { commit: () => {}, state: null }
function Harness({ initial }: { initial: GameState | null }) {
  const [state, setState] = useState(initial)
  const current = useRef(state)
  const camera = useBattleCamera(state, notify)
  api.state = state
  api.commit = (next, replacement) => { camera.observe(current.current, next, replacement); current.current = next; setState(next) }
  const battle = Boolean(state?.battle && !state.battle.done)
  const hex = state?.legions[0]?.hexLabel
  return createElement('div', { ref: camera.boardRef, 'data-test-camera-pane': true }, state && createElement('div', { className: battle ? 'battle-wrap' : 'master-board-wrap modern-board', 'data-presentation': 'animated' },
    createElement('svg', { className: battle ? 'battle-board' : 'master-board', viewBox: '0 0 700 600' },
      createElement('defs', null, createElement('clipPath', { id: 'live-clip' }, createElement('rect', { width: 700, height: 600 }))),
      !battle && !missingHex && createElement('g', { 'data-hex': hex }, createElement('polygon', { points: '0,0 20,0 10,20', clipPath: 'url(#live-clip)' })),
      !battle && createElement('g', { 'data-legion': 'selected' }, createElement('rect', { className: 'selection-frame', width: 28, height: 28 }), createElement('svg', { className: 'modern-legion-marker' })),
      createElement('text', { className: battle ? undefined : 'modern-hex-labels' }, battle ? 'Actual battlefield' : 'Actual updated main board'))))
}
async function mount(state: GameState | null) { await act(async () => root.render(createElement(Harness, { initial: state }))) }
async function commit(state: GameState | null, replacement = false) { await act(async () => api.commit(state, replacement)) }
function overlay() { return document.querySelector<HTMLElement>('.battle-camera-overlay') }
async function finish() { await act(async () => { for (const animation of animations) animation.finish(); await Promise.resolve() }) }

beforeEach(() => {
  animations = []; listeners.clear(); reduced = false; missingHex = false; notify.mockReset()
  setPresentationMode('animated')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }))
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.matches('[data-test-camera-pane]')) return new DOMRect(10, 80, 750, 700)
    if (this.matches('.master-board')) return new DOMRect(20, 100, 700, 600)
    if (this.matches('.battle-board')) return new DOMRect(60, 140, 600, 500)
    if (this.matches('polygon')) return new DOMRect(400, 280, 70, 61)
    return new DOMRect()
  })
  vi.stubGlobal('Animation', class {})
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    let finish!: () => void, reject!: (error: Error) => void
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail })
    const cancel = vi.fn(() => reject(new DOMException('Canceled', 'AbortError')))
    animations.push({ frames, options, cancel, finish })
    return { finished, cancel }
  }) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  expect(overlay()).toBeNull()
  host.remove(); listeners.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  delete (Element.prototype as Partial<Element>).animate
})

describe('one presentation observer, immediate real board commits', () => {
  it('zooms the actual encounter into real battle SVG and reverses into the updated same hex on exit', async () => {
    const { before, battle, after, hex } = encounter()
    const beforeBytes = JSON.stringify(before), battleBytes = JSON.stringify(battle), afterBytes = JSON.stringify(after)
    await mount(before); await commit(battle)
    expect(api.state).toBe(battle)
    expect(host.querySelector('.battle-board')!.textContent).toBe('Actual battlefield')
    expect(overlay()!.dataset).toMatchObject({ cameraDirection: 'enter', cameraHex: hex, cameraMotion: 'zoom' })
    expect(overlay()!.getAttribute('aria-hidden')).toBe('true')
    expect(overlay()!.inert).toBe(true)
    expect(overlay()!.querySelector('[data-hex]')).toBeNull()
    expect(overlay()!.querySelector('[data-camera-scene="quiet"] .modern-hex-labels')).toBeNull()
    expect(overlay()!.querySelector('[data-camera-scene="quiet"] .selection-frame')).toBeNull()
    expect(overlay()!.querySelector('[data-camera-layer="outgoing"] .battle-camera-legion .selection-frame')).not.toBeNull()
    expect(host.querySelector('.modern-hex-labels')).toBeNull() // real board is already tactical
    expect(animations[0].frames.some(frame => String(frame.transform).includes('translate('))).toBe(true)
    expect(animations[0].options.duration).toBe(820)
    await finish(); expect(overlay()).toBeNull()
    await commit(after)
    expect(host.querySelector('.master-board')!.textContent).toBe('Actual updated main board')
    expect(overlay()!.dataset).toMatchObject({ cameraDirection: 'exit', cameraHex: hex })
    expect(overlay()!.querySelector('[data-camera-layer="incoming"] .master-board')).not.toBeNull()
    await finish()
    expect([JSON.stringify(before), JSON.stringify(battle), JSON.stringify(after)]).toEqual([beforeBytes, battleBytes, afterBytes])
    expect(notify).not.toHaveBeenCalled()
  })
  it('does not replay during ordinary battle updates, duplicate adoption or after enabling Animated midbattle', async () => {
    const { before, battle } = encounter()
    setPresentationMode('classic')
    await mount(before); await commit(battle)
    expect(overlay()).toBeNull(); expect(animations).toHaveLength(0)
    await act(async () => setPresentationMode('animated'))
    await commit(dispatch(battle, { type: 'notice', message: 'remote update' }))
    await commit(battle)
    expect(overlay()).toBeNull(); expect(animations).toHaveLength(0)
  })
  it('skips direct active-battle loads and explicitly replacing a game, and cleans up null', async () => {
    const { before, battle } = encounter()
    await mount(null); await commit(battle)
    expect(overlay()).toBeNull()
    await commit(before, true); await commit(battle)
    expect(overlay()).not.toBeNull()
    await commit(before, true)
    expect(overlay()).toBeNull()
    expect(animations.every(animation => animation.cancel.mock.calls.length > 0)).toBe(true)
    await commit(battle); await commit(null)
    expect(overlay()).toBeNull()
  })
  it('uses a short fade with no transform in reduced motion, and live preference changes cancel motion', async () => {
    const { before, battle, after } = encounter()
    reduced = true
    await mount(before); await commit(battle)
    expect(overlay()!.dataset.cameraMotion).toBe('fade')
    expect(animations).toHaveLength(1)
    expect(animations[0].options.duration).toBe(150)
    expect(animations[0].frames.every(frame => frame.transform === undefined)).toBe(true)
    await finish()
    await act(async () => { reduced = false; for (const fn of listeners) fn() })
    await commit(after)
    expect(overlay()!.dataset.cameraMotion).toBe('zoom')
    await act(async () => { reduced = true; for (const fn of listeners) fn() })
    expect(overlay()).toBeNull()
  })
  it.each(['resize', 'scroll', 'mode'] as const)('cancels cleanly on %s with no orphan animations', async reason => {
    const { before, battle } = encounter()
    await mount(before); await commit(battle)
    await act(async () => reason === 'mode' ? setPresentationMode('classic') : window.dispatchEvent(new Event(reason)))
    expect(overlay()).toBeNull()
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })
  it('supersedes a fast enter/exit without replay or stacked snapshots', async () => {
    const { before, battle, after } = encounter()
    await mount(before); await commit(battle)
    const first = animations.slice()
    await commit(after)
    expect(document.querySelectorAll('.battle-camera-overlay')).toHaveLength(1)
    expect(overlay()!.dataset.cameraDirection).toBe('exit')
    expect(first.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    await finish(); expect(overlay()).toBeNull()
  })
  it('skips a fully coalesced battle that never paints instead of inventing an outgoing battlefield', async () => {
    const { before, battle, after } = encounter()
    await mount(before)
    await act(async () => { api.commit(battle); api.commit(after) })
    expect(api.state).toBe(after)
    expect(overlay()).toBeNull()
    expect(animations).toHaveLength(0)
    expect(notify).not.toHaveBeenCalled()
  })
  it('reports unexpected capture failures through the existing notice callback after the immediate game commit', async () => {
    const { before, battle } = encounter()
    missingHex = true
    await mount(before); await commit(battle)
    expect(api.state).toBe(battle)
    expect(host.querySelector('.battle-board')).not.toBeNull()
    expect(overlay()).toBeNull()
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Cannot measure contested hex'))
  })
  it('removes covering art and reports actual animation errors rather than leaving a silent fallback', async () => {
    const { before, battle } = encounter()
    vi.mocked(Element.prototype.animate).mockImplementationOnce(() => { throw Error('Animation unavailable') })
    await mount(before); await commit(battle)
    expect(overlay()).toBeNull()
    expect(api.state).toBe(battle)
    expect(notify).toHaveBeenCalledWith('Battle camera: Animation unavailable')
  })
})
