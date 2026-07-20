import type { BuiltBoard, MasterHex } from '../types/variant'
import { TERRAIN_COLORS } from '../variant/buildBoard'
import { markerImageUrl, markerPlainColor, terrainImageUrl } from '../variant/assets'
import type { GameState, Legion } from '../engine/types'
import { SafeSvgImage } from './SafeSvgImage'

const SQRT3 = Math.sqrt(3)

function hexVertices(cx: number, cy: number, scale: number, inverted: boolean): [number, number][] {
  return inverted
    ? [
        [cx - scale, cy],
        [cx + 3 * scale, cy],
        [cx + 4 * scale, cy + SQRT3 * scale],
        [cx + 2 * scale, cy + 3 * SQRT3 * scale],
        [cx, cy + 3 * SQRT3 * scale],
        [cx - 2 * scale, cy + SQRT3 * scale],
      ]
    : [
        [cx, cy],
        [cx + 2 * scale, cy],
        [cx + 4 * scale, cy + 2 * SQRT3 * scale],
        [cx + 3 * scale, cy + 3 * SQRT3 * scale],
        [cx - scale, cy + 3 * SQRT3 * scale],
        [cx - 2 * scale, cy + 2 * SQRT3 * scale],
      ]
}

function hexPoints(cx: number, cy: number, scale: number, inverted: boolean): string {
  return hexVertices(cx, cy, scale, inverted)
    .map(([x, y]) => `${x},${y}`)
    .join(' ')
}

function hexBounds(cx: number, cy: number, scale: number, inverted: boolean) {
  const pts = hexVertices(cx, cy, scale, inverted)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function hexPixel(board: BuiltBoard, hex: MasterHex, scale: number): { cx: number; cy: number } {
  const cx = 3 * scale + 4 * hex.x * scale
  const cy =
    (3 * hex.y +
      ((hex.x + board.boardParity) & 1) * (1 + 2 * Math.floor(hex.y / 2)) +
      ((hex.x + 1 + board.boardParity) & 1) * 2 * Math.floor((hex.y + 1) / 2)) *
    SQRT3 *
    scale
  return { cx, cy }
}

interface Props {
  state: GameState
  onHexClick: (label: string) => void
  onLegionClick: (legionId: string) => void
}

export function MasterBoardView({ state, onHexClick, onLegionClick }: Props) {
  const board = state.variant.board
  const scale = 14
  const markerSize = 28
  const legal = new Set(state.legalHexes)
  const selected = state.selectedLegionId
    ? state.legions.find((l) => l.id === state.selectedLegionId)
    : null

  let maxX = 0
  let maxY = 0
  const hexes = Object.values(board.hexByLabel)
  for (const hex of hexes) {
    const { cx, cy } = hexPixel(board, hex, scale)
    maxX = Math.max(maxX, cx + 5 * scale)
    maxY = Math.max(maxY, cy + 4 * SQRT3 * scale)
  }

  const legionsByHex = new Map<string, Legion[]>()
  for (const leg of state.legions) {
    const list = legionsByHex.get(leg.hexLabel) ?? []
    list.push(leg)
    legionsByHex.set(leg.hexLabel, list)
  }

  return (
    <svg
      className="master-board"
      viewBox={`0 0 ${maxX + 20} ${maxY + 20}`}
      role="img"
      aria-label="Master board"
    >
      <defs>
        {hexes.map((hex) => {
          const { cx, cy } = hexPixel(board, hex, scale)
          return (
            <clipPath key={`clip-${hex.label}`} id={`hex-clip-${hex.label}`}>
              <polygon points={hexPoints(cx, cy, scale, hex.inverted)} />
            </clipPath>
          )
        })}
      </defs>
      {hexes.map((hex) => {
        const { cx, cy } = hexPixel(board, hex, scale)
        const fill = TERRAIN_COLORS[hex.terrain] ?? '#ccc'
        const isLegal = legal.has(hex.label)
        const isSelectedHere = selected?.hexLabel === hex.label
        const bounds = hexBounds(cx, cy, scale, hex.inverted)
        const terrainSrc = terrainImageUrl(hex.terrain, hex.inverted)
        return (
          <g key={hex.label} onClick={() => onHexClick(hex.label)} style={{ cursor: 'pointer' }}>
            <polygon
              points={hexPoints(cx, cy, scale, hex.inverted)}
              fill={fill}
              stroke="#2a241c"
              strokeWidth={1}
            />
            <SafeSvgImage
              href={terrainSrc}
              x={bounds.x}
              y={bounds.y}
              width={bounds.width}
              height={bounds.height}
              clipPath={`url(#hex-clip-${hex.label})`}
              opacity={0.85}
              preserveAspectRatio="xMidYMid slice"
            />
            <polygon
              points={hexPoints(cx, cy, scale, hex.inverted)}
              fill="none"
              stroke={isLegal ? '#ffeb3b' : isSelectedHere ? '#fff' : '#1a1510'}
              strokeWidth={isLegal ? 3 : 1.2}
            />
            <text
              x={cx + scale}
              y={cy + 1.15 * SQRT3 * scale}
              textAnchor="middle"
              fontSize={8}
              fill="#111"
              stroke="#f5ecd8"
              strokeWidth={2}
              paintOrder="stroke"
              fontFamily="Georgia, serif"
              fontWeight={700}
            >
              {hex.label}
            </text>
          </g>
        )
      })}
      {[...legionsByHex.entries()].map(([hexLabel, legs]) => {
        const hex = board.hexByLabel[hexLabel]
        if (!hex) return null
        const { cx, cy } = hexPixel(board, hex, scale)
        return legs.map((leg, i) => {
          const ox = (i - (legs.length - 1) / 2) * (markerSize + 2)
          const selectedLeg = leg.id === state.selectedLegionId
          const x = cx + scale + ox - markerSize / 2
          const y = cy + 1.85 * SQRT3 * scale - markerSize / 2
          return (
            <g
              key={leg.id}
              onClick={(e) => {
                e.stopPropagation()
                onLegionClick(leg.id)
              }}
              style={{ cursor: 'pointer' }}
            >
              {selectedLeg && (
                <rect
                  x={x - 2}
                  y={y - 2}
                  width={markerSize + 4}
                  height={markerSize + 4}
                  fill="none"
                  stroke="#ffeb3b"
                  strokeWidth={3}
                  rx={3}
                />
              )}
              {/* Colossus Plain-{Color} under transparent marker symbol */}
              <rect
                x={x}
                y={y}
                width={markerSize}
                height={markerSize}
                fill={markerPlainColor(leg.markerId)}
                stroke={leg.markerId.startsWith('Bk') ? '#ffffff' : '#000000'}
                strokeWidth={1}
              />
              <SafeSvgImage
                href={markerImageUrl(leg.markerId)}
                x={x}
                y={y}
                width={markerSize}
                height={markerSize}
                preserveAspectRatio="xMidYMid meet"
              />
              <text
                x={x + markerSize * 0.78}
                y={y + markerSize * 0.78}
                textAnchor="middle"
                fontSize={Math.max(9, markerSize * 0.42)}
                fontWeight={700}
                fontFamily="sans-serif"
                fill="#000"
                stroke="#fff"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {leg.creatures.length}
              </text>
            </g>
          )
        })
      })}
    </svg>
  )
}
