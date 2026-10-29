import { useContext, useRef, useState } from 'react'
import { CreatureAssetErrorContext } from '../ui/creaturePresentation'
import { MODERN_TERRAINS, modernTerrainUrl } from '../ui/modernBoard'
import { terrainMotionKind, terrainMotionTiming } from '../ui/terrainMotion'

/** Board-shared native material definitions: twelve faces, one rim and one quiet pattern. */
export function ModernBoardDefs({ prefix }: { prefix: string }) {
  return <>
    {Object.entries(MODERN_TERRAINS).map(([name, palette]) => <linearGradient key={name} id={`${prefix}-face-${name}`} x1="0" y1="0" x2=".2" y2="1">
      <stop offset="0" stopColor={palette.top} /><stop offset="1" stopColor={palette.bottom} />
    </linearGradient>)}
    <linearGradient id={`${prefix}-metal`} x1="0" y1="0" x2=".3" y2="1">
      <stop offset="0" stopColor="#fff0cf" /><stop offset=".35" stopColor="#c5b58e" /><stop offset=".62" stopColor="#8b846e" /><stop offset="1" stopColor="#d9c8a5" />
    </linearGradient>
    <pattern id={`${prefix}-table`} width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M0 28 L28 0 M0 0 L28 28" stroke="#8ba4b4" strokeWidth=".45" opacity=".045" />
      <circle cx="14" cy="14" r=".65" fill="#bda77d" opacity=".1" />
    </pattern>
  </>
}

/** Label-free color vignette. Only the art group moves; native labels are siblings. */
export function ModernTerrainArt({ terrain, hexLabel, cx, cy, scale, clipPath, reducedMotion }: {
  terrain: string; hexLabel: string; cx: number; cy: number; scale: number; clipPath: string; reducedMotion: boolean
}) {
  const notify = useContext(CreatureAssetErrorContext)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const reported = useRef(new Set<string>())
  const url = modernTerrainUrl(terrain)
  const kind = terrainMotionKind(terrain)
  const timing = terrainMotionTiming(hexLabel, terrain)
  const artSize = scale * 48 / 7
  const message = `Cannot load modern board terrain artwork: board-art/terrain-v1/${terrain}.png`
  if (!notify) throw Error('Modern board artwork requires the App notice callback context.')
  return <g className="modern-terrain-art" data-terrain={terrain} clipPath={clipPath} pointerEvents="none">
    {failedUrl === url ? <g data-terrain-error={terrain}>
      <title>{message}</title><text x={cx + scale} y={cy + 39} textAnchor="middle" fontSize={6} fill="#fff1dd" stroke="#611e22" strokeWidth={2} paintOrder="stroke">Art unavailable</text>
    </g> : <svg x={cx + scale - artSize / 2} y={cy + 1.5 * Math.sqrt(3) * scale - artSize / 2}
      width={artSize} height={artSize} viewBox="0 0 96 96">
      <g className={kind && !reducedMotion ? `master-terrain-motion modern-terrain-motion terrain-motion-${kind}` : 'modern-terrain-still'}
        style={{ animationDuration: timing.duration, animationDelay: timing.delay, transformOrigin: '48px 87px' }}>
        <image href={url} width={96} height={96} preserveAspectRatio="xMidYMid meet" onError={() => {
          setFailedUrl(url)
          if (!reported.current.has(url)) { reported.current.add(url); notify(message) }
        }} />
      </g>
    </svg>}
  </g>
}

export function ModernHexLabels({ terrain, label, cx, cy, scale, clipPath, showTerrain = true, preview }: {
  terrain: string; label: string; cx: number; cy: number; scale: number; clipPath: string; showTerrain?: boolean; preview?: string
}) {
  const center = cx + scale
  return <g className="modern-hex-labels" pointerEvents="none" clipPath={clipPath}>
    {showTerrain && <>
      <rect x={center - Math.min(30, terrain.length * 4.4 + 8) / 2} y={cy + 13} width={Math.min(30, terrain.length * 4.4 + 8)} height={11} rx={3} fill="#111c25" fillOpacity={0.84} />
      <text className="modern-terrain-name" x={center} y={cy + 21.2} textAnchor="middle" fill="#f4ebdd" fontFamily="Sora, sans-serif" fontWeight={650} fontSize={7.2}
        textLength={terrain.length > 7 ? 28 : undefined} lengthAdjust={terrain.length > 7 ? 'spacingAndGlyphs' : undefined}>{terrain}</text>
    </>}
    {/* Above the shared-edge gate corridor, below the standing marker's printed ID. */}
    <rect className="modern-number-pill" x={center - (preview ? 18 : 11)} y={cy + 57} width={preview ? 36 : 22} height={10} rx={5} fill="#111e28" stroke="#cbb58c" strokeWidth={0.5} />
    <text className="modern-hex-number" x={center - (preview ? 7 : 0)} y={cy + 64.5} textAnchor="middle" fill="#f5ecdc" fontFamily="Sora, sans-serif" fontWeight={650} fontSize={7.3}>{label}</text>
    {preview && <text className="modern-preview-roll" x={center + 11} y={cy + 64.5} textAnchor="middle" fill="#7fd3db" fontFamily="Sora, sans-serif" fontWeight={700} fontSize={7}>{preview}</text>}
  </g>
}
