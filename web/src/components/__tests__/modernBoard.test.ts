// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MasterBoardView } from '../MasterBoardView'
import { MasterHexGates } from '../MasterHexGates'
import { MarkerChit } from '../MarkerChit'
import { MarkerArtwork } from '../MarkerArtwork'
import { arrowTriple, archGeometry, blockOutline, gateLen, pts } from '../gateGeometry'
import { setPresentationMode } from '../../ui/presentationMode'
import { CreatureAssetErrorContext } from '../../ui/creaturePresentation'
import { MODERN_TERRAINS, modernTerrainUrl } from '../../ui/modernBoard'
import { markerInk } from '../../ui/markerArtwork'
import { PLAYER_COLORS } from '../../engine/types'
import { createGame } from '../../engine/GameEngine'
import { loadAssetManifest } from '../../variant/assets'
import { KNOWN_VARIANTS } from '../../variant/loadVariant'
import { loadNamedVariant, twoPlayerGame } from '../../engine/__tests__/helpers'
import type { GateType } from '../../types/variant'

vi.mock('../../variant/assets', async original => ({
  ...await original<typeof import('../../variant/assets')>(), loadAssetManifest: vi.fn(() => new Promise(() => {})),
}))
let host: HTMLDivElement, root: Root
const notify = vi.fn()
let reduced = false
const listeners = new Set<() => void>()
async function render(node: ReactNode) { await act(async () => root.render(createElement(CreatureAssetErrorContext.Provider, { value: notify }, node))) }
function markup(node: ReactNode): Element { const document = new DOMParser().parseFromString(renderToStaticMarkup(node), 'text/html'); return document.body }
const VERTS: [number, number][] = Array.from({ length: 6 }, (_, i) => [30 * Math.cos(i * Math.PI / 3), 30 * Math.sin(i * Math.PI / 3)])
const NONE: GateType[] = Array(6).fill('NONE')

beforeEach(() => {
  setPresentationMode('classic'); reduced = false; notify.mockReset(); vi.mocked(loadAssetManifest).mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); listeners.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('shared full-color legion marker', () => {
  for (const color of PLAYER_COLORS.slice(0, 9)) {
    it(`${color.id}: keeps the exact owner face and a readable high-contrast full ID`, () => {
      const marker = markup(createElement(MarkerArtwork, { markerId: 'Bu01', color: color.css, size: 28, height: 7 }))
      expect(marker.querySelector('.marker-owner-face')!.getAttribute('fill')).toBe(color.css)
      expect(marker.querySelector('.marker-full-id')!.textContent).toBe('Bu01')
      expect(marker.querySelector('.marker-count text')!.textContent).toBe('7')
      const luminance = (hex: string) => {
        const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
      }
      const values = [luminance(color.css), luminance(markerInk(color.css))].sort((a, b) => a - b)
      expect((values[1] + .05) / (values[0] + .05)).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('distinguishes own and captured full IDs with the same owner color and retains accessible count/identity', () => {
    const markers = markup(createElement('div', null,
      createElement(MarkerArtwork, { markerId: 'Rd01', color: '#bd0018', height: 4 }),
      createElement(MarkerArtwork, { markerId: 'Bu01', color: '#bd0018', height: 6 })))
    expect([...markers.querySelectorAll('.marker-owner-face')].map(face => face.getAttribute('fill'))).toEqual(['#bd0018', '#bd0018'])
    expect([...markers.querySelectorAll('.marker-full-id')].map(text => text.textContent)).toEqual(['Rd01', 'Bu01'])
    expect(markers.querySelectorAll('.marker-crest')[0].getAttribute('d')).not.toBe(markers.querySelectorAll('.marker-crest')[1].getAttribute('d'))
    expect(markers.querySelector('[data-marker-id="Bu01"]')!.getAttribute('aria-label')).toContain('Bu01; owner color #bd0018; 6 creatures')
  })
  it('keeps Classic HTML canvas props/markup and switches all HTML marker uses to the same vector art without raster loads', async () => {
    await render(createElement(MarkerChit, { markerId: 'Rd01', size: 28, height: 5, title: 'Custom', className: 'custom-marker' }))
    const classic = host.innerHTML
    expect(host.querySelector('canvas')!.getAttribute('title')).toBe('Custom')
    expect(host.querySelector('.modern-legion-marker')).toBeNull()
    vi.mocked(loadAssetManifest).mockClear()
    await act(async () => setPresentationMode('animated'))
    expect(host.querySelector('.modern-legion-marker.custom-marker')!.getAttribute('data-marker-id')).toBe('Rd01')
    expect(host.querySelector('image, img, canvas')).toBeNull()
    expect(loadAssetManifest).not.toHaveBeenCalled()
    await act(async () => setPresentationMode('classic'))
    expect(host.innerHTML).toBe(classic)
  })
})

describe('modern gates share one Classic mark-placement loop', () => {
  for (const inverted of [false, true]) {
    it(`dispatches exactly the same alternating edge/exit/entrance anchors (${inverted ? 'inverted' : 'normal'})`, () => {
      const rendered = markup(createElement(MasterHexGates, { verts: VERTS, inverted, exitType: Array(6).fill('BLOCK'), entranceType: Array(6).fill('ARCH'), scale: 30, mode: 'animated' }))
      const marks = [...rendered.querySelectorAll('[data-gate-type]')]
      expect(marks).toHaveLength(6)
      const edges = inverted ? [0, 2, 4] : [1, 3, 5]
      expect(marks.map(m => Number(m.getAttribute('data-edge')))).toEqual(edges.flatMap(i => [i, i]))
      for (const mark of marks) {
        const i = Number(mark.getAttribute('data-edge')), entrance = mark.getAttribute('data-direction') === 'entrance'
        expect(mark.getAttribute('data-gate-type')).toBe(entrance ? 'ARCH' : 'BLOCK')
        expect(mark.getAttribute('data-from')).toBe(VERTS[entrance ? (i + 1) % 6 : i].join(','))
        expect(mark.getAttribute('data-to')).toBe(VERTS[entrance ? i : (i + 1) % 6].join(','))
      }
      expect(new Set(marks.map(m => `${m.getAttribute('data-edge')}:${m.getAttribute('data-direction')}`)).size).toBe(6)
    })
  }
  it('keeps ARCH truly round with an inner portal and BLOCK a square bar at the same geometry anchors', () => {
    const render = (gate: GateType) => markup(createElement(MasterHexGates, { verts: VERTS, inverted: false, exitType: ['NONE', gate, 'NONE', 'NONE', 'NONE', 'NONE'], entranceType: NONE, scale: 30, mode: 'animated' }))
    const arch = render('ARCH'), block = render('BLOCK')
    expect(arch.querySelector('.modern-arch-cap')!.getAttribute('d')).toBe(archGeometry(...VERTS[1], ...VERTS[2], 30).cap)
    expect(arch.querySelectorAll('.modern-gate-arch path')).toHaveLength(2)
    expect(block.querySelector('.modern-gate-block polygon')!.getAttribute('points')).toBe(pts(blockOutline(...VERTS[1], ...VERTS[2], 30)))
    expect(block.querySelector('path')).toBeNull()
  })
  for (const gate of ['ARROW', 'ARROWS'] as const) {
    it(`${gate}: uses one or three actual arrowhead polygons pointing through the correct normal, including reversed entrances`, () => {
      const document = markup(createElement(MasterHexGates, { verts: VERTS, inverted: false, exitType: Array(6).fill(gate), entranceType: Array(6).fill(gate), scale: 30, mode: 'animated' }))
      for (const mark of document.querySelectorAll('[data-gate-type]')) {
        const from = mark.getAttribute('data-from')!.split(',').map(Number), to = mark.getAttribute('data-to')!.split(',').map(Number)
        const heads = [...mark.querySelectorAll('.modern-arrow-outline')]
        expect(heads).toHaveLength(gate === 'ARROW' ? 1 : 3)
        heads.forEach((head, index) => {
          const triangle = head.getAttribute('points')!.split(' ').map(p => p.split(',').map(Number))
          expect(head.getAttribute('points')).toBe(pts(arrowTriple(index, from[0], from[1], to[0], to[1], Math.atan2(to[1] - from[1], to[0] - from[0]), gateLen(30))))
          const tip = triangle[1]
          expect((to[0] - from[0]) * (tip[1] - from[1]) - (to[1] - from[1]) * (tip[0] - from[0])).toBeLessThan(0)
        })
      }
    })
  }
})

describe('complete Animated master-board visual layer', () => {
  it('covers every shipped terrain with exact approved 256px RGBA assets and provenance', () => {
    const names = new Set(KNOWN_VARIANTS.flatMap(name => Object.values(loadNamedVariant(name).board.hexByLabel).map(hex => hex.terrain)))
    expect([...names].sort()).toEqual(Object.keys(MODERN_TERRAINS).sort())
    const provenance = JSON.parse(readFileSync(resolve('../docs/design/modern-board-terrain.provenance.json'), 'utf8'))
    for (const entry of provenance.terrains) {
      const bytes = readFileSync(resolve('public/board-art/terrain-v1', entry.file))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20), bytes[25]]).toEqual([256, 256, 6])
      expect(modernTerrainUrl(entry.name)).toContain(`/board-art/terrain-v1/${entry.file}`)
    }
    expect(provenance.terrains).toHaveLength(12)
  })
  it('preserves exact Classic roundtrip DOM and polygon hit geometry while modern labels remain stationary under live reduced motion', async () => {
    const state = twoPlayerGame(31), onHexClick = vi.fn(), onLegionClick = vi.fn()
    await render(createElement(MasterBoardView, { state, onHexClick, onLegionClick }))
    const classic = host.innerHTML
    const points = [...host.querySelectorAll('[data-hex] > polygon:first-child')].map(p => p.getAttribute('points'))
    await act(async () => setPresentationMode('animated'))
    expect(host.querySelector('.modern-board')!.getAttribute('data-presentation')).toBe('animated')
    expect([...host.querySelectorAll('.modern-hex-surface')].map(p => p.getAttribute('points'))).toEqual(points)
    expect(host.querySelectorAll('.modern-terrain-name')).toHaveLength(points.length)
    expect(host.querySelectorAll('.modern-hex-number')).toHaveLength(points.length)
    const labels = [...host.querySelectorAll('.modern-hex-labels')].map(label => label.outerHTML)
    expect(host.querySelector('.modern-hex-labels')!.closest('.master-terrain-motion')).toBeNull()
    await act(async () => { reduced = true; for (const listener of [...listeners]) listener() })
    expect(host.querySelector('.master-terrain-motion')).toBeNull()
    expect(host.querySelectorAll('.modern-terrain-art')).toHaveLength(points.length)
    expect([...host.querySelectorAll('.modern-hex-labels')].map(label => label.outerHTML)).toEqual(labels)
    await act(async () => host.querySelector('[data-hex]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onHexClick).toHaveBeenCalledWith(Object.keys(state.variant.board.hexByLabel)[0])
    await act(async () => host.querySelector('[data-legion]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onLegionClick).toHaveBeenCalledWith(state.legions[0].id)
    await act(async () => setPresentationMode('classic'))
    expect(host.innerHTML).toBe(classic)
  })
  it('paints one final decorative gate layer above every terrain face, below markers, with metadata-exact gate counts', async () => {
    setPresentationMode('animated')
    const state = twoPlayerGame(31)
    await render(createElement(MasterBoardView, { state, onHexClick: vi.fn(), onLegionClick: vi.fn() }))
    const layer = host.querySelector('.modern-gate-layer')!
    expect(layer.getAttribute('pointer-events')).toBe('none')
    expect(layer.querySelector('[data-hex]')).toBeNull()
    expect(layer.compareDocumentPosition(host.querySelectorAll('[data-hex]')[95]) & Node.DOCUMENT_POSITION_PRECEDING).not.toBe(0)
    expect(layer.compareDocumentPosition(host.querySelector('[data-legion]')!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    for (const hex of Object.values(state.variant.board.hexByLabel)) {
      const edges = hex.inverted ? [0, 2, 4] : [1, 3, 5]
      const marks = [...host.querySelectorAll(`[data-gate-hex="${hex.label}"] [data-gate-type]`)]
      const expected = edges.flatMap(i => [['exit', hex.exitType[i]], ['entrance', hex.entranceType[i]]].filter(([, type]) => type !== 'NONE').map(([direction, type]) => `${i}:${direction}:${type}`))
      expect(marks.map(m => `${m.getAttribute('data-edge')}:${m.getAttribute('data-direction')}:${m.getAttribute('data-gate-type')}`)).toEqual(expected)
    }
  })
  it('supports Abyssal9 art, unique board definitions, and visibly reports a required terrain failure without Unknown art', async () => {
    setPresentationMode('animated')
    const state = createGame(loadNamedVariant('Abyssal9'), { players: [{ name: 'Alice', kind: 'human' }, { name: 'Bob', kind: 'human' }], seed: 31 })
    const board = () => createElement(MasterBoardView, { state, onHexClick: vi.fn(), onLegionClick: vi.fn() })
    await render(createElement('div', null, board(), board()))
    const ids = [...host.querySelectorAll('[id]')].map(node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(host.querySelector('.modern-terrain-art[data-terrain="Abyss"] image')!.getAttribute('href')).toContain('/Abyss.png')
    await act(async () => host.querySelector('.modern-terrain-art[data-terrain="Abyss"] image')!.dispatchEvent(new Event('error')))
    expect(notify).toHaveBeenCalledWith('Cannot load modern board terrain artwork: board-art/terrain-v1/Abyss.png')
    expect(host.querySelector('[data-terrain-error="Abyss"]')!.textContent).toContain('Art unavailable')
    expect(host.querySelector('[data-terrain-error] image')).toBeNull()
  })
  it('explicitly retains classic illustration capability for an unfamiliar terrain without claiming a modern asset', async () => {
    setPresentationMode('animated')
    const state = twoPlayerGame(31)
    const hex = Object.values(state.variant.board.hexByLabel)[0]
    hex.terrain = 'CustomBog'
    await render(createElement(MasterBoardView, { state, onHexClick: vi.fn(), onLegionClick: vi.fn() }))
    const tile = host.querySelector(`[data-hex="${hex.label}"]`)!
    expect(tile.querySelector('title')!.textContent).toContain('modern terrain artwork unavailable; classic terrain illustration')
    expect(tile.querySelector('.modern-terrain-art')).toBeNull()
    expect(tile.querySelector('image')!.getAttribute('href')).toContain('CustomBog')
    expect(tile.querySelector('.modern-terrain-name')).toBeNull()
  })
})
