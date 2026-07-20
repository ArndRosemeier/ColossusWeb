import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CREATURE_COLORS, creatureImageUrl, loadAssetManifest } from '../variant/assets'

interface ChitProps {
  creature: string
  power: number
  skill: number
  baseColor?: string
  size?: number
  /** Hits already taken in battle (Colossus red overlay). */
  hits?: number
  title?: string
  className?: string
}

const SMOOTH: CSSProperties = { imageRendering: 'auto' }

/**
 * Colossus-style creature chit: base art + power (bottom-left) + skill (bottom-right) + name.
 * Optional `hits` draws the battle damage count (red on white, top-left).
 * Drawn at source resolution and CSS-scaled with smooth filtering.
 */
export function CreatureChit({
  creature,
  power,
  skill,
  baseColor = 'black',
  size = 48,
  hits = 0,
  title,
  className,
}: ChitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const [pixelSize, setPixelSize] = useState(Math.max(size, 60))

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
        // Keep native (or larger) backing store so SVG/CSS upscales have pixels to filter
        const px = Math.max(img.naturalWidth || 60, img.naturalHeight || 60, size)
        setPixelSize(px)
        canvas.width = px
        canvas.height = px

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.clearRect(0, 0, px, px)
        ctx.drawImage(img, 0, 0, px, px)

        const color = CREATURE_COLORS[baseColor] ?? CREATURE_COLORS.black ?? '#000'
        const fontsize = Math.max(8, Math.round(px / 5))
        ctx.font = `bold ${fontsize}px sans-serif`
        ctx.lineWidth = Math.max(2, px / 24)
        ctx.strokeStyle = '#fff'
        ctx.fillStyle = color

        const powerTxt = power > 0 ? String(power) : 'X'
        ctx.strokeText(powerTxt, 2, px - 3)
        ctx.fillText(powerTxt, 2, px - 3)

        const skillTxt = String(skill)
        const sw = ctx.measureText(skillTxt).width
        ctx.strokeText(skillTxt, px - sw - 2, px - 3)
        ctx.fillText(skillTxt, px - sw - 2, px - 3)

        let nameSize = Math.max(7, Math.round(px / 6.5))
        ctx.font = `bold ${nameSize}px sans-serif`
        let nameWidth = ctx.measureText(creature).width
        while (nameWidth > px - 4 && nameSize > 6) {
          nameSize -= 1
          ctx.font = `bold ${nameSize}px sans-serif`
          nameWidth = ctx.measureText(creature).width
        }
        const nx = (px - nameWidth) / 2
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = Math.max(2, px / 20)
        ctx.strokeText(creature, nx, nameSize + 1)
        ctx.fillStyle = color
        ctx.fillText(creature, nx, nameSize + 1)

        if (hits > 0) {
          const hitFont = Math.max(10, Math.round(px * 0.4))
          ctx.font = `bold ${hitFont}px sans-serif`
          const hitTxt = String(hits)
          const hw = ctx.measureText(hitTxt).width
          const hh = hitFont
          const hx = 2
          const hy = 2
          ctx.fillStyle = '#fff'
          ctx.fillRect(hx, hy, hw + 2, hh)
          ctx.fillStyle = '#e01818'
          ctx.fillText(hitTxt, hx + 1, hy + hh - 1)
        }
      }
      img.onerror = () => {
        if (!cancelled) setFailed(true)
      }
      img.src = creatureImageUrl(creature)
    })
    return () => {
      cancelled = true
    }
  }, [creature, power, skill, baseColor, size, hits])

  const tip =
    title ??
    (hits > 0
      ? `${creature} ${power}-${skill} (${hits} hit${hits === 1 ? '' : 's'})`
      : `${creature} ${power}-${skill}`)

  if (failed) {
    return (
      <img
        className={className}
        src={creatureImageUrl('Unknown')}
        alt={tip}
        title={tip}
        width={size}
        height={size}
        style={{ ...SMOOTH, width: size, height: size }}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={pixelSize}
      height={pixelSize}
      title={tip}
      style={{ ...SMOOTH, width: size, height: size }}
    />
  )
}

interface SafeImgProps {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
  title?: string
}

/** HTML image with Unknown.gif fallback on error. */
export function SafeImg({ src, alt, width, height, className, title }: SafeImgProps) {
  const [current, setCurrent] = useState(src)
  useEffect(() => {
    setCurrent(src)
  }, [src])
  return (
    <img
      className={className}
      src={current}
      alt={alt}
      title={title ?? alt}
      width={width}
      height={height}
      style={SMOOTH}
      onError={() => {
        if (!current.endsWith('Unknown.gif')) {
          setCurrent(creatureImageUrl('Unknown'))
        }
      }}
    />
  )
}
