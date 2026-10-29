import { useId, useState } from 'react'
import { terrainMotionProfile, terrainMotionSplit, terrainMotionTiming } from '../ui/terrainMotion'
import { SafeSvgImage } from './SafeSvgImage'

interface Props {
  href: string
  x: number
  y: number
  width: number
  height: number
  clipPath: string
  hexLabel: string
  animated: boolean
}

/** The embedded terrain name stays in a stationary complementary image slice.
 * Only the illustration clone transforms, inside both fixed art and hex clips.
 */
export function MasterTerrainArt({ href, x, y, width, height, clipPath, hexLabel, animated }: Props) {
  const id = `terrain-art-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [failedHref, setFailedHref] = useState<string | null>(null)
  if (!href) return null
  const profile = animated && failedHref !== href ? terrainMotionProfile(href) : null
  // Preserve the original direct renderer and every original image attribute.
  if (!profile) return <SafeSvgImage href={href} x={x} y={y} width={width} height={height}
    clipPath={clipPath} opacity={0.9} preserveAspectRatio="xMidYMid slice" />

  const split = terrainMotionSplit(width, height, profile.split)
  const topArt = profile.orientation === 'inverted'
  const art = { y: topArt ? 0 : split, height: topArt ? split : height - split }
  const label = { y: topArt ? split : 0, height: topArt ? height - split : split }
  const timing = terrainMotionTiming(hexLabel, profile.terrain)
  return (
    <g className="master-terrain-art" data-terrain={profile.terrain} data-art-orientation={profile.orientation}
      clipPath={clipPath} opacity={0.9} pointerEvents="none" onErrorCapture={() => setFailedHref(href)}>
      <svg x={x} y={y} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <clipPath id={`${id}-label`} clipPathUnits="userSpaceOnUse">
            <rect x={0} y={label.y} width={width} height={label.height} />
          </clipPath>
          <clipPath id={`${id}-art`} clipPathUnits="userSpaceOnUse">
            <rect x={0} y={art.y} width={width} height={art.height} />
          </clipPath>
        </defs>
        <g className="master-terrain-label" clipPath={`url(#${id}-label)`}>
          <SafeSvgImage href={href} x={0} y={0} width={width} height={height} preserveAspectRatio="xMidYMid slice" />
        </g>
        <g className="master-terrain-art-clip" clipPath={`url(#${id}-art)`}>
          <g className={`master-terrain-motion terrain-motion-${profile.kind}`} style={{
            animationDuration: timing.duration,
            animationDelay: timing.delay,
            transformOrigin: `${width / 2}px ${art.y + art.height}px`,
          }}>
            <SafeSvgImage href={href} x={0} y={0} width={width} height={height} preserveAspectRatio="xMidYMid slice" />
          </g>
        </g>
      </svg>
    </g>
  )
}
