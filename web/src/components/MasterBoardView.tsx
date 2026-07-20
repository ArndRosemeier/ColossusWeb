import { useLayoutEffect, useRef, useState } from 'react'
import type { BuiltBoard, MasterHex } from '../types/variant'
import { TERRAIN_COLORS } from '../variant/buildBoard'
import {
  creatureImageUrl,
  markerImageUrl,
  markerPlainColor,
  terrainImageUrl,
} from '../variant/assets'
import { activePlayer, canUndoRecruit, getLegalRecruits, getMovesForSelected } from '../engine/GameEngine'
import { bestRecruit, bestRecruitAt } from '../engine/recruit'
import type { GameCommand, GameState, Legion } from '../engine/types'
import type { MasterMoveAnim } from '../ui/moveAnimation'
import { pointsToSvg, usePathTween } from '../ui/usePathTween'
import { MusterForm, SplitForm } from './LegionActions'
import { SafeSvgImage } from './SafeSvgImage'

const WALK_STROKE = '#e08a45'
const TELEPORT_STROKE = '#a78bfa'
const RECRUIT_CHIT = 22

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
  moveAnim?: MasterMoveAnim | null
  onMoveAnimDone?: () => void
  /** When set, split/muster UI appears next to the selected own legion. */
  dispatch?: (cmd: GameCommand) => void
  interactive?: boolean
}

function markerCenter(
  board: BuiltBoard,
  hex: MasterHex,
  scale: number,
  stackIndex: number,
  stackCount: number,
  markerSize: number,
): { x: number; y: number } {
  const { cx, cy } = hexPixel(board, hex, scale)
  const ox = (stackIndex - (stackCount - 1) / 2) * (markerSize + 2)
  return {
    x: cx + scale + ox,
    y: cy + 1.85 * SQRT3 * scale,
  }
}

function MasterAnimOverlay({
  board,
  scale,
  markerSize,
  anim,
  onDone,
}: {
  board: BuiltBoard
  scale: number
  markerSize: number
  anim: MasterMoveAnim
  onDone: () => void
}) {
  const points = anim.pathLabels.map((label) => {
    const hex = board.hexByLabel[label]
    if (!hex) return { x: 0, y: 0 }
    return markerCenter(board, hex, scale, 0, 1, markerSize)
  })
  const { pos, trail, opacity } = usePathTween(points, anim.durationMs, anim.teleport, onDone)
  const ghostOp = anim.teleport
    ? opacity.ghost > 0.02
      ? opacity.ghost
      : opacity.origin
    : 1
  const trailD = trail.length >= 2 ? pointsToSvg(trail) : ''

  return (
    <g className="move-anim" pointerEvents="none">
      {trailD && (
        <polyline
          points={trailD}
          fill="none"
          stroke={anim.teleport ? TELEPORT_STROKE : WALK_STROKE}
          strokeWidth={2.2}
          strokeOpacity={0.55}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="5 4"
        />
      )}
      {ghostOp > 0.02 && (
        <g opacity={ghostOp} transform={`translate(${pos.x - markerSize / 2}, ${pos.y - markerSize / 2})`}>
          <rect
            width={markerSize}
            height={markerSize}
            fill={markerPlainColor(anim.markerId)}
            stroke={anim.markerId.startsWith('Bk') ? '#ffffff' : '#000000'}
            strokeWidth={1}
          />
          <SafeSvgImage
            href={markerImageUrl(anim.markerId)}
            x={0}
            y={0}
            width={markerSize}
            height={markerSize}
            preserveAspectRatio="xMidYMid meet"
          />
          <text
            x={markerSize * 0.78}
            y={markerSize * 0.78}
            textAnchor="middle"
            fontSize={Math.max(9, markerSize * 0.42)}
            fontWeight={700}
            fontFamily="sans-serif"
            fill="#000"
            stroke="#fff"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {anim.count}
          </text>
        </g>
      )}
    </g>
  )
}

export function MasterBoardView({
  state,
  onHexClick,
  onLegionClick,
  moveAnim = null,
  onMoveAnimDone,
  dispatch,
  interactive = false,
}: Props) {
  const board = state.variant.board
  const scale = 14
  const markerSize = 28
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [overlayPos, setOverlayPos] = useState<{ left: number; top: number; flip: boolean } | null>(
    null,
  )
  const selected = state.selectedLegionId
    ? state.legions.find((l) => l.id === state.selectedLegionId)
    : null
  const player = activePlayer(state)
  const moveInfo =
    state.phase === 'Move' && selected ? getMovesForSelected(state) : new Map()
  const legalLabels = [...moveInfo.keys()]

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

  const showSplit =
    Boolean(interactive && dispatch) &&
    state.phase === 'Split' &&
    selected != null &&
    selected.playerId === player.id &&
    selected.creatures.length >= 4 &&
    player.markersAvailable.length > 0

  const recruits =
    selected && state.phase === 'Muster' && selected.playerId === player.id
      ? getLegalRecruits(state, selected.id)
      : []
  const canUndoMuster =
    selected != null &&
    selected.playerId === player.id &&
    canUndoRecruit(state, selected.id)
  const showMuster =
    Boolean(interactive && dispatch) &&
    state.phase === 'Muster' &&
    (recruits.length > 0 || canUndoMuster)

  useLayoutEffect(() => {
    if (!showSplit && !showMuster) {
      setOverlayPos(null)
      return
    }
    if (!selected) {
      setOverlayPos(null)
      return
    }
    const svg = svgRef.current
    const wrap = wrapRef.current
    if (!svg || !wrap) return

    const hex = board.hexByLabel[selected.hexLabel]
    if (!hex) return
    const stack = legionsByHex.get(selected.hexLabel) ?? [selected]
    const stackIndex = Math.max(
      0,
      stack.findIndex((l) => l.id === selected.id),
    )
    const center = markerCenter(board, hex, scale, stackIndex, stack.length, markerSize)
    const anchorX = center.x + markerSize / 2 + 6
    const anchorY = center.y - markerSize / 2

    const update = () => {
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const pt = svg.createSVGPoint()
      pt.x = anchorX
      pt.y = anchorY
      const screen = pt.matrixTransform(ctm)
      const wrapBox = wrap.getBoundingClientRect()
      const left = screen.x - wrapBox.left
      const top = screen.y - wrapBox.top
      const flip = left > wrapBox.width * 0.55
      setOverlayPos({ left, top, flip })
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(wrap)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [
    showSplit,
    showMuster,
    selected?.id,
    selected?.hexLabel,
    selected?.creatures.length,
    state.phase,
    board,
    scale,
    markerSize,
    // re-run when stack composition on hex changes
    state.legions.map((l) => `${l.id}@${l.hexLabel}`).join('|'),
  ])

  const recruitPreviews: { label: string; creature: string; index: number }[] = []
  if (selected && legalLabels.length > 0) {
    let i = 0
    for (const label of legalLabels) {
      const creature = bestRecruitAt(state, selected, label)
      if (creature) recruitPreviews.push({ label, creature, index: i++ })
    }
  }

  return (
    <div className="master-board-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
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
          const move = moveInfo.get(hex.label)
          const isLegal = move != null
          const isTeleport = move?.teleport === true
          const isSelectedHere = selected?.hexLabel === hex.label
          const bounds = hexBounds(cx, cy, scale, hex.inverted)
          const terrainSrc = terrainImageUrl(hex.terrain, hex.inverted)
          const accent = isTeleport ? TELEPORT_STROKE : WALK_STROKE
          return (
            <g key={hex.label} onClick={() => onHexClick(hex.label)} style={{ cursor: 'pointer' }}>
              <polygon
                points={hexPoints(cx, cy, scale, hex.inverted)}
                fill={fill}
                stroke="#0a1014"
                strokeWidth={1}
              />
              <SafeSvgImage
                href={terrainSrc}
                x={bounds.x}
                y={bounds.y}
                width={bounds.width}
                height={bounds.height}
                clipPath={`url(#hex-clip-${hex.label})`}
                opacity={0.9}
                preserveAspectRatio="xMidYMid slice"
              />
              {isLegal && (
                <polygon
                  className="legal-hex-ring"
                  points={hexPoints(cx, cy, scale, hex.inverted)}
                  fill={accent}
                  stroke="none"
                />
              )}
              <polygon
                className={isLegal ? 'legal-hex-stroke' : undefined}
                points={hexPoints(cx, cy, scale, hex.inverted)}
                fill="none"
                stroke={isLegal ? accent : isSelectedHere ? '#e8edf2' : '#0c1218'}
                strokeWidth={isLegal ? 3.5 : 1.2}
              />
              <text
                x={cx + scale}
                y={cy + 1.15 * SQRT3 * scale}
                textAnchor="middle"
                fontSize={8}
                fill="#f0f4f8"
                stroke="#0a1014"
                strokeWidth={2.5}
                paintOrder="stroke"
                fontFamily="Cinzel, Georgia, serif"
                fontWeight={700}
              >
                {hex.label}
              </text>
            </g>
          )
        })}
        {recruitPreviews.map(({ label, creature, index }) => {
          const hex = board.hexByLabel[label]
          if (!hex) return null
          const { cx, cy } = hexPixel(board, hex, scale)
          const x = cx + scale - RECRUIT_CHIT / 2
          const y = cy + 0.35 * SQRT3 * scale
          return (
            <g
              key={`recruit-${label}`}
              className="recruit-preview"
              style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
              pointerEvents="none"
            >
              <rect
                x={x - 1}
                y={y - 1}
                width={RECRUIT_CHIT + 2}
                height={RECRUIT_CHIT + 2}
                rx={2}
                fill="rgba(10, 16, 20, 0.72)"
                stroke={WALK_STROKE}
                strokeWidth={1.5}
              />
              <SafeSvgImage
                href={creatureImageUrl(creature)}
                x={x}
                y={y}
                width={RECRUIT_CHIT}
                height={RECRUIT_CHIT}
                preserveAspectRatio="xMidYMid meet"
              />
              <title>{`Best muster: ${creature}`}</title>
            </g>
          )
        })}
        {[...legionsByHex.entries()].map(([hexLabel, legs]) => {
          const hex = board.hexByLabel[hexLabel]
          if (!hex) return null
          const { cx, cy } = hexPixel(board, hex, scale)
          const visible = legs.filter((leg) => leg.id !== moveAnim?.pieceId)
          return (
            <g key={`stack-${hexLabel}`}>
              {visible.map((leg, i) => {
            const ox = (i - (visible.length - 1) / 2) * (markerSize + 2)
            const selectedLeg = leg.id === state.selectedLegionId
            const x = cx + scale + ox - markerSize / 2
            const y = cy + 1.85 * SQRT3 * scale - markerSize / 2
            const musterChit = markerSize * 0.78
            const pendingMusterChit = markerSize * 0.5
            const pendingCreature =
              state.phase === 'Muster' && leg.playerId === player.id && !leg.recruited
                ? bestRecruit(state, leg)
                : null
            const showDoneMuster =
              state.phase === 'Muster' &&
              leg.playerId === player.id &&
              Boolean(leg.musteredThisTurn)
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
                    stroke="#e08a45"
                    strokeWidth={3}
                    rx={2}
                  />
                )}
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
                {pendingCreature && (
                  <g className="muster-pending" pointerEvents="none">
                    <SafeSvgImage
                      href={creatureImageUrl(pendingCreature)}
                      x={x + (markerSize - pendingMusterChit) / 2}
                      y={y + (markerSize - pendingMusterChit) / 2}
                      width={pendingMusterChit}
                      height={pendingMusterChit}
                      preserveAspectRatio="xMidYMid meet"
                    />
                    <title>{`Best muster: ${pendingCreature}`}</title>
                  </g>
                )}
                {showDoneMuster && leg.musteredThisTurn && (
                  <g
                    className="muster-done"
                    pointerEvents="none"
                    transform={`rotate(-18 ${x + markerSize / 2} ${y + markerSize / 2})`}
                  >
                    <SafeSvgImage
                      href={creatureImageUrl(leg.musteredThisTurn)}
                      x={x + markerSize * 0.22}
                      y={y - musterChit * 0.35}
                      width={musterChit}
                      height={musterChit}
                      preserveAspectRatio="xMidYMid meet"
                    />
                    <title>{`Mustered: ${leg.musteredThisTurn}`}</title>
                  </g>
                )}
              </g>
            )
          })}
            </g>
          )
        })}
        {moveAnim && onMoveAnimDone && (
          <MasterAnimOverlay
            board={board}
            scale={scale}
            markerSize={markerSize}
            anim={moveAnim}
            onDone={onMoveAnimDone}
          />
        )}
      </svg>

      {(showSplit || showMuster) && dispatch && (
        <div
          className="legion-action-backdrop"
          onClick={() => dispatch({ type: 'deselectLegion' })}
          aria-hidden
        />
      )}

      {overlayPos && selected && dispatch && (showSplit || showMuster) && (
        <div
          className={`legion-action-overlay${overlayPos.flip ? ' flip' : ''}`}
          style={{
            left: overlayPos.left,
            top: overlayPos.top,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {showSplit && (
            <>
              <div className="legion-action-title">Split {selected.markerId}</div>
              <SplitForm
                key={`split-${selected.id}-${selected.creatures.map((c) => c.type).join(',')}`}
                state={state}
                creatures={selected.creatures.map((c) => c.type)}
                turn1={state.turnNumber === 1}
                compact
                onSplit={(child) =>
                  dispatch({ type: 'split', parentId: selected.id, childCreatures: child })
                }
              />
            </>
          )}
          {showMuster && (
            <>
              <div className="legion-action-title">Muster {selected.markerId}</div>
              {recruits.length > 0 ? (
                <MusterForm
                  state={state}
                  recruits={recruits}
                  onRecruit={(creatureType) =>
                    dispatch({ type: 'recruit', legionId: selected.id, creatureType })
                  }
                />
              ) : (
                <button
                  type="button"
                  className="primary"
                  onClick={() => dispatch({ type: 'undoRecruit', legionId: selected.id })}
                >
                  Undo recruit of {selected.musteredThisTurn}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

