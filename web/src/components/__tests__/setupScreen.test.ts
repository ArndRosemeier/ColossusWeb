// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SetupScreen } from '../SetupScreen'
import { HubSession, type HubConnect } from '../../net/session'
import { FakeHubServer } from '../../net/__tests__/fakeHub'
import { NO_CUED_PLAYER } from '../../net/cuedPlayer'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { peekSavedGameMeta, saveGameToLocalStorage } from '../../persistence/saveGame'
import { getPresentationMode, setPresentationMode } from '../../ui/presentationMode'

vi.mock('../../variant/assets', async original => ({
  ...await original<typeof import('../../variant/assets')>(), loadAssetManifest: () => new Promise(() => {}),
}))

let host: HTMLDivElement, root: Root, server: FakeHubServer, session: HubSession
const onStart = vi.fn(), onContinue = vi.fn(), onOnlineEnter = vi.fn()
async function render(extra: Partial<ComponentProps<typeof SetupScreen>> = {}) {
  await act(async () => {
    root.render(createElement(SetupScreen, { onStart, session, cued: NO_CUED_PLAYER,
      player: { token: 'local-player', name: 'Alice' }, onPlayerChange: vi.fn(), onOnlineEnter, ...extra }))
  })
  await act(async () => { await server.settle(8) })
}
function button(text: string): HTMLButtonElement {
  const match = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes(text))
  if (!match) throw Error(`Missing button ${text}`)
  return match
}
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
async function edit(label: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)
  if (!field) throw Error(`Missing input ${label}`)
  await act(async () => {
    if (field instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      field.value = value
      field.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
}

beforeEach(() => {
  localStorage.clear()
  setPresentationMode('animated')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  onStart.mockReset(); onContinue.mockReset(); onOnlineEnter.mockReset()
  server = new FakeHubServer()
  session = new HubSession({ player: { token: 'local-player', name: 'Alice' },
    connect: server.connect as unknown as HubConnect,
    config: () => ({ url: 'https://hub.test', app: 'colossus', appKey: 'test_key', access: false }) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount(); session.close(); await server.settle(2) })
  host.remove(); vi.unstubAllGlobals()
})

describe('redesigned title screen preserves setup authority', () => {
  it('starts with the exact edited variant/player payload, retaining human versus AI profile semantics', async () => {
    await render()
    await edit('Game variant', 'Abyssal6')
    await edit('Player 1 name', 'Ariadne')
    await edit('Ariadne color', 'Gold')
    await edit('Ariadne type', 'ai')
    await edit('Ariadne AI personality', 'cautious')
    await edit('Ariadne type', 'human')
    await edit('CPU 1 AI personality', 'aggressive')
    await click(host.querySelector('[aria-label="Remove CPU 2"]')!)
    await click(button('Begin campaign'))
    expect(onStart).toHaveBeenCalledExactlyOnceWith({ variantName: 'Abyssal6', players: [
      { name: 'Ariadne', kind: 'human', colorId: 'Gold', aiProfileId: undefined },
      { name: 'CPU 1', kind: 'ai', colorId: 'Blue', aiProfileId: 'aggressive', aiDifficultyId: 'normal' },
    ] })
  })
  it('enforces the original two-player minimum and variant caps of three, six and nine', async () => {
    await render()
    await click(host.querySelector('[aria-label="Remove CPU 2"]')!)
    expect(host.querySelectorAll('.setup-player-row')).toHaveLength(2)
    expect(host.querySelector('[aria-label^="Remove "]')).toBeNull()
    for (const [variant, cap] of [['Default', 6], ['Abyssal9', 9], ['Abyssal3', 3]] as const) {
      await edit('Game variant', variant)
      for (let attempts = 0; attempts < 10 && !button('Add player').disabled; attempts++) await click(button('Add player'))
      expect(host.querySelectorAll('.setup-player-row')).toHaveLength(cap)
      expect(button('Add player').disabled).toBe(true)
      expect(host.querySelector<HTMLInputElement>('[aria-label="Player 1 name"]')).not.toBeNull()
      expect(host.querySelector('.lobby-create .hint')!.textContent).toContain(`up to ${cap} players`)
    }
    await click(button('Begin campaign'))
    expect(onStart.mock.calls[0][0].players).toHaveLength(3)
    expect(onStart.mock.calls[0][0].variantName).toBe('Abyssal3')
  })
  it('keeps the actual lobby mounted and connected while editing setup/appearance, and forwards the selected variant to online creation', async () => {
    await render()
    const panel = host.querySelector('.lobby-panel')
    expect(session.getSnapshot().connection).toBe('online')
    expect(server.connects).toHaveLength(1)
    const details = host.querySelector('details')!
    details.open = true
    await click(host.querySelector('input[aria-label="Animated mode"]')!)
    await edit('Game variant', 'Abyssal9')
    expect(host.querySelector('.lobby-panel')).toBe(panel)
    expect(server.connects).toHaveLength(1)
    expect(button('Create').disabled).toBe(false)
    await act(async () => { button('Create').click(); await server.settle(20) })
    expect(session.getSnapshot().world!.variant).toBe('Abyssal9')
    expect(session.getSnapshot().world!.maxPlayers).toBe(9)
    expect(onStart).not.toHaveBeenCalled()
    expect(onOnlineEnter).not.toHaveBeenCalled()
  })
  it('shows real saved metadata and invokes only the existing continue callback', async () => {
    const game = twoPlayerGame(4)
    game.turnNumber = 3; game.phase = 'Move'
    saveGameToLocalStorage(game)
    const savedGame = peekSavedGameMeta()!
    await render({ savedGame, onContinue })
    const resume = host.querySelector('[aria-label="Continue saved game"]')!
    expect(resume.textContent).toContain(savedGame.variantName)
    expect(resume.textContent).toContain(savedGame.players)
    expect(resume.textContent).toContain('Turn 3 · Move')
    await click(button('Load saved game'))
    expect(onContinue).toHaveBeenCalledOnce()
    expect(onStart).not.toHaveBeenCalled()
    await render({ savedGame, onContinue: undefined })
    expect(host.querySelector('[aria-label="Continue saved game"]')).toBeNull()
  })
  it('provides native hero anchors to always-mounted setup/lobby targets and a local decorative hero in both modes', async () => {
    setPresentationMode('classic')
    await render()
    for (const link of host.querySelectorAll<HTMLAnchorElement>('.setup-hero-actions a')) {
      const target = host.querySelector(link.getAttribute('href')!)!
      expect(target).not.toBeNull()
      expect(target.getAttribute('tabindex')).toBe('-1')
      expect(link.hasAttribute('role')).toBe(false)
    }
    const art = host.querySelector<HTMLImageElement>('.setup-hero-art')!
    expect(art.getAttribute('src')).toBe(`${import.meta.env.BASE_URL}title-screen/colossus-landscape-v1.png`)
    expect(art.alt).toBe('')
    expect(host.querySelectorAll('h1')).toHaveLength(1)
    await act(async () => setPresentationMode('animated'))
    expect(host.querySelector('.setup-hero-art')).toBe(art)
    expect(onStart).not.toHaveBeenCalled()
    expect(onOnlineEnter).not.toHaveBeenCalled()
  })
  it('exposes one checked Animated mode checkbox outside closed Appearance and retains Classic after remount', async () => {
    await render()
    const checkbox = host.querySelector<HTMLInputElement>('.setup-nav input[aria-label="Animated mode"]')!
    expect(checkbox.type).toBe('checkbox')
    expect(checkbox.checked).toBe(true)
    expect(host.querySelectorAll('input[aria-label="Animated mode"]')).toHaveLength(1)
    expect(host.querySelector('details')!.open).toBe(false)
    expect(checkbox.closest('details')).toBeNull()
    expect(host.querySelector('details select[aria-label="Background atmosphere"]')).not.toBeNull()
    await click(checkbox)
    expect(checkbox.checked).toBe(false)
    expect(getPresentationMode()).toBe('classic')
    expect(localStorage.getItem('colossus.presentationMode')).toBe('classic')
    await act(async () => root.render(null))
    await render()
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Animated mode"]')!.checked).toBe(false)
    expect(server.connects).toHaveLength(1)
  })
})

describe('per-seat AI difficulty setup', () => {
  it('keeps difficulty independent of personality and retains it across kind toggles', async () => {
    await render()
    expect(host.querySelector<HTMLSelectElement>('[aria-label="CPU 1 AI difficulty"]')!.value).toBe('normal')
    await edit('CPU 1 AI difficulty', 'hard'); await edit('CPU 1 AI personality', 'cautious')
    await edit('CPU 1 type', 'human')
    expect(host.querySelector('[aria-label="CPU 1 AI difficulty"]')).toBeNull()
    await click(button('Begin campaign'))
    expect(onStart.mock.calls[0][0].players[1]).not.toHaveProperty('aiDifficultyId')
    onStart.mockReset(); await edit('CPU 1 type', 'ai')
    expect(host.querySelector<HTMLSelectElement>('[aria-label="CPU 1 AI difficulty"]')!.value).toBe('hard')
    expect(host.querySelector<HTMLSelectElement>('[aria-label="CPU 1 AI personality"]')!.value).toBe('cautious')
    await edit('CPU 2 AI difficulty', 'easy'); await click(button('Begin campaign'))
    expect(onStart.mock.calls[0][0].players.map((p: { aiDifficultyId?: string }) => p.aiDifficultyId)).toEqual([undefined, 'hard', 'easy'])
    expect(onStart.mock.calls[0][0].players[0]).not.toHaveProperty('aiDifficultyId')
    expect(server.connects).toHaveLength(1)
  })
  it('adds Normal seats and retains other selections when removing a player', async () => {
    await render(); await edit('CPU 1 AI difficulty', 'hard'); await click(button('Add player'))
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Player 4 AI difficulty"]')!.value).toBe('normal')
    await click(host.querySelector('[aria-label="Remove CPU 2"]')!); await click(button('Begin campaign'))
    expect(onStart.mock.calls[0][0].players.map((p: { aiDifficultyId?: string }) => p.aiDifficultyId)).toEqual([undefined, 'hard', 'normal'])
  })
})
