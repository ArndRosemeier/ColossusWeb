// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnimatedCreature } from '../AnimatedCreature'
import { BattleCreature } from '../BattleCreature'
import { BattleBoardView } from '../BattleBoardView'
import { PresentationModeToggle } from '../PresentationModeToggle'
import { CREATURE_ANIMATIONS, loadCreatureAtlas } from '../../ui/creatureAnimations'
import { setPresentationMode } from '../../ui/presentationMode'
import { startBattle, battleLand } from '../../engine/battle'
import { twoPlayerGame } from '../../engine/__tests__/helpers'

vi.mock('../../ui/creatureAnimations', async importOriginal => ({
  ...await importOriginal<typeof import('../../ui/creatureAnimations')>(),
  loadCreatureAtlas: vi.fn(() => Promise.resolve()),
}))
// Classic renderer is checked through its real markup, without canvas/image IO in jsdom.
vi.mock('../../variant/assets', async importOriginal => ({
  ...await importOriginal<typeof import('../../variant/assets')>(),
  loadAssetManifest: () => new Promise(() => {}),
}))

let host: HTMLDivElement, root: Root
let reduced = false
const motionListeners = new Set<() => void>()
const onAssetError = vi.fn()
const base = { creature: 'Ogre', power: 6, skill: 2, hits: 2, size: 28, reducedMotion: false, onAssetError }
async function render(element: Parameters<Root['render']>[0]) { await act(async () => { root.render(element) }) }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
function sprite() { return host.querySelector<HTMLElement>('.animated-creature')! }

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(loadCreatureAtlas).mockReset().mockResolvedValue(undefined)
  onAssetError.mockReset()
  reduced = false
  motionListeners.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced,
    addEventListener: (_: string, listener: () => void) => motionListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => motionListeners.delete(listener),
  }))
  setPresentationMode('classic')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('animated creature playback', () => {
  it('loops rest and move using their accepted durations, then cancels timers on teardown', async () => {
    await render(createElement(AnimatedCreature, base))
    expect(sprite().dataset.animation).toBe('resting')
    await advance(450)
    expect(sprite().dataset.frame).toBe('1')
    await render(createElement(AnimatedCreature, { ...base, moving: true }))
    expect(sprite().dataset.animation).toBe('moving')
    await advance(220)
    expect(sprite().dataset.frame).toBe('1')
    await render(null)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('plays one attack, preserves progress across unrelated rerenders and returns to rest', async () => {
    await render(createElement(AnimatedCreature, { ...base, attackId: 'roll-1' }))
    expect(sprite().dataset.animation).toBe('attacking')
    await advance(600)
    expect(sprite().dataset.frame).toBe('1')
    await render(createElement(AnimatedCreature, { ...base, hits: 3, attackId: 'roll-1' }))
    await advance(180)
    expect(sprite().dataset.frame).toBe('2')
    await advance(2820)
    expect(sprite().dataset.animation).toBe('resting')
    await render(createElement(AnimatedCreature, { ...base, attackId: 'roll-1' }))
    expect(sprite().dataset.animation).toBe('resting')
    await render(createElement(AnimatedCreature, { ...base, attackId: 'roll-2' }))
    expect(sprite().dataset.animation).toBe('attacking')
  })
  it('survives StrictMode effect cleanup and continues an event after remount without replaying it', async () => {
    const attackStartedAt = Date.now()
    const element = () => createElement(StrictMode, null, createElement(AnimatedCreature, { ...base, attackId: 'same-event', attackStartedAt }))
    await render(element())
    expect(sprite().dataset.animation).toBe('attacking')
    await advance(780)
    expect(sprite().dataset.frame).toBe('2')
    await render(null)
    await render(element())
    expect(sprite().dataset.frame).toBe('2')
    await advance(4000)
    await render(null)
    await render(element())
    expect(sprite().dataset.animation).toBe('resting')
  })
  it('dead units and reduced motion use still artwork without timers or a later stale attack', async () => {
    await render(createElement(AnimatedCreature, { ...base, attackId: 'roll-1' }))
    await advance(600)
    await render(createElement(AnimatedCreature, { ...base, attackId: 'roll-1', reducedMotion: true }))
    expect(sprite().dataset.animation).toBe('resting')
    expect(sprite().dataset.frame).toBe('0')
    expect(vi.getTimerCount()).toBe(0)
    await render(createElement(AnimatedCreature, { ...base, attackId: 'roll-1' }))
    expect(sprite().dataset.animation).toBe('resting')
    await render(createElement(AnimatedCreature, { ...base, attackId: 'roll-1', dead: true }))
    expect(vi.getTimerCount()).toBe(0)
    await advance(5000)
    expect(sprite().dataset.frame).toBe('0')
  })
  it('allows an explicit engine-authorized dead Strikeback, then holds still with its dead marker', async () => {
    setPresentationMode('animated')
    const state = twoPlayerGame(31)
    const attacker = state.legions.find(l => l.playerId === state.players[0].id)!
    const defender = state.legions.find(l => l.playerId === state.players[1].id)!
    attacker.enteredFrom = 'Bottom'
    defender.hexLabel = attacker.hexLabel
    const battle = startBattle(state, attacker, defender, () => 0.5)
    state.battle = battle
    const striker = battle.units.find(u => u.legionId === defender.id && u.creatureType !== 'Titan')!
    const target = battle.units.find(u => u.legionId === attacker.id)!
    const labels = Object.keys(battleLand(state, battle).hexByLabel)
    striker.hex = labels[0]; target.hex = labels[1]
    striker.hits = 999
    battle.phase = 'Strikeback'
    battle.activePlayerId = striker.playerId
    const props = { state, battle, onUnitClick: vi.fn(), onHexClick: vi.fn(), onAssetError }
    await render(createElement(BattleBoardView, props))
    expect(host.querySelector('.dead [data-animation="attacking"]')).toBeNull()
    state.pendingDice = { id: 'dead-strikeback', context: 'strike', dieCount: 1, label: 'strikeback', playerId: striker.playerId,
      strike: { attackerId: striker.id, defenderId: target.id, need: 4 } }
    await render(createElement(BattleBoardView, props))
    expect(host.querySelector('.dead [data-animation="attacking"]')).not.toBeNull()
    expect(host.querySelector('.dead .battle-chit-dead-x')).not.toBeNull()
    await advance(4000)
    const dead = host.querySelector<HTMLElement>('.dead .animated-creature')!
    expect(dead.dataset.animation).toBe('resting')
    expect(dead.dataset.frame).toBe('0')
    await advance(500)
    expect(dead.dataset.frame).toBe('0')
  })
  it('shows a supported asset failure and sends its precise error to the App notice callback', async () => {
    vi.mocked(loadCreatureAtlas).mockRejectedValueOnce(Error('Cannot load animated creature artwork: Ogre/resting-atlas.png'))
    await render(createElement(AnimatedCreature, base))
    expect(onAssetError).toHaveBeenCalledWith('Cannot load animated creature artwork: Ogre/resting-atlas.png')
    expect(host.textContent).toContain('Art unavailable')
    expect(host.querySelector('img')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps labels upright and accessible while facing only the art horizontally', async () => {
    await render(createElement(AnimatedCreature, { ...base, facingLeft: true }))
    expect(host.querySelector<HTMLElement>('.animated-creature-art')!.style.transform).toBe('scaleX(-1)')
    expect(host.querySelector<HTMLElement>('.animated-creature-name')!.style.transform).toBe('')
    expect(sprite().getAttribute('aria-label')).toBe('Ogre 6-2 (2 hits)')
    expect(host.textContent).toContain('Ogre622')
  })
})

describe('battle presentation wiring', () => {
  function fixture() {
    const state = twoPlayerGame(31)
    const attacker = state.legions.find(l => l.playerId === state.players[0].id)!
    const defender = state.legions.find(l => l.playerId === state.players[1].id)!
    const hex = Object.values(state.variant.board.hexByLabel).find(h => h.terrain === 'Plains')!.label
    attacker.hexLabel = hex; defender.hexLabel = hex; attacker.enteredFrom = 'Bottom'
    const battle = startBattle(state, attacker, defender, () => 0.5)
    state.battle = battle
    const striker = battle.units[0], target = battle.units.find(u => u.playerId !== striker.playerId)!
    const labels = Object.keys(battleLand(state, battle).hexByLabel)
    striker.hex = labels[0]; target.hex = labels[1]
    const onUnitClick = vi.fn(), onHexClick = vi.fn(), onMoveAnimDone = vi.fn()
    return { state, battle, striker, target, props: { state, battle, onUnitClick, onHexClick, onMoveAnimDone, onAssetError } }
  }
  it('classic keeps canvas chits and never loads new sprite atlases', async () => {
    const { props } = fixture()
    await render(createElement(BattleBoardView, props))
    expect(host.querySelector('canvas')).not.toBeNull()
    expect(host.querySelector('.animated-creature')).toBeNull()
    expect(loadCreatureAtlas).not.toHaveBeenCalled()
  })
  it('unsupported variant creatures retain a classic counter with a capability title', async () => {
    await render(createElement(BattleCreature, { ...base, creature: 'HydraVariant', mode: 'animated', isAttacker: false }))
    expect(host.querySelector('canvas')!.title).toContain('Animated artwork unavailable for this variant creature')
    expect(loadCreatureAtlas).not.toHaveBeenCalled()
  })
  it('shares one local preference between setup and game native checkboxes', async () => {
    await render(createElement('div', null, createElement(PresentationModeToggle), createElement(PresentationModeToggle)))
    const checkboxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect([...checkboxes].map(input => input.checked)).toEqual([false, false])
    await act(async () => { checkboxes[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect([...checkboxes].map(input => input.checked)).toEqual([true, true])
    await act(async () => { checkboxes[1].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect([...checkboxes].map(input => input.checked)).toEqual([false, false])
    expect(localStorage.getItem('colossus.presentationMode')).toBe('classic')
  })
  it('rests on board and staging, attacks once for pending→settled same ID, and handles a new instant roll', async () => {
    setPresentationMode('animated')
    const { state, battle, striker, target, props } = fixture()
    await render(createElement(BattleBoardView, props))
    expect(host.querySelectorAll('.staging .animated-creature').length).toBeGreaterThan(0)
    expect([...host.querySelectorAll<HTMLElement>('.animated-creature')].every(s => s.dataset.animation === 'resting')).toBe(true)
    const strike = { attackerId: striker.id, defenderId: target.id, need: 4 }
    state.pendingDice = { id: 'physical-1', context: 'strike', strike, dieCount: 1, playerId: striker.playerId, label: 'strike' }
    await render(createElement(BattleBoardView, props))
    const attacking = () => host.querySelector<HTMLElement>('[data-animation="attacking"]')!
    expect(attacking()).not.toBeNull()
    await advance(600)
    expect(attacking().dataset.frame).toBe('1')
    state.pendingDice = null
    state.diceRoll = { id: 'physical-1', context: 'strike', strike, values: [6], playerId: striker.playerId, label: 'strike' }
    battle.selectedUnitId = target.id
    await render(createElement(BattleBoardView, props))
    expect(attacking().dataset.frame).toBe('1')
    const duration = CREATURE_ANIMATIONS[striker.creatureType].attacking.durations.reduce((a, b) => a + b, 0)
    await advance(duration)
    expect(attacking()).toBeNull()
    await render(createElement(BattleBoardView, props))
    expect(attacking()).toBeNull()
    state.diceRoll = { ...state.diceRoll, id: 'instant-2' }
    await render(createElement(BattleBoardView, props))
    expect(attacking()).not.toBeNull()
    const unit = attacking().closest('foreignObject')!
    await act(async () => unit.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(props.onUnitClick).toHaveBeenCalledWith(striker.id)
    await act(async () => setPresentationMode('classic'))
    expect(host.querySelector('.animated-creature')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => setPresentationMode('animated'))
    expect(attacking()).toBeNull()
  })
  it('moves on the existing overlay, completes through its callback and honors live reduced motion', async () => {
    setPresentationMode('animated')
    const { striker, props } = fixture()
    let rafTime = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(rafTime += 16), 16))
    vi.stubGlobal('cancelAnimationFrame', clearTimeout)
    vi.spyOn(performance, 'now').mockImplementation(() => rafTime)
    const moveAnim = { board: 'battle' as const, pieceId: striker.id, pathLabels: [striker.hex!], teleport: false as const,
      fromOffBoard: false, durationMs: 220, creatureType: striker.creatureType, power: 6, skill: 4, hits: 0, isAttacker: true }
    await render(createElement(BattleBoardView, { ...props, moveAnim }))
    expect(host.querySelector('.move-anim [data-animation="moving"]')).not.toBeNull()
    await advance(500)
    expect(props.onMoveAnimDone).not.toHaveBeenCalled()
    await advance(420)
    expect(props.onMoveAnimDone).toHaveBeenCalledOnce()
    await act(async () => { reduced = true; for (const listener of motionListeners) listener() })
    expect([...host.querySelectorAll<HTMLElement>('.animated-creature')].every(s => s.dataset.frame === '0')).toBe(true)
    expect(host.querySelector('[data-animation="moving"]')).toBeNull()
    vi.restoreAllMocks()
  })
})
