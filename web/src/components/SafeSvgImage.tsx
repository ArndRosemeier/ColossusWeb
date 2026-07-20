import { useEffect, useState } from 'react'
import { creatureImageUrl } from '../variant/assets'

interface Props {
  href: string
  x: number
  y: number
  width: number
  height: number
  clipPath?: string
  opacity?: number
  preserveAspectRatio?: string
}

/** SVG image that swaps to Unknown.gif if the primary asset fails. */
export function SafeSvgImage({
  href,
  x,
  y,
  width,
  height,
  clipPath,
  opacity = 1,
  preserveAspectRatio = 'xMidYMid slice',
}: Props) {
  const [src, setSrc] = useState(href)
  useEffect(() => {
    setSrc(href)
  }, [href])
  return (
    <image
      href={src}
      x={x}
      y={y}
      width={width}
      height={height}
      clipPath={clipPath}
      opacity={opacity}
      preserveAspectRatio={preserveAspectRatio}
      onError={() => {
        const fallback = creatureImageUrl('Unknown')
        if (src !== fallback) setSrc(fallback)
      }}
    />
  )
}
