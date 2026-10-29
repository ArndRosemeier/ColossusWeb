import { markerCrest, markerInk } from '../ui/markerArtwork'
import { markerPlainColor } from '../variant/assets'

/** Pure vector artwork shared by HTML, standing board and moving-overlay markers.
 * No raster, unstable IDs, filters or private identity replacement. */
export function MarkerArtwork({ markerId, color, size = 36, height, title, className }: {
  markerId: string; color?: string; size?: number; height?: number; title?: string; className?: string
}) {
  const fill = color ?? markerPlainColor(markerId)
  const ink = markerInk(fill)
  const label = `${markerId}; owner color ${fill}${height != null && height > 0 ? `; ${height} creatures` : ''}`
  return (
    <svg className={`modern-legion-marker${className ? ` ${className}` : ''}`} width={size} height={size}
      viewBox="0 0 100 100" role="img" aria-label={label} data-marker-id={markerId} data-owner-color={fill}
      data-height={height} style={{ width: size, height: size, verticalAlign: 'middle' }}>
      <title>{title ? `${title} — ${label}` : label}</title>
      <path d="M11 2 H89 L98 11 V89 L89 98 H11 L2 89 V11 Z" fill="#0a121b" stroke="#c6c4ac" strokeWidth={2} />
      <path className="marker-owner-face" d="M14 8 H86 L92 14 V86 L86 92 H14 L8 86 V14 Z" fill={fill} />
      <path d="M10 85 V14 L15 9 H85" fill="none" stroke="#fff8e8" strokeOpacity={0.55} strokeWidth={2} />
      <path d="M15 91 H86 L92 85 V15" fill="none" stroke="#030810" strokeOpacity={0.65} strokeWidth={3} />
      <path className="marker-crest" d={markerCrest(markerId)} fill={ink} fillOpacity={0.9} stroke={ink}
        strokeWidth={2} strokeLinejoin="round" />
      <path d="M17 66 H64" stroke={ink} strokeOpacity={0.35} strokeWidth={1.5} />
      <text className="marker-full-id" x={height ? 34 : 50} y={90} textAnchor="middle" fill={ink}
        fontFamily="Sora, sans-serif" fontSize={markerId.length > 4 ? 16 : 19} fontWeight={750}>{markerId}</text>
      {height != null && height > 0 && <g className="marker-count">
        <circle cx={80} cy={77} r={18} fill="#f3e4c7" stroke="#0a121b" strokeWidth={3} />
        <text x={80} y={89} textAnchor="middle" fill="#09131c" fontFamily="Sora, sans-serif" fontSize={33} fontWeight={800}>{height}</text>
      </g>}
    </svg>
  )
}
