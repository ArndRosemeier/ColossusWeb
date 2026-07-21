import { useEffect, useRef, useState } from 'react'
import { isDarkMarkerFill, loadAssetManifest, markerImageUrl, markerPlainColor } from '../variant/assets'

interface MarkerChitProps {
  markerId: string
  /**
   * Plain fill color. Prefer the owning player's color so captured markers
   * (foreign marker ids) match the victor. Defaults to the marker-id prefix color.
   */
  color?: string
  size?: number
  /** Legion height shown like Colossus Marker.showHeight */
  height?: number
  title?: string
  className?: string
}

/**
 * Colossus-style legion marker: Plain fill + transparent symbol overlay.
 * Marker PNGs are palette+tRNS; without the fill they look invisible.
 */
export function MarkerChit({
  markerId,
  color,
  size = 36,
  height,
  title,
  className,
}: MarkerChitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const fill = color ?? markerPlainColor(markerId)
  const dark = isDarkMarkerFill(fill)

  useEffect(() => {
    let cancelled = false
    void loadAssetManifest().then(() => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const img = new Image()
      img.onload = () => {
        if (cancelled) return
        ctx.clearRect(0, 0, size, size)
        // Plain-{Color}Colossus
        ctx.fillStyle = fill
        ctx.fillRect(0, 0, size, size)
        ctx.drawImage(img, 0, 0, size, size)
        // Dark fills get a light border so they read on dark boards
        ctx.strokeStyle = dark ? '#ffffff' : '#000000'
        ctx.lineWidth = Math.max(1, size / 28)
        ctx.strokeRect(0.5, 0.5, size - 1, size - 1)

        if (height != null && height > 0) {
          const txt = String(height)
          const fontsize = Math.max(9, Math.round(size * 0.38))
          ctx.font = `bold ${fontsize}px sans-serif`
          const tw = ctx.measureText(txt).width
          const pad = 1
          const bx = size * 0.72 - tw / 2
          const by = size * 0.68
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(bx - pad, by - fontsize + 2, tw + pad * 2, fontsize)
          ctx.fillStyle = '#000000'
          ctx.fillText(txt, bx, by)
        }
      }
      img.onerror = () => {
        if (!cancelled) setFailed(true)
      }
      img.src = markerImageUrl(markerId)
    })
    return () => {
      cancelled = true
    }
  }, [markerId, fill, size, height, dark])

  if (failed) {
    return (
      <span
        className={className}
        title={title ?? markerId}
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          background: fill,
          border: dark ? '1px solid #fff' : '1px solid #000',
          boxSizing: 'border-box',
          imageRendering: 'pixelated',
        }}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      title={title ?? markerId}
      style={{ imageRendering: 'pixelated', width: size, height: size, verticalAlign: 'middle' }}
    />
  )
}
