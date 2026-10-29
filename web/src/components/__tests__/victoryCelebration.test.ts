// @vitest-environment jsdom
import { act, createElement, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VictoryCelebration } from '../VictoryCelebration'
import { useVictoryCelebration } from '../../ui/useVictoryCelebration'
import { useBattleCamera } from '../../ui/useBattleCamera'
import { setPresentationMode } from '../../ui/presentationMode'
import { dispatch } from '../../engine/GameEngine'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import type { GameState } from '../../engine/types'
import { PLAYER_COLORS } from '../../engine/types'

// React chooses its animation-event prefix when react-dom loads. Give jsdom
// the standard capability present in actual browsers before those imports run.
vi.hoisted(() => { if (!('AnimationEvent' in window)) Object.defineProperty(window, 'AnimationEvent', { configurable: true, value: window.Event }) })

function resignation() {
  const before = twoPlayerGame(13)
  before.players[1].name = 'Boreas'; before.players[1].score = 321; before.players[1].kind = 'ai'
  const won = dispatch(before, { type: 'resign', playerId: before.players[0].id })
  expect(won.winnerId).toBe(before.players[1].id)
  return { before, won }
}
function battleWin() {
  const game = twoPlayerGame(517)
  const [attacker, defender] = game.legions
  defender.hexLabel = attacker.hexLabel
  game.phase = 'Fight'; game.pendingEngagements = [{ attackerId: attacker.id, defenderId: defender.id }]
  const before = dispatch(game, { type: 'startEngagement', attackerId: attacker.id, defenderId: defender.id })
  const battle = dispatch(before, { type: 'proposeAgreement', kind: 'fight' })
  const won = dispatch(battle, { type: 'concedeBattle' })
  expect(won.winnerId).toBeTruthy()
  return { before, battle, won }
}
let root: Root, host: HTMLDivElement, reduced = false
const motionListeners = new Set<() => void>(), notify = vi.fn()
const animations: { finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = []
const api: { commit: (next: GameState | null, replacement?: boolean) => void; state: GameState | null } = { commit: () => {}, state: null }
function Harness({ initial }: { initial: GameState | null }) {
  const [state, setState] = useState(initial)
  const current = useRef(state), returnFocusRef = useRef<HTMLButtonElement>(null)
  const camera = useBattleCamera(state, notify)
  const victory = useVictoryCelebration(state, camera.active, notify)
  api.state = state
  api.commit = (next, replacement) => {
    camera.observe(current.current, next, replacement)
    victory.observe(current.current, next, replacement)
    current.current = next; setState(next)
  }
  const battle = state?.battle && !state.battle.done
  return createElement('div', null,
    createElement('button', { ref: returnFocusRef, type: 'button' }, 'New game'),
    createElement('div', { ref: camera.boardRef, 'data-camera-active': String(camera.active) }, state && createElement('svg', { className: battle ? 'battle-board' : 'master-board', viewBox: '0 0 700 600' },
      !battle && state.variant.board && Object.keys(state.variant.board.hexByLabel).map(label => createElement('g', { key: label, 'data-hex': label }, createElement('polygon', { points: '0,0 20,0 10,20' }))))),
    victory.celebration && createElement(VictoryCelebration, { key: victory.celebration.id, celebrationId: victory.celebration.id,
      winner: victory.celebration.winner, onDismiss: victory.dismiss, onError: notify, returnFocusRef }))
}
async function mount(state: GameState | null) { await act(async () => root.render(createElement(Harness, { initial: state }))) }
async function commit(state: GameState | null, replacement = false) { await act(async () => api.commit(state, replacement)) }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
function dialog() { return host.querySelector<HTMLDialogElement>('.victory-celebration') }
async function finishCamera() { await act(async () => { for (const animation of animations) animation.finish(); await Promise.resolve() }) }

beforeEach(() => {
  vi.useFakeTimers(); setPresentationMode('animated'); reduced = false; animations.length = 0; notify.mockReset()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: (_: string, fn: () => void) => motionListeners.add(fn), removeEventListener: (_: string, fn: () => void) => motionListeners.delete(fn) }))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true }) })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false }) })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.matches('[data-camera-active]')) return new DOMRect(10, 80, 750, 680)
    if (this.matches('svg')) return new DOMRect(20, 100, 700, 600)
    if (this.matches('polygon')) return new DOMRect(400, 280, 70, 61)
    return new DOMRect()
  })
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn(() => {
    let finish!: () => void, reject!: (reason: Error) => void
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail })
    const cancel = vi.fn(() => reject(new DOMException('Canceled', 'AbortError')))
    animations.push({ finish, cancel }); return { finished, cancel }
  }) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  // jsdom queues a zero-delay native dialog toggle event when open changes.
  // Flush platform bookkeeping; a leftover presentation timeout would remain.
  await act(async () => vi.advanceTimersByTime(0))
  expect(document.querySelector('.battle-camera-overlay')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  host.remove(); motionListeners.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  delete (Element.prototype as Partial<Element>).animate
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close
})

describe('fresh victory presentation without game commands', () => {
  it.each(PLAYER_COLORS.slice(0, 9))('keeps exact winning $id color on the medal and name banner', async color => {
    const before = twoPlayerGame(13)
    before.players[1].color = color
    const won = dispatch(before, { type: 'resign', playerId: before.players[0].id })
    await mount(before); await commit(won)
    expect(dialog()!.querySelector('.victory-owner-face')!.getAttribute('fill')).toBe(color.css)
    expect(dialog()!.style.getPropertyValue('--victory-color')).toBe(color.css)
  })
  it('celebrates an actual resignation winner with exact owner color/name/score, native modal focus and unchanged state', async () => {
    const { before, won } = resignation(), bytes = JSON.stringify(won)
    await mount(before); await commit(won)
    expect(dialog()!.open).toBe(true)
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Boreas wins')
    expect(dialog()!.querySelector('.victory-score strong')!.textContent).toBe('321')
    expect(dialog()!.querySelector('.victory-owner-face')!.getAttribute('fill')).toBe(won.players[1].color.css)
    expect(dialog()!.getAttribute('data-owner-color')).toBe(won.players[1].color.css)
    expect(dialog()!.textContent).not.toMatch(/you win/i)
    expect(document.activeElement?.textContent).toBe('View final board')
    expect(dialog()!.getAttribute('aria-labelledby')).toBe(dialog()!.querySelector('h2')!.id)
    expect(dialog()!.querySelectorAll('.victory-confetti i')).toHaveLength(32)
    expect(JSON.stringify(won)).toBe(bytes); expect(api.state).toBe(won); expect(notify).not.toHaveBeenCalled()
  })
  it('waits for the actual battle exit camera lifetime, while the winning engine state commits immediately', async () => {
    const { battle, won } = battleWin(), bytes = JSON.stringify(won)
    await mount(battle); await commit(won)
    expect(api.state).toBe(won)
    expect(document.querySelector('.battle-camera-overlay')).not.toBeNull()
    expect(host.querySelector('[data-camera-active="true"]')).not.toBeNull()
    expect(dialog()).toBeNull()
    await finishCamera()
    expect(document.querySelector('.battle-camera-overlay')).toBeNull()
    expect(dialog()!.open).toBe(true)
    expect(JSON.stringify(won)).toBe(bytes)
  })
  it('wraps Tab and Shift+Tab between the native modal controls', async () => {
    const { before, won } = resignation()
    await mount(before); await commit(won)
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close victory celebration')
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
    expect(document.activeElement?.textContent).toBe('View final board')
  })
  it('also releases a queued victory when the actual camera cancels on resize', async () => {
    const { battle, won } = battleWin()
    await mount(battle); await commit(won)
    expect(dialog()).toBeNull()
    await act(async () => window.dispatchEvent(new Event('resize')))
    expect(dialog()!.open).toBe(true)
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
  })
  it('does not replay on ordinary winner updates, duplicate adoption, dismiss or later mode enable', async () => {
    const { before, won } = resignation()
    await mount(before); await commit(won)
    await click(host.querySelector('.victory-view-board')!)
    await commit({ ...won, message: 'remote notice' }); await commit(won)
    await act(async () => setPresentationMode('classic')); await act(async () => setPresentationMode('animated'))
    expect(dialog()).toBeNull()
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
  })
  it('skips loading a finished game, resets on replacement/null, and permits one fresh event in the next game', async () => {
    const { before, won } = resignation()
    await mount(null); await commit(won, true)
    expect(dialog()).toBeNull()
    await commit(before, true); await commit(won)
    expect(dialog()).not.toBeNull()
    await commit(null); expect(dialog()).toBeNull()
    await commit(before, true); await commit(won)
    expect(dialog()).not.toBeNull()
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(2)
  })
  it('keeps Classic instant and does not create a celebration when Animated is enabled after a win', async () => {
    const { before, won } = resignation()
    setPresentationMode('classic'); await mount(before); await commit(won)
    expect(dialog()).toBeNull()
    await act(async () => setPresentationMode('animated'))
    expect(dialog()).toBeNull(); expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled()
  })
  it('has no victory panel for a draw', async () => {
    const { before } = resignation()
    await mount(before); await commit({ ...before, winnerId: null, draw: true })
    expect(dialog()).toBeNull()
  })
  it('retains a static winner card under reduced motion without starting confetti when that preference later changes', async () => {
    const { before, won } = resignation()
    reduced = true; await mount(before); await commit(won)
    expect(dialog()!.getAttribute('data-reduced-motion')).toBe('true')
    expect(host.querySelector('.victory-confetti')).toBeNull()
    await act(async () => { reduced = false; for (const fn of motionListeners) fn() })
    expect(dialog()).not.toBeNull(); expect(host.querySelector('.victory-confetti')).toBeNull()
  })
  it('stops confetti on live reduced motion and dismisses/cleans up on unchecking Animated', async () => {
    const { before, won } = resignation()
    await mount(before); await commit(won)
    expect(host.querySelector('.victory-confetti')).not.toBeNull()
    await act(async () => { reduced = true; for (const fn of motionListeners) fn() })
    expect(host.querySelector('.victory-confetti')).toBeNull(); expect(dialog()).not.toBeNull()
    await act(async () => setPresentationMode('classic'))
    expect(dialog()).toBeNull()
    expect(document.activeElement?.textContent).toBe('New game')
  })
  it('removes bounded confetti on its own native animation end, not each particle end, while preserving the final card', async () => {
    const { before, won } = resignation()
    await mount(before); await commit(won)
    await act(async () => host.querySelector('.victory-confetti i')!.dispatchEvent(new Event('animationend', { bubbles: true })))
    expect(host.querySelector('.victory-confetti')).not.toBeNull()
    await act(async () => host.querySelector('.victory-confetti')!.dispatchEvent(new Event('animationend', { bubbles: true })))
    expect(host.querySelector('.victory-confetti')).toBeNull(); expect(dialog()!.open).toBe(true)
  })
  it.each(['Escape', 'View final board', 'Close victory celebration'])('dismisses via %s and restores focus without changing the winner', async method => {
    const { before, won } = resignation(), bytes = JSON.stringify(won)
    await mount(before); await commit(won)
    if (method === 'Escape') {
      const event = new Event('cancel', { cancelable: true })
      await act(async () => dialog()!.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true)
    } else await click(host.querySelector(method === 'View final board' ? '.victory-view-board' : '.victory-close')!)
    expect(dialog()).toBeNull(); expect(document.activeElement?.textContent).toBe('New game')
    expect(JSON.stringify(won)).toBe(bytes)
  })
  it('reports a native dialog failure through the existing error callback and releases the pending panel', async () => {
    const { before, won } = resignation()
    vi.mocked(HTMLDialogElement.prototype.showModal).mockImplementationOnce(() => { throw Error('Modal unavailable') })
    await mount(before); await commit(won)
    expect(dialog()).toBeNull(); expect(api.state).toBe(won)
    expect(notify).toHaveBeenCalledWith('Victory celebration: Modal unavailable')
  })
  it('reports an invalid authoritative winner reference instead of inventing a winner', async () => {
    const { before, won } = resignation()
    await mount(before); await commit({ ...won, winnerId: 'missing-winner' })
    await act(async () => vi.runAllTicks())
    expect(dialog()).toBeNull()
    expect(notify).toHaveBeenCalledWith('Victory celebration: winner missing-winner is missing from the game.')
  })
})
