// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MasterTerrainArt } from '../MasterTerrainArt'
import { MasterBoardView } from '../MasterBoardView'
import { SafeSvgImage } from '../SafeSvgImage'
import { terrainMotionProfile, terrainMotionSplit, terrainMotionTiming } from '../../ui/terrainMotion'
import { setPresentationMode } from '../../ui/presentationMode'
import { loadAssetManifest, setActiveVariant, terrainImageUrl } from '../../variant/assets'
import { twoPlayerGame } from '../../engine/__tests__/helpers'

const props = { href: '/variants/Default/images/Woods.gif', x: 120, y: 80, width: 84, height: 3 * Math.sqrt(3) * 14,
  clipPath: 'url(#hex-clip-25)', hexLabel: '25', animated: true }
let host: HTMLDivElement, root: Root
let reduced = false
const motionListeners = new Set<() => void>()
async function render(element: Parameters<Root['render']>[0]) { await act(async () => root.render(element)) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced,
    addEventListener: (_event: string, listener: () => void) => motionListeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => motionListeners.delete(listener),
  }))
  reduced = false
  setPresentationMode('classic')
  setActiveVariant('reset-for-test'); setActiveVariant('Default')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); motionListeners.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('terrain artwork capability and source geometry', () => {
  it('binds the measured crop contract to the actual Default source GIFs', () => {
    const hashes = {
      'Plains.gif': '3c702c300fa6b3231df496069feaddf5730b0c8533de56648c1df04939f4fb85',
      'Plains_i.gif': 'bbce514fb2c9179a7f1a2f416c6224ea06528fe7e438b1ab163f3c44418f60bc',
      'Brush.gif': 'cf78cae7e998e70cbddde243ae69fa64ccd9a404cf3b8947a0a92dfe44415000',
      'Brush_i.gif': 'bfa5fc6a27db9630d59f6862bdc76fd7d2a228e83fef2fda3a2cd4baeffff575',
      'Jungle.gif': 'ec1e128fe4fa8fd4dc2e9feadaba641b7ed3a9cb8bbbc5d152039bcc9e3e85e1',
      'Jungle_i.gif': '97a44fc137ad4d693cc22e31dfb958c7232e056be88d0871e0450d8c5bf27660',
      'Woods.gif': 'f0fb7fbd9e0068413c2b178a1017b44fbe6c21bcbe541c0a34691bd7c7008c41',
      'Woods_i.gif': '488ac9963781dc666a8b3bdd3d6fa2a7d6a6e9564b7cef8cc149bdc052c87b99',
      'Marsh.gif': 'e49ae3c22dba95d5116c4d38b76af3f139f334b4e78ac8dec60a324891e30e86',
      'Marsh_i.gif': 'aaf512771d40df5a8d8a722fa1b5ffa7dcd6907b3f6f73282526b0324ced27b4',
      'Swamp.gif': '7d0ab447a2ba3c7c518c95fa2fc7763d7c2e23e12a92d6f37641ab51482585c6',
      'Swamp_i.gif': 'bac2f6219efc4cbf6f39ba413f1105c10427a7f3bbcde0d1af7e64fb9defdb62',
      'Desert.gif': 'e94407affe794bf082d34537801422a1f37ed803f2da6a3c2f1e617f4e137bb8',
      'Desert_i.gif': '8e9934c7d0f9fcf3e87b4dcefefb1af23dfc2c5c4940117d76222c6c3d7c665c',
    }
    for (const [name, hash] of Object.entries(hashes)) {
      const bytes = readFileSync(resolve('public/variants/Default/images', name))
      expect(createHash('sha256').update(bytes).digest('hex'), `Remeasure crop if ${name} changes`).toBe(hash)
    }
  })
  it('recognizes only measured Default illustrations and actual resolved image orientation', () => {
    expect(terrainMotionProfile('/ColossusWeb/variants/Default/images/Woods.gif')).toEqual({ terrain: 'Woods', kind: 'sway', orientation: 'normal', split: 0.37 })
    expect(terrainMotionProfile('/ColossusWeb/variants/Default/images/Woods_i.gif')).toEqual({ terrain: 'Woods', kind: 'sway', orientation: 'inverted', split: 0.66 })
    for (const path of ['variants/ExtTitan/images/Woods.gif', 'variants/Default/images/Unknown.gif', 'variants/Default/images/Tundra.gif',
      'variants/Default/images/Hills.gif', 'variants/Default/images/Mountains_i.gif', 'variants/Default/images/Tower.gif', 'variants/Default/images/Woods.png']) {
      expect(terrainMotionProfile(path), path).toBeNull()
    }
  })
  it('uses the asset resolver fallback orientation instead of guessing from hex.inverted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ['Woods.gif'] })))
    await loadAssetManifest('Default')
    expect(terrainMotionProfile(terrainImageUrl('Woods', false))!.orientation).toBe('normal')
    setActiveVariant('reset-for-test')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ['Woods_i.gif'] })))
    await loadAssetManifest('Default')
    expect(terrainMotionProfile(terrainImageUrl('Woods', true))!.orientation).toBe('inverted')
  })
  it('maps square GIF rows through xMidYMid slice and leaves all measured art outside the fixed label crop', () => {
    const { width, height } = props
    const offsetY = (height - width) / 2
    expect(terrainMotionSplit(width, height, 0.37)).toBeCloseTo(offsetY + width * 0.37)
    expect(terrainMotionSplit(width, height, 0.66)).toBeCloseTo(offsetY + width * 0.66)
    // Woods_i has ink to .651: using the earlier rough .59 crop would chop its tree base.
    expect(terrainMotionSplit(width, height, 0.66)).toBeGreaterThan(offsetY + width * 0.651)
    expect(terrainMotionSplit(width, height, 0.37)).toBeGreaterThan(offsetY + width * 0.359) // lowest normal label ink
    expect(terrainMotionSplit(width, height, 0.66)).toBeLessThan(offsetY + width * 0.671) // first inverted label ink
  })
  it('stably staggers hexes over gentle six-to-eleven-second loops', () => {
    const timings = Array.from({ length: 96 }, (_, i) => terrainMotionTiming(String(i), 'Woods'))
    expect(new Set(timings.map(t => t.delay)).size).toBeGreaterThan(40)
    expect(terrainMotionTiming('25', 'Woods')).toEqual(terrainMotionTiming('25', 'Woods'))
    for (const timing of timings) {
      expect(parseFloat(timing.duration)).toBeGreaterThanOrEqual(6)
      expect(parseFloat(timing.duration)).toBeLessThanOrEqual(11)
      expect(parseFloat(timing.delay)).toBeLessThanOrEqual(0)
    }
  })
})

describe('art-only terrain presentation', () => {
  it('emits exactly the original direct SafeSvgImage markup for Classic', () => {
    const original = renderToStaticMarkup(createElement(SafeSvgImage, { href: props.href, x: props.x, y: props.y,
      width: props.width, height: props.height, clipPath: props.clipPath, opacity: 0.9, preserveAspectRatio: 'xMidYMid slice' }))
    expect(renderToStaticMarkup(createElement(MasterTerrainArt, { ...props, animated: false }))).toBe(original)
  })
  it('preserves unknown variant/static terrain markup and blank/missing terrainSrc', () => {
    for (const href of ['/variants/ExtTitan/images/Woods.gif', '/variants/Default/images/Mountains_i.gif', '/variants/Default/images/Tundra.gif']) {
      const markup = renderToStaticMarkup(createElement(MasterTerrainArt, { ...props, href }))
      expect(markup.startsWith('<image ')).toBe(true)
      expect(markup).not.toContain('master-terrain-motion')
    }
    expect(renderToStaticMarkup(createElement(MasterTerrainArt, { ...props, href: '' }))).toBe('')
  })
  for (const orientation of ['normal', 'inverted'] as const) {
    it(`${orientation}: fixes both complementary clips outside the transformed illustration, under a fixed hex clip`, async () => {
      const href = `/variants/Default/images/Woods${orientation === 'inverted' ? '_i' : ''}.gif`
      await render(createElement('svg', null, createElement(MasterTerrainArt, { ...props, href })))
      const outer = host.querySelector('.master-terrain-art')!
      const motion = host.querySelector('.master-terrain-motion')!
      const label = host.querySelector('.master-terrain-label')!
      expect(outer.getAttribute('clip-path')).toBe(props.clipPath)
      expect(outer.getAttribute('data-art-orientation')).toBe(orientation)
      expect(outer.getAttribute('pointer-events')).toBe('none')
      expect(motion.parentElement!.getAttribute('class')).toBe('master-terrain-art-clip')
      expect(motion.hasAttribute('clip-path')).toBe(false)
      expect(label.closest('.master-terrain-motion')).toBeNull()
      expect(label.hasAttribute('style')).toBe(false)
      expect(motion.querySelector('image')!.getAttribute('href')).toBe(href)
      expect(motion.querySelector('text')).toBeNull()
      const [labelRect, artRect] = [...outer.querySelectorAll('clipPath rect')]
      expect(Number(labelRect.getAttribute('height')) + Number(artRect.getAttribute('height'))).toBeCloseTo(props.height)
      expect(Number(orientation === 'normal' ? artRect.getAttribute('y') : labelRect.getAttribute('y')))
        .toBeCloseTo(terrainMotionSplit(props.width, props.height, orientation === 'normal' ? 0.37 : 0.66))
    })
  }
  it('scopes clip IDs uniquely even when multiple boards contain the same hex', async () => {
    await render(createElement('svg', null, createElement(MasterTerrainArt, props), createElement(MasterTerrainArt, props)))
    const ids = [...host.querySelectorAll('clipPath')].map(clip => clip.id)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    for (const group of host.querySelectorAll('[clip-path]')) {
      const reference = group.getAttribute('clip-path')!
      if (reference !== props.clipPath) expect(ids).toContain(reference.slice(5, -1))
    }
  })
  it('returns to the original static image path if a measured terrain image fails', async () => {
    await render(createElement('svg', null, createElement(MasterTerrainArt, props)))
    await act(async () => host.querySelector('.master-terrain-motion image')!.dispatchEvent(new Event('error')))
    expect(host.querySelector('.master-terrain-motion')).toBeNull()
    expect(host.querySelector('svg')!.children).toHaveLength(1)
    expect(host.querySelector('svg')!.children[0].tagName).toBe('image')
  })
  it('uses the existing mode and live reduced-motion subscriptions without moving board labels or click targets', async () => {
    const state = twoPlayerGame(31)
    const onHexClick = vi.fn(), onLegionClick = vi.fn()
    await render(createElement(MasterBoardView, { state, onHexClick, onLegionClick }))
    const classicMarkup = host.innerHTML
    expect(host.querySelector('.master-terrain-motion')).toBeNull()
    const staticLabels = [...host.querySelectorAll('.master-board text')].map(text => text.outerHTML)
    await act(async () => setPresentationMode('animated'))
    expect(host.querySelectorAll('.master-terrain-motion').length).toBeGreaterThan(0)
    expect([...host.querySelectorAll('.master-board text')].map(text => text.outerHTML)).toEqual(staticLabels)
    const hex = host.querySelector('[data-hex]')!
    expect(hex.closest('.master-terrain-motion')).toBeNull()
    await act(async () => hex.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onHexClick).toHaveBeenCalledWith(hex.getAttribute('data-hex'))
    await act(async () => { reduced = true; for (const listener of motionListeners) listener() })
    expect(host.querySelector('.master-terrain-motion')).toBeNull()
    expect(host.innerHTML).toBe(classicMarkup)
    await act(async () => { reduced = false; for (const listener of motionListeners) listener() })
    expect(host.querySelector('.master-terrain-motion')).not.toBeNull()
    await act(async () => setPresentationMode('classic'))
    expect(host.innerHTML).toBe(classicMarkup)
  })
})
