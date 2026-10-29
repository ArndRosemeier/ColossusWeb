// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { loadVariant } from '../../variant/loadVariant'
import { loadAssetManifest } from '../../variant/assets'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { SAVE_STORAGE_KEY, serializeGame } from '../../persistence/saveGame'

vi.mock('../../variant/loadVariant', async original => ({ ...await original<typeof import('../../variant/loadVariant')>(), loadVariant: vi.fn() }))
vi.mock('../../variant/assets', async original => ({ ...await original<typeof import('../../variant/assets')>(), loadAssetManifest: vi.fn() }))
vi.mock('../SetupScreen', () => ({ SetupScreen: ({ onContinue }: { onContinue?: () => void }) => createElement('button', { onClick: onContinue }, 'Load saved game') }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  localStorage.clear(); vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it.each(['difficulty', 'variant', 'manifest'] as const)('shows %s resume failure through the existing App error surface and retains the save', async failure => {
  const game = twoPlayerGame(42), blob = serializeGame(game)
  if (failure === 'difficulty') blob.state.players[1].aiDifficultyId = 'impossible' as never
  const saved = JSON.stringify(blob); localStorage.setItem(SAVE_STORAGE_KEY, saved)
  vi.mocked(loadVariant).mockResolvedValue(game.variant)
  vi.mocked(loadAssetManifest).mockResolvedValue({} as never)
  await act(async () => { root.render(createElement(App)) })
  expect(host.querySelector('button')!.disabled).toBe(false)
  if (failure === 'variant') vi.mocked(loadVariant).mockRejectedValueOnce('Variant unavailable')
  if (failure === 'manifest') vi.mocked(loadAssetManifest).mockRejectedValueOnce(new Error('Manifest unavailable'))
  await act(async () => { host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  const expected = failure === 'difficulty' ? 'Invalid AI difficulty: impossible' : failure === 'variant' ? 'Variant unavailable' : 'Manifest unavailable'
  expect(host.querySelector('.boot.error')!.textContent).toBe(`Error: ${expected}`)
  expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe(saved)
})
