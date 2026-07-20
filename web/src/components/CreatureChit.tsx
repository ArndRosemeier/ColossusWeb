import { useEffect, useRef, useState } from 'react'
import { CREATURE_COLORS, creatureImageUrl, loadAssetManifest } from '../variant/assets'

interface ChitProps {
  creature: string
  power: number
  skill: number
  baseColor?: string
  size?: number
  title?: string
  className?: string
}

/**
 * Colossus-style creature chit: base art + power (bottom-left) + skill (bottom-right) + name.
 */
export function CreatureChit({
  creature,
  power,
  skill,
  baseColor = 'black',
  size = 48,
  title,
  className,
}: ChitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

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
        ctx.drawImage(img, 0, 0, size, size)

        const color = CREATURE_COLORS[baseColor] ?? CREATURE_COLORS.black ?? '#000'
        const fontsize = Math.max(8, Math.round(size / 5))
        ctx.font = `bold ${fontsize}px sans-serif`
        ctx.lineWidth = Math.max(2, size / 24)
        ctx.strokeStyle = '#fff'
        ctx.fillStyle = color

        const powerTxt = power > 0 ? String(power) : 'X'
        ctx.strokeText(powerTxt, 2, size - 3)
        ctx.fillText(powerTxt, 2, size - 3)

        const skillTxt = String(skill)
        const sw = ctx.measureText(skillTxt).width
        ctx.strokeText(skillTxt, size - sw - 2, size - 3)
        ctx.fillText(skillTxt, size - sw - 2, size - 3)

        // Name at top
        let nameSize = Math.max(7, Math.round(size / 6.5))
        ctx.font = `bold ${nameSize}px sans-serif`
        let nameWidth = ctx.measureText(creature).width
        while (nameWidth > size - 4 && nameSize > 6) {
          nameSize -= 1
          ctx.font = `bold ${nameSize}px sans-serif`
          nameWidth = ctx.measureText(creature).width
        }
        const nx = (size - nameWidth) / 2
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = Math.max(2, size / 20)
        ctx.strokeText(creature, nx, nameSize + 1)
        ctx.fillStyle = color
        ctx.fillText(creature, nx, nameSize + 1)
      }
      img.onerror = () => {
        if (!cancelled) setFailed(true)
      }
      img.src = creatureImageUrl(creature)
    })
    return () => {
      cancelled = true
    }
  }, [creature, power, skill, baseColor, size])

  if (failed) {
    return (
      <img
        className={className}
        src={creatureImageUrl('Unknown')}
        alt={title ?? creature}
        title={title ?? creature}
        width={size}
        height={size}
        style={{ imageRendering: 'pixelated' }}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      title={title ?? `${creature} ${power}-${skill}`}
      style={{ imageRendering: 'pixelated', width: size, height: size }}
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
      style={{ imageRendering: 'pixelated' }}
      onError={() => {
        if (!current.endsWith('Unknown.gif')) {
          setCurrent(creatureImageUrl('Unknown'))
        }
      }}
    />
  )
}
