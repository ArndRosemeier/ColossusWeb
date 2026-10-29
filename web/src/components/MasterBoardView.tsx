import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { BuiltBoard, MasterHex } from '../types/variant'
import { TERRAIN_COLORS } from '../variant/buildBoard'
import {
  isDarkMarkerFill,
  markerImageUrl,
  terrainImageUrl,
} from '../variant/assets'
import {
  activePlayer,
  canUndoRecruit,
  canUndoSplit,
  getLegalRecruits,
  playerLegions,
  unseparatedSplitStacks,
} from '../engine/GameEngine'
import { bestRecruit, bestRecruitAt } from '../engine/recruit'
import type { GameCommand, GameState, Legion } from '../engine/types'
import { boardInteraction } from '../ui/boardInteraction'
import type { MasterMoveAnim } from '../ui/moveAnimation'
import { pointsToSvg, usePathTween } from '../ui/usePathTween'
import { usePresentationMode, type PresentationMode } from '../ui/presentationMode'
import { hasModernTerrain } from '../ui/modernBoard'
import { useReducedMotion } from '../ui/battlePresentation'
import { MusterForm, SplitForm } from './LegionActions'
import { MasterHexGates } from './MasterHexGates'
import { MasterTerrainArt } from './MasterTerrainArt'
import { SafeSvgImage } from './SafeSvgImage'
import { BoardCreatureIcon } from './BoardCreatureIcon'
import { MarkerArtwork } from './MarkerArtwork'
import { ModernBoardDefs, ModernHexLabels, ModernTerrainArt } from './ModernBoardArt'
import './modernBoard.css'

const PREVIEW_STROKE = '#5ec8d4'
const SPLIT_STROKE = '#ff6b35'

const WALK_STROKE = '#e08a45'
const TELEPORT_STROKE = '#a78bfa'
const RECRUIT_CHIT = 22
const MARKER_SIZE = 28

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
    // Grow upward so the original bottom edge still clears the hex number.
    y: cy + 1.85 * SQRT3 * scale - (markerSize - MARKER_SIZE) / 2,
  }
}

function MasterAnimOverlay({
  board,
  scale,
  markerSize,
  anim,
  onDone,
  mode,
}: {
  board: BuiltBoard
  scale: number
  markerSize: number
  anim: MasterMoveAnim
  onDone: () => void
  mode: PresentationMode
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
          {mode === 'animated' ? <MarkerArtwork markerId={anim.markerId} color={anim.ownerColor} size={markerSize} height={anim.count} /> : <>
          <rect
            width={markerSize}
            height={markerSize}
            fill={anim.ownerColor}
            stroke={isDarkMarkerFill(anim.ownerColor) ? '#ffffff' : '#000000'}
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
          </>}
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
  const mode = usePresentationMode()
  const modern = mode === 'animated'
  const boardScope = `modern-board-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const clipId = (label: string) => modern ? `${boardScope}-hex-${label}` : `hex-clip-${label}`
  const reducedMotion = useReducedMotion()
  const board = state.variant.board
  const scale = 14
  const tokenScale = modern ? 1.2 : 1
  const markerSize = MARKER_SIZE * tokenScale
  const recruitChit = RECRUIT_CHIT * tokenScale
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const overlayElRef = useRef<HTMLDivElement>(null)
  const [overlayPos, setOverlayPos] = useState<{
    left: number
    top: number
    flipX: boolean
    flipY: boolean
  } | null>(null)
  const selected = state.selectedLegionId
    ? state.legions.find((l) => l.id === state.selectedLegionId)
    : null
  const player = activePlayer(state)
  /**
   * The PAINTED fields come from the SAME seam a click is judged by
   * (`ui/boardInteraction.ts`), driven by the SAME `interactive` the click gate
   * uses. `interactive === false` (a spectator, the other seat's turn, an AI
   * playing) therefore paints NOTHING actionable: the board can never show a
   * field that a click refuses (ledger row 13).
   */
  const { legal: moveInfo, preview: enemyPreview } = boardInteraction(state, interactive)
  const legalLabels = [...moveInfo.keys()]
  const splitHexes = new Set(
    state.phase === 'Move' ? unseparatedSplitStacks(state).map((g) => g.hexLabel) : [],
  )
  const canUndoSelectedSplit =
    selected != null && selected.playerId === player.id && canUndoSplit(state, selected.id)
  const turn1SplitDone =
    state.turnNumber === 1 && playerLegions(state, player.id).length > 1
  const canSplitMore =
    selected != null &&
    selected.playerId === player.id &&
    selected.creatures.length >= 4 &&
    player.markersAvailable.length > 0 &&
    !turn1SplitDone

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
    (canSplitMore || canUndoSelectedSplit)

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
      const flipX = left > wrapBox.width * 0.55
      const spaceBelow = wrapBox.height - top
      const spaceAbove = top
      const flipY = spaceBelow < 240 && spaceAbove > spaceBelow
      setOverlayPos({ left, top, flipX, flipY })
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
    <div className={modern ? "master-board-wrap modern-board" : "master-board-wrap"} data-presentation={modern ? mode : undefined} ref={wrapRef}>
      <svg
        ref={svgRef}
        className={modern ? "master-board modern-master-board" : "master-board"}
        viewBox={`0 0 ${maxX + 20} ${maxY + 20}`}
        role="img"
        aria-label="Master board"
      >
        <defs>
          {modern && <ModernBoardDefs prefix={boardScope} />}
          {hexes.map((hex) => {
            const { cx, cy } = hexPixel(board, hex, scale)
            return (
              <clipPath key={`clip-${hex.label}`} id={clipId(hex.label)}>
                <polygon points={hexPoints(cx, cy, scale, hex.inverted)} />
              </clipPath>
            )
          })}
        </defs>
        {modern && <g className="modern-board-table" pointerEvents="none">
          <rect x={1} y={1} width={maxX + 18} height={maxY + 18} rx={10} fill="#101c24" stroke="#647178" strokeWidth={1} />
          <rect x={5} y={5} width={maxX + 10} height={maxY + 10} rx={7} fill={`url(#${boardScope}-table)`} stroke="#ae9775" strokeOpacity={0.25} strokeWidth={0.5} />
        </g>}
        {hexes.map((hex) => {
          const { cx, cy } = hexPixel(board, hex, scale)
          const fill = TERRAIN_COLORS[hex.terrain] ?? '#ccc'
          const move = moveInfo.get(hex.label)
          const preview = enemyPreview.get(hex.label)
          const isLegal = move != null
          const isPreview = !isLegal && preview != null
          const isTeleport = move?.teleport === true || (isPreview && preview?.teleport === true)
          const isSplitHere = splitHexes.has(hex.label)
          const isSelectedHere = selected?.hexLabel === hex.label
          const bounds = hexBounds(cx, cy, scale, hex.inverted)
          const terrainSrc = terrainImageUrl(hex.terrain, hex.inverted)
          const accent = isPreview
            ? PREVIEW_STROKE
            : isTeleport
              ? TELEPORT_STROKE
              : WALK_STROKE
          const verts = hexVertices(cx, cy, scale, hex.inverted)
          return (
            <g
              key={hex.label}
              data-hex={hex.label}
              onClick={() => onHexClick(hex.label)}
              style={{ cursor: 'pointer' }}
            >
              <polygon
                points={hexPoints(cx, cy, scale, hex.inverted)}
                className={modern ? 'modern-hex-surface' : undefined}
                fill={modern && hasModernTerrain(hex.terrain) ? `url(#${boardScope}-face-${hex.terrain})` : fill}
                stroke={modern ? '#101a22' : '#0a1014'}
                strokeWidth={modern ? 2.4 : 1}
              />
              {modern && <polygon className="modern-hex-bevel" points={hexPoints(cx, cy, scale, hex.inverted)}
                transform={`translate(${cx + scale} ${cy + 1.5 * SQRT3 * scale}) scale(.95) translate(${-cx - scale} ${-cy - 1.5 * SQRT3 * scale})`}
                fill="none" stroke="#f3dfb5" strokeOpacity={0.2} strokeWidth={0.6} pointerEvents="none" />}
              {modern && hasModernTerrain(hex.terrain) ? <ModernTerrainArt terrain={hex.terrain} hexLabel={hex.label}
                cx={cx} cy={cy} scale={scale} clipPath={`url(#${clipId(hex.label)})`} reducedMotion={reducedMotion} /> : terrainSrc ? (
                <MasterTerrainArt
                  href={terrainSrc}
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={bounds.height}
                  clipPath={`url(#${clipId(hex.label)})`}
                  hexLabel={hex.label}
                  animated={false}
                />
              ) : null}
              {modern && !hasModernTerrain(hex.terrain) && <title>{`${hex.terrain}: modern terrain artwork unavailable; classic terrain illustration.`}</title>}
              {isSplitHere && !isLegal && (
                <polygon
                  className="split-hex-ring"
                  points={hexPoints(cx, cy, scale, hex.inverted)}
                  fill={SPLIT_STROKE}
                  stroke="none"
                />
              )}
              {(isLegal || isPreview) && (
                <polygon
                  className={isPreview ? 'preview-hex-ring' : 'legal-hex-ring'}
                  points={hexPoints(cx, cy, scale, hex.inverted)}
                  fill={accent}
                  stroke="none"
                />
              )}
              <polygon
                className={
                  isLegal ? 'legal-hex-stroke' : isPreview ? 'preview-hex-stroke' : undefined
                }
                points={hexPoints(cx, cy, scale, hex.inverted)}
                fill="none"
                stroke={
                  isLegal || isPreview
                    ? accent
                    : isSplitHere
                      ? SPLIT_STROKE
                      : isSelectedHere
                        ? '#e8edf2'
                        : modern ? '#263b43' : '#0c1218'
                }
                strokeWidth={isLegal || isPreview || isSplitHere ? (modern ? 2.2 : 3.5) : (modern ? 0.8 : 1.2)}
              />
              {!modern && <MasterHexGates
                verts={verts}
                inverted={hex.inverted}
                exitType={hex.exitType}
                entranceType={hex.entranceType}
                scale={scale}
              />}
              {modern ? <ModernHexLabels terrain={hex.terrain} label={hex.label} cx={cx} cy={cy} scale={scale}
                clipPath={`url(#${clipId(hex.label)})`} showTerrain={hasModernTerrain(hex.terrain)} preview={isPreview && preview ? (preview.teleport ? 'T' : String(preview.minRoll)) : undefined} /> : <text
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
              </text>}
              {!modern && isPreview && preview && (
                <text
                  className="preview-roll"
                  x={cx + scale}
                  y={cy + 1.55 * SQRT3 * scale}
                  textAnchor="middle"
                  fontSize={7}
                  fontWeight={700}
                  fontFamily="Sora, sans-serif"
                  fill={PREVIEW_STROKE}
                  stroke="#0a1014"
                  strokeWidth={2}
                  paintOrder="stroke"
                >
                  {preview.teleport ? 'T' : preview.minRoll}
                </text>
              )}
            </g>
          )
        })}
        {modern && <g className="modern-gate-layer" pointerEvents="none">
          {hexes.map(hex => {
            const { cx, cy } = hexPixel(board, hex, scale)
            return <g key={hex.label} data-gate-hex={hex.label}>
              <MasterHexGates verts={hexVertices(cx, cy, scale, hex.inverted)} inverted={hex.inverted}
                exitType={hex.exitType} entranceType={hex.entranceType} scale={scale} mode={mode} metalId={`${boardScope}-metal`} />
            </g>
          })}
        </g>}
        {recruitPreviews.map(({ label, creature, index }) => {
          const hex = board.hexByLabel[label]
          if (!hex) return null
          const { cx, cy } = hexPixel(board, hex, scale)
          const x = cx + scale - recruitChit / 2
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
                width={recruitChit + 2}
                height={recruitChit + 2}
                rx={2}
                fill="rgba(10, 16, 20, 0.72)"
                stroke={WALK_STROKE}
                strokeWidth={1.5}
              />
              <BoardCreatureIcon
                creature={creature}
                x={x}
                y={y}
                width={recruitChit}
                height={recruitChit}
              />
              <title>{`Best muster: ${creature}`}</title>
            </g>
          )
        })}
        {[...legionsByHex.entries()].map(([hexLabel, legs]) => {
          const hex = board.hexByLabel[hexLabel]
          if (!hex) return null
          const visible = legs.filter((leg) => leg.id !== moveAnim?.pieceId)
          return (
            <g key={`stack-${hexLabel}`}>
              {visible.map((leg, i) => {
            const center = markerCenter(board, hex, scale, i, visible.length, markerSize)
            const selectedLeg = leg.id === state.selectedLegionId
            const x = center.x - markerSize / 2
            const y = center.y - markerSize / 2
            const musterChit = markerSize * 0.78
            const pendingMusterChit = markerSize * 0.5
            const owner = state.players.find((p) => p.id === leg.playerId)
            const fill = owner?.color.css ?? '#666666'
            const pendingCreature =
              state.phase === 'Muster' && leg.playerId === player.id && !leg.recruited
                ? bestRecruit(state, leg)
                : null
            const ownMustered =
              state.phase === 'Muster' &&
              leg.playerId === player.id &&
              Boolean(leg.musteredThisTurn)
            const showLastMuster = Boolean(leg.musteredThisTurn)
            return (
              <g
                key={leg.id}
                data-legion={leg.id}
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
                <g className={ownMustered ? 'legion-marker-dimmed' : undefined}>
                  {modern ? <svg x={x} y={y} width={markerSize} height={markerSize} viewBox={`0 0 ${markerSize} ${markerSize}`}>
                    <MarkerArtwork markerId={leg.markerId} color={fill} size={markerSize} height={leg.creatures.length} />
                  </svg> : <>
                  <rect
                    x={x}
                    y={y}
                    width={markerSize}
                    height={markerSize}
                    fill={fill}
                    stroke={isDarkMarkerFill(fill) ? '#ffffff' : '#000000'}
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
                  </>}
                </g>
                {pendingCreature && (
                  <g className="muster-pending" pointerEvents="none">
                    <BoardCreatureIcon
                      creature={pendingCreature}
                      x={x + (markerSize - pendingMusterChit) / 2}
                      y={y + (markerSize - pendingMusterChit) / 2}
                      width={pendingMusterChit}
                      height={pendingMusterChit}
                    />
                    <title>{`Best muster: ${pendingCreature}`}</title>
                  </g>
                )}
                {showLastMuster && leg.musteredThisTurn && (
                  <g
                    className={
                      leg.playerId === player.id ? 'muster-done' : 'muster-done enemy-muster'
                    }
                    pointerEvents="none"
                    transform={`rotate(-18 ${x + markerSize / 2} ${y + markerSize / 2})`}
                  >
                    <BoardCreatureIcon
                      creature={leg.musteredThisTurn}
                      x={x + markerSize * 0.22}
                      y={y - musterChit * 0.35}
                      width={musterChit}
                      height={musterChit}
                    />
                    <title>{`Mustered: ${leg.musteredThisTurn} @${leg.hexLabel}`}</title>
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
            mode={mode}
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
          ref={overlayElRef}
          className={[
            'legion-action-overlay',
            overlayPos.flipX ? 'flip-x' : '',
            overlayPos.flipY ? 'flip-y' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            left: overlayPos.left,
            top: overlayPos.top,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {showSplit && (
            <>
              <div className="legion-action-title">
                {canSplitMore ? `Split ${selected.markerId}` : selected.markerId}
              </div>
              {canSplitMore && (
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
              )}
              {canUndoSelectedSplit && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => dispatch({ type: 'undoSplit', childId: selected.id })}
                >
                  Undo split
                </button>
              )}
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

