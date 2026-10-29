// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreaturePresentation } from '../CreaturePresentation'
import { BoardCreatureIcon } from '../BoardCreatureIcon'
import { CreatureChit } from '../CreatureChit'
import { SafeSvgImage } from '../SafeSvgImage'
import { MasterBoardView } from '../MasterBoardView'
import { GameControls } from '../GameControls'
import { BoardDecisionOverlay } from '../BoardDecisionOverlay'
import { MusterForm, SplitForm } from '../LegionActions'
import { CreatureAssetErrorContext } from '../../ui/creaturePresentation'
import { setPresentationMode } from '../../ui/presentationMode'
import { loadCreatureAtlas } from '../../ui/creatureAnimations'
import { creatureImageUrl } from '../../variant/assets'
import { dispatch, getLegalRecruits, getMovesForSelected } from '../../engine/GameEngine'
import { bestRecruitAt } from '../../engine/recruit'
import { movementRecruitPreview } from '../../ui/movementRecruitPreview'
import { turn1SplitChild, twoPlayerGame } from '../../engine/__tests__/helpers'
import type { GameCommand } from '../../engine/types'

vi.mock('../../ui/creatureAnimations', async original => ({
  ...await original<typeof import('../../ui/creatureAnimations')>(), loadCreatureAtlas: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../variant/assets', async original => ({
  ...await original<typeof import('../../variant/assets')>(), loadAssetManifest: () => new Promise(() => {}),
}))

let host: HTMLDivElement, root: Root
let reduced = false
const motionListeners = new Set<() => void>()
const notify = vi.fn()
async function render(element: ReactNode, withNotice = true) {
  await act(async () => root.render(withNotice ? createElement(CreatureAssetErrorContext.Provider, { value: notify }, element) : element))
}
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
const artwork = { creature: 'Ogre', power: 6, skill: 2, size: 48, hits: 1, title: 'My custom Ogre title', className: 'custom-creature' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced,
    addEventListener: (_event: string, listener: () => void) => motionListeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => motionListeners.delete(listener),
  }))
  reduced = false
  setPresentationMode('classic')
  notify.mockReset()
  vi.mocked(loadCreatureAtlas).mockReset().mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  expect(vi.getTimerCount()).toBe(0)
  host.remove(); motionListeners.clear(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('one creature presentation policy', () => {
  it('preserves the exact original Classic HTML and SVG renderer markup and fetches no atlases', async () => {
    expect(renderToStaticMarkup(createElement(CreaturePresentation, { ...artwork, mode: 'classic' })))
      .toBe(renderToStaticMarkup(createElement(CreatureChit, artwork)))
    const icon = { creature: 'Ogre', x: 10, y: 20, width: 14, height: 14 }
    expect(renderToStaticMarkup(createElement(BoardCreatureIcon, icon)))
      .toBe(renderToStaticMarkup(createElement(SafeSvgImage, { href: creatureImageUrl('Ogre'), x: 10, y: 20, width: 14, height: 14, preserveAspectRatio: 'xMidYMid meet' })))
    await render(createElement(CreaturePresentation, artwork))
    expect(host.querySelector('canvas')).not.toBeNull()
    expect(loadCreatureAtlas).not.toHaveBeenCalled()
  })
  it('preserves custom title/class, correct stats and proportional text at 44/48 pixels while retaining the 28px battle sizes', async () => {
    setPresentationMode('animated')
    for (const size of [28, 44, 48]) {
      await render(createElement(CreaturePresentation, { ...artwork, size }))
      const sprite = host.querySelector<HTMLElement>('.animated-creature')!
      expect(sprite.title).toBe(artwork.title)
      expect(sprite.classList.contains('custom-creature')).toBe(true)
      expect(sprite.getAttribute('aria-label')).toBe(artwork.title)
      expect(sprite.style.width).toBe(`${size}px`)
      expect(parseFloat(sprite.style.getPropertyValue('--creature-name-size'))).toBeCloseTo(size * 5 / 28)
      expect(parseFloat(sprite.style.getPropertyValue('--creature-stat-size'))).toBeCloseTo(size * 7 / 28)
      expect(host.querySelector('.animated-creature-power')!.textContent).toBe('6')
      expect(host.querySelector('.animated-creature-skill')!.textContent).toBe('2')
      expect(host.querySelector('.animated-creature-hits')!.textContent).toBe('1')
    }
  })
  it('renders tiny board icons as resting art only, with original footprint, accessible name and click-through', async () => {
    setPresentationMode('animated')
    await render(createElement('svg', null, createElement(BoardCreatureIcon, { creature: 'Ogre', x: 11, y: 22, width: 14, height: 14 })))
    const icon = host.querySelector('.board-creature-icon')!
    expect(['x', 'y', 'width', 'height'].map(name => icon.getAttribute(name))).toEqual(['11', '22', '14', '14'])
    expect(icon.getAttribute('pointer-events')).toBe('none')
    const sprite = icon.querySelector('.animated-creature')!
    expect(sprite.getAttribute('data-animation')).toBe('resting')
    expect(sprite.getAttribute('data-art-only')).toBe('true')
    expect(sprite.getAttribute('aria-label')).toBe('Ogre')
    expect(icon.querySelector('.animated-creature-name, .animated-creature-power, .animated-creature-skill')).toBeNull()
  })
  it('shares live mode and reduced-motion changes and does not reset resting playback for a new error callback', async () => {
    setPresentationMode('animated')
    await render(createElement(CreaturePresentation, artwork))
    await act(async () => vi.advanceTimersByTime(450))
    expect(host.querySelector<HTMLElement>('.animated-creature')!.dataset.frame).toBe('1')
    await render(createElement(CreaturePresentation, { ...artwork, onAssetError: vi.fn() }))
    expect(host.querySelector<HTMLElement>('.animated-creature')!.dataset.frame).toBe('1')
    await act(async () => { reduced = true; for (const listener of [...motionListeners]) listener() })
    expect(host.querySelector<HTMLElement>('.animated-creature')!.dataset.frame).toBe('0')
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => setPresentationMode('classic'))
    expect(host.querySelector('.animated-creature')).toBeNull()
    expect(host.querySelector('canvas')).not.toBeNull()
  })
  it('retains explicit unsupported capability titles for HTML and SVG without requesting an invented atlas', async () => {
    setPresentationMode('animated')
    await render(createElement('div', null,
      createElement(CreaturePresentation, { ...artwork, creature: 'Variant Beast' }),
      createElement('svg', null, createElement(BoardCreatureIcon, { creature: 'Variant Beast', x: 0, y: 0, width: 22, height: 22 }))))
    expect(host.querySelector('canvas')!.title).toContain(`${artwork.title} — Animated artwork unavailable`)
    expect(host.querySelector('svg title')!.textContent).toContain('Variant Beast — Animated artwork unavailable')
    expect(host.querySelector('.animated-creature')).toBeNull()
    expect(loadCreatureAtlas).not.toHaveBeenCalled()
  })
  it('routes HTML and tiny SVG asset failures through the scoped App notice callback', async () => {
    setPresentationMode('animated')
    vi.mocked(loadCreatureAtlas).mockRejectedValue(Error('Cannot load animated creature artwork: Ogre/resting-atlas.png'))
    await render(createElement('div', null, createElement(CreaturePresentation, artwork),
      createElement('svg', null, createElement(BoardCreatureIcon, { creature: 'Ogre', x: 0, y: 0, width: 14, height: 14 }))))
    expect(notify).toHaveBeenCalledWith('Cannot load animated creature artwork: Ogre/resting-atlas.png')
    expect(host.querySelector('.board-creature-icon .animated-creature-error')!.textContent).toBe('!')
    expect(host.querySelector('.custom-creature .animated-creature-error')!.textContent).toBe('Art unavailable')
  })
  it('refuses a supported animated consumer without an error surface instead of silently swallowing failures', async () => {
    setPresentationMode('animated')
    await expect(render(createElement(CreaturePresentation, artwork), false)).rejects.toThrow('requires an App notice callback')
    expect(loadCreatureAtlas).not.toHaveBeenCalled()
  })
})

describe('remaining actual creature token callers', () => {
  function musterFixture() {
    const state = twoPlayerGame(9)
    const legion = state.legions.find(l => l.playerId === state.players[0].id)!
    legion.creatures = [{ type: 'Cyclops', hits: 0 }, { type: 'Cyclops', hits: 0 }]
    legion.hexLabel = Object.values(state.variant.board.hexByLabel).find(hex => hex.terrain === 'Brush')!.label
    legion.moved = true
    state.phase = 'Muster'
    state.selectedLegionId = legion.id
    return { state, legion }
  }
  it('uses resting colored art in actual destination recruit previews and retains their existing group titles', async () => {
    setPresentationMode('animated')
    let state = twoPlayerGame(1)
    const parent = state.legions.find(l => l.playerId === state.players[0].id)!
    state = dispatch(state, { type: 'split', parentId: parent.id, childCreatures: turn1SplitChild(state, parent) })
    // createGame's seed chooses setup; dispatch's dice RNG is a separate input.
    // A six gives this real opening split legal recruit-bearing destinations.
    state = dispatch(state, { type: 'doneSplit' }, () => 0.99)
    state = dispatch(state, { type: 'selectLegion', legionId: parent.id })
    expect(state.movementRoll).toBe(6)
    const selected = state.legions.find(legion => legion.id === parent.id)!
    const expectedRecruits = [...getMovesForSelected(state).keys()]
      .map(label => movementRecruitPreview(state, selected, label)).filter(creature => creature !== null)
    expect(expectedRecruits.length).toBeGreaterThan(0)
    await render(createElement(MasterBoardView, { state, onHexClick: vi.fn(), onLegionClick: vi.fn(), interactive: true }))
    expect(host.querySelectorAll('.recruit-preview .board-creature-icon')).toHaveLength(expectedRecruits.length)
    expect([...host.querySelectorAll('.recruit-preview .animated-creature[data-creature]')].map(sprite => sprite.getAttribute('data-creature'))).toEqual(expectedRecruits)
    for (const preview of host.querySelectorAll('.recruit-preview')) {
      expect(preview.querySelector('[data-animation="resting"][data-art-only="true"]')).not.toBeNull()
      expect(preview.querySelector('title')!.textContent).toMatch(/^Best muster: /)
      expect(preview.getAttribute('pointer-events')).toBe('none')
    }
  })
  it.each(['classic', 'animated'] as const)('shows Gorgon at a real two-Cyclops Brush move target in %s while strategic muster still prefers Cyclops', async mode => {
    setPresentationMode(mode)
    const state = twoPlayerGame(9)
    const legion = state.legions.find(item => item.playerId === state.players[0].id)!
    legion.creatures = [{ type: 'Cyclops', hits: 0 }, { type: 'Cyclops', hits: 0 }]
    state.phase = 'Move'; state.movementRoll = 1; state.selectedLegionId = legion.id
    const brush = [...getMovesForSelected(state).keys()].find(label => state.variant.board.hexByLabel[label].terrain === 'Brush')!
    expect(brush).toBeTruthy()
    expect(bestRecruitAt(state, legion, brush)).toBe('Cyclops')
    const onHexClick = vi.fn()
    await render(createElement(MasterBoardView, { state, onHexClick, onLegionClick: vi.fn(), interactive: true }))
    const preview = host.querySelector(`.recruit-preview[data-recruit-hex="${brush}"]`)!
    expect(preview.querySelector('title')!.textContent).toBe('Best muster: Gorgon')
    if (mode === 'animated') expect(preview.querySelector('.animated-creature')!.getAttribute('data-creature')).toBe('Gorgon')
    else expect(preview.querySelector('image')!.getAttribute('href')).toBe(creatureImageUrl('Gorgon'))
    expect(preview.getAttribute('pointer-events')).toBe('none')
    await click(host.querySelector(`[data-hex="${brush}"]`)!)
    expect(onHexClick).toHaveBeenCalledWith(brush)
  })
  it('replaces pending and recent muster icons, keeps marker art/rotation, and dispatches the original recruit and undo commands', async () => {
    setPresentationMode('animated')
    const fixture = musterFixture()
    let state = fixture.state
    const id = fixture.legion.id
    const creature = getLegalRecruits(state, id)[0]
    expect(creature).toBeTruthy()
    const commands: GameCommand[] = []
    const apply = (command: GameCommand) => { commands.push(command); state = dispatch(state, command) }
    const view = () => createElement('div', null,
      createElement(MasterBoardView, { state, onHexClick: vi.fn(), onLegionClick: vi.fn() }),
      createElement(MusterForm, { state, recruits: getLegalRecruits(state, id), onRecruit: type => apply({ type: 'recruit', legionId: id, creatureType: type }) }),
      createElement(GameControls, { state, dispatch: apply, interactive: true }))
    await render(view())
    expect(host.querySelector('.muster-pending .board-creature-icon [data-animation="resting"]')).not.toBeNull()
    expect(host.querySelector('.muster-pending .animated-creature')!.getAttribute('data-creature')).toBe('Cyclops')
    const marker = host.querySelector('[data-legion] .modern-legion-marker')!
    const markerIdentity = [marker.getAttribute('data-marker-id'), marker.getAttribute('data-owner-color'), marker.querySelector('.marker-crest')!.getAttribute('d')]
    await click(host.querySelector('.muster-form .recruit-btn')!)
    expect(commands[0]).toEqual({ type: 'recruit', legionId: id, creatureType: creature })
    expect(state.legions.find(l => l.id === id)!.musteredThisTurn).toBe(creature)
    await render(view())
    const recent = host.querySelector('.muster-done')!
    expect(recent.querySelector('.board-creature-icon [data-animation="resting"]')).not.toBeNull()
    expect(recent.getAttribute('transform')).toMatch(/^rotate\(-18 /)
    expect(recent.querySelector('title')!.textContent).toContain(`Mustered: ${creature}`)
    const afterMarker = host.querySelector('[data-legion] .modern-legion-marker')!
    expect([afterMarker.getAttribute('data-marker-id'), afterMarker.getAttribute('data-owner-color'), afterMarker.querySelector('.marker-crest')!.getAttribute('d')]).toEqual(markerIdentity)
    expect(afterMarker.getAttribute('data-height')).toBe(String(state.legions.find(l => l.id === id)!.creatures.length))
    const undo = [...host.querySelectorAll('.selected-legion button')].find(button => button.textContent?.includes('Undo recruit'))!
    expect(undo).toBeTruthy()
    await click(undo)
    expect(commands.at(-1)).toEqual({ type: 'undoRecruit', legionId: id })
    expect(state.legions.find(l => l.id === id)!.musteredThisTurn).toBeNull()
    await render(view())
    expect(host.querySelector('.muster-pending .board-creature-icon')).not.toBeNull()
    expect(host.querySelector('.muster-done')).toBeNull()
  })
  it('keeps unknown enemy slots masked while rendering revealed/own creatures through the shared seam', async () => {
    setPresentationMode('animated')
    const state = twoPlayerGame(9)
    state.players[1].kind = 'ai'
    const enemy = state.legions.find(l => l.playerId === state.players[1].id)!
    enemy.knownPublic = []
    state.selectedLegionId = enemy.id
    const view = () => createElement(GameControls, { state, dispatch: vi.fn() })
    await render(view())
    expect(host.querySelectorAll('.selected-legion .unknown-chit')).toHaveLength(enemy.creatures.length)
    expect(host.querySelector('.selected-legion .animated-creature')).toBeNull()
    expect(host.querySelectorAll('.legion-list .animated-creature').length).toBeGreaterThan(0)
    enemy.knownPublic = ['Angel']
    await render(view())
    expect(host.querySelectorAll('.selected-legion .unknown-chit')).toHaveLength(enemy.creatures.length - 1)
    expect(host.querySelector('.selected-legion .animated-creature')!.getAttribute('data-creature')).toBe('Angel')
  })
  it('uses the same resting renderer in split and post-battle reinforcement controls', async () => {
    setPresentationMode('animated')
    const { state, legion } = musterFixture()
    state.pendingPostBattleReinforce = { legionId: legion.id }
    const send = vi.fn()
    await render(createElement('div', null,
      createElement(SplitForm, { state, creatures: legion.creatures.map(c => c.type), onSplit: vi.fn() }),
      createElement(BoardDecisionOverlay, { state, dispatch: send, interactive: true })))
    expect(host.querySelector('.split-form [data-animation="resting"]')).not.toBeNull()
    expect(host.querySelector('.board-decision-card .recruit-btn [data-animation="resting"]')).not.toBeNull()
    const button = host.querySelector('.board-decision-card .recruit-btn')!
    const type = button.querySelector('.animated-creature')!.getAttribute('data-creature')
    await click(button)
    expect(send).toHaveBeenCalledWith({ type: 'postBattleReinforce', creatureType: type })
  })
})
