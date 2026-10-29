import { useRef, useState } from 'react'
import type { BuiltBattleHex, HexsideHazard } from '../engine/battleland'
import { BATTLE_SURFACES, battleEdgeGeometry, battleHazardUrl, battleSurface, type BattleVertex } from '../ui/modernBattle'

export function ModernBattleDefs({ prefix }: { prefix: string }) {
  return <>
    {Object.keys(BATTLE_SURFACES).flatMap(terrain => [0, 1, 2, 3].map(elevation => {
      const palette = battleSurface(terrain, elevation)
      return <linearGradient key={`${terrain}-${elevation}`} id={`${prefix}-floor-${terrain}-${elevation}`} x1="0" y1="0" x2=".2" y2="1">
        <stop offset="0" stopColor={palette.top} /><stop offset="1" stopColor={palette.bottom} />
      </linearGradient>
    }))}
    <pattern id={`${prefix}-grain`} width="12" height="12" patternUnits="userSpaceOnUse">
      <path d="M1 3l3-1 M8 9l2 1 M2 10l1-2" stroke="#e3d8b4" strokeWidth=".5" opacity=".18" />
      <circle cx="9" cy="3" r=".6" fill="#172820" opacity=".13" />
    </pattern>
    <pattern id={`${prefix}-paving`} width="14" height="8" patternUnits="userSpaceOnUse">
      <path d="M0 0h14v8H0Z M7 0v4 M0 4h14 M3 4v4 M11 4v4" stroke="#d7e1dd" strokeWidth=".45" fill="none" opacity=".18" />
    </pattern>
  </>
}

/** Distinct native vectors: cliffs, walls, slopes, dunes and rivers are not interchangeable. */
export function ModernBattleHexside({ vertices, side, hazard }: { vertices: BattleVertex[]; side: number; hazard: HexsideHazard }) {
  if (hazard === 'nothing') return null
  const g = battleEdgeGeometry(vertices, side)
  const point = (t: number, inward: number) => [g.a[0] + g.dx * t + g.nx * inward, g.a[1] + g.dy * t + g.ny * inward] as const
  const coords = (p: readonly [number, number]) => `${p[0]},${p[1]}`
  const edge = (offset: number) => `M ${coords(point(.04, offset))} L ${coords(point(.96, offset))}`
  return <g className={`modern-battle-hexside modern-battle-${hazard}`} data-hazard={hazard} data-side={side} pointerEvents="none" aria-hidden="true">
    {hazard === 'river' ? <>
      {/* Offset into its OWN hex; Abyss puts a wall on the opposite side of this edge. */}
      <path d={edge(2.4)} stroke="#152d3e" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path className="modern-battle-river-water" d={edge(2.4)} stroke="#71c8de" strokeWidth="2.3" fill="none" strokeLinecap="round" />
      <path d={edge(2.4)} stroke="#d2f1e9" strokeWidth=".5" strokeDasharray="3 4" fill="none" />
    </> : <>
      <path d={edge(.35)} stroke={hazard === 'dune' ? '#75573c' : '#26373e'} strokeWidth="1.4" fill="none" />
      {[.22, .5, .78].map((t, index) => {
        const a = point(t, .6), inward = hazard === 'cliff' ? 4.3 : 3.5
        const half = g.length * .085
        const left = [a[0] - g.ux * half, a[1] - g.uy * half] as const
        const right = [a[0] + g.ux * half, a[1] + g.uy * half] as const
        const tip = [a[0] + g.nx * inward, a[1] + g.ny * inward] as const
        if (hazard === 'cliff') return <polygon key={index} points={[left, right, tip].map(coords).join(' ')} fill="#e3ded0" stroke="#293841" strokeWidth=".6" />
        if (hazard === 'tower') {
          const innerLeft = [left[0] + g.nx * inward, left[1] + g.ny * inward] as const
          const innerRight = [right[0] + g.nx * inward, right[1] + g.ny * inward] as const
          return <g key={index}>
            <polygon points={[left, right, innerRight, innerLeft].map(coords).join(' ')} fill="#c5c9c1" stroke="#26353e" strokeWidth=".65" />
            <path d={`M ${coords(innerLeft)} L ${coords(innerRight)}`} stroke="#f4eee0" strokeWidth=".7" />
          </g>
        }
        if (hazard === 'dune') return <path key={index} d={`M ${coords(left)} Q ${coords(tip)} ${coords(right)}`} stroke="#f0d49b" strokeWidth="1.7" fill="none" strokeLinecap="round" />
        return <path key={index} d={`M ${coords(left)} L ${coords(tip)} M ${coords(right)} L ${coords(tip)}`} stroke="#e0d6b8" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      })}
    </>}
  </g>
}

function BattleHazardArt({ terrain, x, y, width, height, onAssetError }: {
  terrain: string; x: number; y: number; width: number; height: number; onAssetError: (message: string) => void
}) {
  const url = battleHazardUrl(terrain)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const reported = useRef(new Set<string>())
  if (!url) return null
  const message = `Cannot load modern battle terrain artwork: board-art/hazards-v1/${terrain}.png`
  return <g className="modern-battle-hazard-art" data-hazard-terrain={terrain} pointerEvents="none">
    {failedUrl === url ? <g data-battle-art-error={terrain}>
      <title>{message}</title><text x={x + width / 2} y={y + height / 2} textAnchor="middle" fontSize="7" fill="#ffdbad" stroke="#5a2630" strokeWidth="2" paintOrder="stroke">!</text>
    </g> : <image href={url} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMid meet" onError={() => {
      setFailedUrl(url)
      if (!reported.current.has(url)) { reported.current.add(url); onAssetError(message) }
    }} />}
  </g>
}

/** One tactical surface seam, using the built cell's terrain/elevation without modifying it. */
export function ModernBattleHex({ hex, polygon, vertices, bounds, center, prefix, clipPath, lit, entry, onAssetError }: {
  hex: BuiltBattleHex; polygon: string; vertices: BattleVertex[]; bounds: { x: number; y: number; width: number; height: number }
  center: { x: number; y: number }; prefix: string; clipPath: string; lit: boolean; entry: boolean
  onAssetError: (message: string) => void
}) {
  const palette = battleSurface(hex.terrain, hex.elevation)
  const registered = Object.hasOwn(BATTLE_SURFACES, hex.terrain)
  const gradient = registered ? `url(#${prefix}-floor-${hex.terrain}-${Math.max(0, Math.min(3, hex.elevation))})` : palette.top
  return <g className="modern-battle-hex">
    <title>{`${hex.label} — ${hex.terrain} — elevation ${hex.elevation}`}</title>
    <polygon className={lit ? 'bhex lit modern-battle-floor' : 'bhex modern-battle-floor'} points={polygon} fill={gradient} stroke="#15242d" strokeWidth="1.4" />
    <g clipPath={clipPath} pointerEvents="none">
      <polygon points={polygon} fill={`url(#${prefix}-${hex.terrain === 'Tower' ? 'paving' : 'grain'})`} />
      <polygon className="modern-battle-bevel" points={polygon} transform={`translate(${center.x * .055} ${center.y * .055}) scale(.945)`} fill="none" stroke={palette.accent} strokeWidth=".7" strokeOpacity=".33" />
      <BattleHazardArt terrain={hex.terrain} x={center.x - bounds.width * .43} y={bounds.y + bounds.height * .12} width={bounds.width * .86} height={bounds.height * .76} onAssetError={onAssetError} />
    </g>
    {hex.hexsides.map((hazard, side) => <ModernBattleHexside key={side} vertices={vertices} hazard={hazard} side={side} />)}
    <g className="modern-battle-labels" clipPath={clipPath} pointerEvents="none">
      <rect x={center.x - 15} y={bounds.y + 4} width="19" height="8.5" rx="3" fill="#14232c" fillOpacity=".92" />
      <text className="modern-battle-coordinate" x={center.x - 5.5} y={bounds.y + 10.5} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="700" fontSize="6.4" fill="#f6edda">{hex.label}</text>
      <circle cx={center.x + 10} cy={bounds.y + 8.2} r="4.4" fill="#243641" stroke={palette.accent} strokeWidth=".55" />
      <text className="modern-battle-elevation" x={center.x + 10} y={bounds.y + 10.3} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="650" fontSize="5.8" fill="#f7ecda">{hex.elevation}</text>
      <rect x={center.x - 16} y={bounds.y + bounds.height - 9.2} width="32" height="7.4" rx="3" fill="#14232c" fillOpacity=".88" />
      <text className="modern-battle-terrain-name" x={center.x} y={bounds.y + bounds.height - 3.6} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="4.7" fill="#e9eddf">{hex.terrain}</text>
    </g>
    {/* Repaint destination/entry rims above artwork; decorative layers never steal a click. */}
    <polygon className="modern-battle-rim" points={polygon} fill="none" stroke={lit ? '#f5b16b' : entry ? '#88d8e9' : '#172731'} strokeWidth={lit ? 2.4 : entry ? 1.8 : .9} pointerEvents="none" />
    {lit && <polygon points={polygon} fill="#f2b873" fillOpacity=".08" pointerEvents="none" />}
  </g>
}
