import { battleCameraFocus, validCameraRect, type BattleCameraBoundary, type CameraRect } from './battleCamera'
import './battleCamera.css'

export interface CameraSnapshot { svg: SVGSVGElement; rect: CameraRect; classes: string; presentation: string | null; prefix: string }
export interface CameraCapture { boundary: BattleCameraBoundary; outgoing: CameraSnapshot; hex: CameraRect | null }

/** Clone the already-revealed SVG only. No canvas/rasterization or game data renderer.
 * Every local SVG ID/reference is namespaced so snapshots cannot steal live defs. */
export function cloneCameraSvg(source: SVGSVGElement, prefix: string): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement
  // cloneNode does not copy an existing canvas bitmap (unsupported creature art
  // can use the Classic leaf). Copy that already-rendered token, never rasterize HTML.
  const canvases = clone.querySelectorAll('canvas')
  source.querySelectorAll('canvas').forEach((canvas, index) => {
    const context = canvases[index].getContext('2d')
    if (!context) throw Error('Cannot copy an existing creature token into the battle camera.')
    if (canvas.width && canvas.height) context.drawImage(canvas, 0, 0)
  })
  clone.querySelectorAll('script, button, input, select, textarea, a').forEach(node => node.remove())
  clone.querySelectorAll('[data-legion]').forEach(node => node.classList.add('battle-camera-legion'))
  const nodes = [clone, ...clone.querySelectorAll('*')]
  const ids = new Map<string, string>()
  for (const node of nodes) if (node.id) { ids.set(node.id, `${prefix}-${node.id}`); node.id = ids.get(node.id)! }
  for (const node of nodes) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name
      if (name.startsWith('on') || name === 'tabindex' || ['data-hex', 'data-battle-hex', 'data-legion', 'data-unit', 'data-unit-id'].includes(name)) node.removeAttribute(name)
      else {
        let value = attribute.value.replace(/url\((['"]?)#([^)'"\s]+)\1\)/g, (whole, _quote: string, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : whole)
        if ((name === 'href' || name === 'xlink:href') && value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`
        if (value !== attribute.value) node.setAttribute(name, value)
      }
    }
  }
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('focusable', 'false')
  clone.style.width = '100%'; clone.style.height = '100%'; clone.style.maxHeight = 'none'
  return clone
}

export function cameraSnapshot(svg: SVGSVGElement, prefix: string): CameraSnapshot | null {
  const rect = svg.getBoundingClientRect()
  // A hidden/unlaid-out board has no spatial source; do not invent one.
  if (!validCameraRect(rect)) return null
  return { svg: cloneCameraSvg(svg, prefix), prefix, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    classes: svg.parentElement?.getAttribute('class') ?? '', presentation: svg.parentElement?.getAttribute('data-presentation') ?? null }
}

function frame(snapshot: CameraSnapshot, bounds: CameraRect, layer: string): HTMLDivElement {
  const node = document.createElement('div')
  node.className = `battle-camera-frame ${snapshot.classes}`
  node.dataset.cameraLayer = layer
  if (snapshot.presentation) node.dataset.presentation = snapshot.presentation
  Object.assign(node.style, { left: `${snapshot.rect.left - bounds.left}px`, top: `${snapshot.rect.top - bounds.top}px`, width: `${snapshot.rect.width}px`, height: `${snapshot.rect.height}px` })
  node.append(snapshot.svg)
  return node
}

/** One quiet copy lets native labels/markers/gates dissolve as the camera nears
 * the landscape, with ONE opacity animation rather than hundreds of element timelines. */
function quietMainScene(snapshot: CameraSnapshot, parent: HTMLElement) {
  const scene = cloneCameraSvg(snapshot.svg, `${snapshot.prefix}-scene`)
  scene.dataset.cameraScene = 'quiet'
  scene.querySelectorAll('.modern-hex-labels, .modern-gate-layer, .battle-camera-legion, .modern-legion-marker, .recruit-preview, .muster-pending, .muster-done, .move-anim, .legal-hex-ring, .legal-hex-stroke, .preview-hex-ring, .preview-hex-stroke, .split-hex-ring').forEach(node => node.remove())
  parent.prepend(scene)
}

/** One inert, clipped presentation overlay; the actual boards/state swap immediately.
 * WAAPI owns timing. Cleanup cancels both animations and their observers, with no RAF/timer. */
export function showBattleCamera(capture: CameraCapture, incoming: CameraSnapshot, hex: CameraRect | null,
  pane: CameraRect, reducedMotion: boolean, onFailure: (error: unknown) => void, onClosed: () => void): (() => void) | null {
  const left = Math.max(0, pane.left), top = Math.max(0, pane.top)
  const bounds = { left, top, width: Math.min(window.innerWidth, pane.left + pane.width) - left, height: Math.min(window.innerHeight, pane.top + pane.height) - top }
  if (!validCameraRect(bounds)) return null
  const root = document.createElement('div')
  root.className = 'battle-camera-overlay'
  root.setAttribute('aria-hidden', 'true'); root.inert = true
  root.dataset.cameraDirection = capture.boundary.direction; root.dataset.cameraHex = capture.boundary.hexLabel
  root.dataset.cameraMotion = reducedMotion ? 'fade' : 'zoom'
  root.dataset.cameraStage = 'transition'
  Object.assign(root.style, { left: `${left}px`, top: `${top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` })
  const from = frame(capture.outgoing, bounds, 'outgoing'), to = frame(incoming, bounds, 'incoming')
  if (capture.boundary.direction === 'enter') to.style.transformOrigin = '50% 50%'
  else from.style.transformOrigin = '50% 50%'
  root.append(to, from)
  const animations: Animation[] = []
  let closed = false
  const cleanup = () => {
    if (closed) return
    closed = true
    window.removeEventListener('resize', cleanup)
    window.removeEventListener('scroll', cleanup, true)
    window.visualViewport?.removeEventListener('resize', cleanup)
    window.visualViewport?.removeEventListener('scroll', cleanup)
    for (const animation of animations) animation.cancel()
    root.remove()
    onClosed()
  }
  try {
    const main = capture.boundary.direction === 'enter' ? capture.outgoing : incoming
    const destination = capture.boundary.direction === 'enter' ? incoming : capture.outgoing
    if (!reducedMotion && !hex) throw Error('Battle camera is missing contested-hex geometry.')
    const focus = reducedMotion ? 'none' : battleCameraFocus(main.rect, hex!, destination.rect).transform
    const duration = reducedMotion ? 150 : 820
    const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' }
    if (!reducedMotion) quietMainScene(main, capture.boundary.direction === 'enter' ? from : to)
    document.body.append(root)
    if (reducedMotion) {
      animations.push(from.animate([{ opacity: 1 }, { opacity: 0 }], options))
    } else if (capture.boundary.direction === 'enter') {
      animations.push(from.animate([{ transform: 'none', opacity: 1 }, { offset: .58, transform: focus, opacity: 1 }, { offset: .9, transform: focus, opacity: 0 }, { transform: focus, opacity: 0 }], options))
      animations.push(to.animate([{ transform: 'rotate(-7deg) scale(.88)', opacity: 0 }, { offset: .42, transform: 'rotate(-7deg) scale(.88)', opacity: 0 }, { offset: .9, transform: 'none', opacity: 1 }, { transform: 'none', opacity: 1 }], options))
    } else {
      animations.push(to.animate([{ transform: focus, opacity: 0 }, { offset: .28, transform: focus, opacity: 1 }, { transform: 'none', opacity: 1 }], options))
      animations.push(from.animate([{ transform: 'none', opacity: 1 }, { offset: .5, transform: 'rotate(-7deg) scale(.88)', opacity: 0 }, { transform: 'rotate(-7deg) scale(.88)', opacity: 0 }], options))
    }
    if (!reducedMotion) animations.push(main.svg.animate(capture.boundary.direction === 'enter'
      ? [{ opacity: 1 }, { offset: .24, opacity: 0 }, { opacity: 0 }]
      : [{ opacity: 0 }, { offset: .65, opacity: 0 }, { opacity: 1 }], options))
    window.addEventListener('resize', cleanup)
    window.addEventListener('scroll', cleanup, true)
    window.visualViewport?.addEventListener('resize', cleanup)
    window.visualViewport?.addEventListener('scroll', cleanup)
    // Watch every animation so a browser failure cannot leave a covering snapshot.
    Promise.all(animations.map(animation => animation.finished)).then(cleanup, error => { if (!closed) { cleanup(); onFailure(error) } })
  } catch (error) { cleanup(); onFailure(error) }
  return closed ? null : cleanup
}
