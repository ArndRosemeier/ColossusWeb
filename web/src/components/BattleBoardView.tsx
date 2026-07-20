import { battleLand, getUnitPower, getUnitSkill, isUnitAlive } from '../engine/battle'
import type { BattleState, GameState } from '../engine/types'
import type { BattleMoveAnim } from '../ui/moveAnimation'
import { pointsToSvg, usePathTween } from '../ui/usePathTween'
import { hazardImageUrl } from '../variant/assets'
import { CreatureChit } from './CreatureChit'
import { SafeSvgImage } from './SafeSvgImage'

const SQRT3 = Math.sqrt(3)

/** Colossus-ish fills when no hazard overlay applies (Plains / elevation). */
const TERRAIN_FILL: Record<string, string> = {
  Plains: '#c5d48a',
  Brambles: '#3d6b2e',
  Bog: '#5a4a2e',
  Sand: '#d4b84a',
  Drift: '#a8c8d8',
  Volcano: '#8a2a1a',
  Lake: '#3a6a9a',
  Tree: '#2a5a28',
  Stone: '#6a6a6a',
  Tower: '#5a6570',
}

function terrainFill(terrain: string, elevation: number): string {
  const base = TERRAIN_FILL[terrain] ?? '#6a7a5a'
  if (elevation <= 0) return base
  // Lighten elevated hexes slightly
  return elevation >= 2 ? '#e0d878' : '#d4c86a'
}

function usesHazardArt(terrain: string): boolean {
  return terrain !== 'Plains' && terrain !== 'Tower'
}

/**
 * Colossus HexMap / GUIBattleHex geometry (flat-top).
 * `scale` is Colossus's scale; hex width = 4*scale, center-to-vertex = 2*scale.
 * (cx, cy) is the upper-left vertex of the flat top — not the center.
 */
function hexOrigin(col: number, row: number, scale: number): { cx: number; cy: number } {
  return {
    cx: 3 * col * scale,
    cy: (2 * row + (col & 1)) * SQRT3 * scale,
  }
}

function hexCenter(col: number, row: number, scale: number): { x: number; y: number } {
  const { cx, cy } = hexOrigin(col, row, scale)
  return { x: cx + scale, y: cy + SQRT3 * scale }
}

/** Flat-top vertices matching GUIBattleHex.makeHexagon(). */
function hexVertices(cx: number, cy: number, scale: number): [number, number][] {
  return [
    [cx, cy],
    [cx + 2 * scale, cy],
    [cx + 3 * scale, cy + SQRT3 * scale],
    [cx + 2 * scale, cy + 2 * SQRT3 * scale],
    [cx, cy + 2 * SQRT3 * scale],
    [cx - scale, cy + SQRT3 * scale],
  ]
}

function hexPath(cx: number, cy: number, scale: number): string {
  return hexVertices(cx, cy, scale)
    .map(([px, py]) => `${px},${py}`)
    .join(' ')
}

function hexBounds(cx: number, cy: number, scale: number) {
  const pts = hexVertices(cx, cy, scale)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}

interface Props {
  state: GameState
  battle: BattleState
  onHexClick: (hex: string) => void
  onUnitClick: (unitId: string) => void
  moveAnim?: BattleMoveAnim | null
  onMoveAnimDone?: () => void
}

function BattleAnimOverlay({
  land,
  scale,
  chit,
  anim,
  mapCenter,
  onDone,
}: {
  land: ReturnType<typeof battleLand>
  scale: number
  chit: number
  anim: BattleMoveAnim
  mapCenter: { x: number; y: number }
  onDone: () => void
}) {
  const centers = anim.pathLabels.map((label) => {
    const hex = land.hexByLabel[label]
    if (!hex) return { x: 0, y: 0 }
    return hexCenter(hex.x, hex.y, scale)
  })
  let points = centers
  if (anim.fromOffBoard && centers.length > 0) {
    const first = centers[0]
    const dx = first.x - mapCenter.x
    const dy = first.y - mapCenter.y
    const len = Math.hypot(dx, dy) || 1
    const rim = 48
    points = [
      { x: first.x + (dx / len) * rim, y: first.y + (dy / len) * rim },
      ...centers,
    ]
  }
  const { pos, trail } = usePathTween(points, anim.durationMs, false, onDone)
  const trailD = trail.length >= 2 ? pointsToSvg(trail) : ''

  return (
    <g className="move-anim" pointerEvents="none">
      {trailD && (
        <polyline
          points={trailD}
          fill="none"
          stroke="#e08a45"
          strokeWidth={2}
          strokeOpacity={0.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4 3"
        />
      )}
      <foreignObject x={pos.x - chit / 2} y={pos.y - chit / 2} width={chit} height={chit}>
        <div className={['battle-chit', 'moving', anim.isAttacker ? 'attacker' : 'defender'].filter(Boolean).join(' ')}>
          <CreatureChit
            creature={anim.creatureType}
            power={anim.power}
            skill={anim.skill}
            baseColor={anim.baseColor}
            size={chit}
            hits={anim.hits > 0 && anim.hits < 999 ? anim.hits : 0}
          />
        </div>
      </foreignObject>
    </g>
  )
}

function stagingLayout(
  entrances: string[],
  land: ReturnType<typeof battleLand>,
  scale: number,
  mapCenter: { x: number; y: number },
  count: number,
  chit: number,
): { x: number; y: number }[] {
  if (entrances.length === 0 || count === 0) return []
  const centers = entrances
    .map((label) => land.hexByLabel[label])
    .filter((h): h is NonNullable<typeof h> => Boolean(h))
    .map((h) => hexCenter(h.x, h.y, scale))
  if (centers.length === 0) return []
  const avg = {
    x: centers.reduce((s, c) => s + c.x, 0) / centers.length,
    y: centers.reduce((s, c) => s + c.y, 0) / centers.length,
  }
  let dx = avg.x - mapCenter.x
  let dy = avg.y - mapCenter.y
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  const rim = chit * 1.55
  const originX = avg.x + dx * rim
  const originY = avg.y + dy * rim
  const px = -dy
  const py = dx
  const gap = chit + 6
  const start = -((count - 1) / 2) * gap
  return Array.from({ length: count }, (_, i) => ({
    x: originX + px * (start + i * gap),
    y: originY + py * (start + i * gap),
  }))
}

export function BattleBoardView({
  state,
  battle,
  onHexClick,
  onUnitClick,
  moveAnim = null,
  onMoveAnimDone,
}: Props) {
  // Colossus HexMap uses scale = 2 * Scale.get(); we pick a readable web size.
  // Battle chits are 4*Scale in Colossus while hex scale is 2*Scale → chit ≈ 2*scale.
  const scale = 14
  const chit = scale * 2
  const land = battleLand(state, battle)
  const selected = battle.selectedUnitId
  const strikePhase = battle.phase === 'Strike' || battle.phase === 'Strikeback'
  // Move highlights are hex labels; strike highlights are defender unit ids.
  const highlightHexes = new Set<string>()
  const highlightUnitIds = new Set<string>()
  if (strikePhase) {
    for (const id of battle.highlighted) {
      highlightUnitIds.add(id)
      const target = battle.units.find((u) => u.id === id)
      if (target?.hex) highlightHexes.add(target.hex)
    }
  } else {
    for (const label of battle.highlighted) highlightHexes.add(label)
  }
  const hexes = Object.values(land.hexByLabel)
  const entryHighlight = new Set([...battle.attackerEntrances, ...battle.defenderEntrances])

  let maxX = 0
  let maxY = 0
  let minX = Infinity
  let minY = Infinity
  for (const h of hexes) {
    const { cx, cy } = hexOrigin(h.x, h.y, scale)
    const b = hexBounds(cx, cy, scale)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  const pad = 40
  const mapCenter = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  }

  const offBoardAtk = battle.units.filter(
    (u) =>
      !u.hex &&
      isUnitAlive(state, u) &&
      u.legionId === battle.attackerLegionId &&
      moveAnim?.pieceId !== u.id,
  )
  const offBoardDef = battle.units.filter(
    (u) =>
      !u.hex &&
      isUnitAlive(state, u) &&
      u.legionId === battle.defenderLegionId &&
      moveAnim?.pieceId !== u.id,
  )
  const atkStaging = stagingLayout(
    battle.attackerEntrances,
    land,
    scale,
    mapCenter,
    offBoardAtk.length,
    chit,
  )
  const defStaging = stagingLayout(
    battle.defenderEntrances,
    land,
    scale,
    mapCenter,
    offBoardDef.length,
    chit,
  )

  for (const p of [...atkStaging, ...defStaging]) {
    minX = Math.min(minX, p.x - chit / 2)
    minY = Math.min(minY, p.y - chit / 2)
    maxX = Math.max(maxX, p.x + chit / 2)
    maxY = Math.max(maxY, p.y + chit / 2)
  }

  const activeOffBoard =
    battle.phase === 'Move' &&
    battle.units.some(
      (u) => !u.hex && isUnitAlive(state, u) && u.playerId === battle.activePlayerId,
    )

  return (
    <div className="battle-wrap">
      <div className="battle-meta">
        <strong>{battle.terrain}</strong> battle — {battle.activeHalf} {battle.phase} (turn{' '}
        {battle.turn}/7)
        <span className="muted">
          {' '}
          Active: {state.players.find((p) => p.id === battle.activePlayerId)?.name}
          {' · '}
          Attacker enters {battle.attackerEntrances.length} hexes / defender{' '}
          {battle.defenderEntrances.length}
        </span>
        {activeOffBoard && (
          <p className="hint battle-deploy-hint">
            Click a unit beside the board, then an entry hex (highlighted) to bring it in.
          </p>
        )}
      </div>
      <svg
        viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`}
        className="battle-board"
      >
        <defs>
          {hexes.map((h) => {
            const { cx, cy } = hexOrigin(h.x, h.y, scale)
            return (
              <clipPath key={`clip-${h.label}`} id={`bhex-clip-${h.label}`}>
                <polygon points={hexPath(cx, cy, scale)} />
              </clipPath>
            )
          })}
        </defs>
        {hexes.map((h) => {
          const { cx, cy } = hexOrigin(h.x, h.y, scale)
          const { x, y } = hexCenter(h.x, h.y, scale)
          const lit = highlightHexes.has(h.label)
          const entry = entryHighlight.has(h.label)
          const bounds = hexBounds(cx, cy, scale)
          const fill = terrainFill(h.terrain, h.elevation)
          return (
            <g key={h.label} onClick={() => onHexClick(h.label)} style={{ cursor: 'pointer' }}>
              <polygon
                points={hexPath(cx, cy, scale)}
                fill={fill}
                stroke={lit ? '#e08a45' : entry ? '#7ec8ff' : '#0a1014'}
                strokeWidth={lit ? 3 : entry ? 2 : 1.2}
                className={lit ? 'bhex lit' : 'bhex'}
              />
              {usesHazardArt(h.terrain) && (
                <SafeSvgImage
                  href={hazardImageUrl(h.terrain)}
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={bounds.height}
                  clipPath={`url(#bhex-clip-${h.label})`}
                  opacity={0.85}
                  preserveAspectRatio="xMidYMid slice"
                />
              )}
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                className="bhex-label"
                fill="#f0f4f8"
                stroke="#0a1014"
                strokeWidth={2.5}
                paintOrder="stroke"
                fontSize={9}
                fontWeight={700}
              >
                {h.label}
              </text>
            </g>
          )
        })}
        {battle.units
          .filter((u) => u.hex)
          .map((u) => {
            if (moveAnim?.pieceId === u.id) return null
            const hex = land.hexByLabel[u.hex!]
            if (!hex) return null
            const { x, y } = hexCenter(hex.x, hex.y, scale)
            const t = state.variant.creatures[u.creatureType]
            const power = getUnitPower(state, u)
            const skill = getUnitSkill(state, u)
            const dead = !isUnitAlive(state, u)
            const isSelected = selected === u.id
            const isStrikeTarget = highlightUnitIds.has(u.id)
            const isAttacker = u.legionId === battle.attackerLegionId
            return (
              <g key={u.id}>
                {isSelected && (
                  <rect
                    x={x - chit / 2 - 3}
                    y={y - chit / 2 - 3}
                    width={chit + 6}
                    height={chit + 6}
                    fill="none"
                    stroke="#e08a45"
                    strokeWidth={3}
                    rx={2}
                    pointerEvents="none"
                  />
                )}
                {isStrikeTarget && !isSelected && (
                  <rect
                    x={x - chit / 2 - 2}
                    y={y - chit / 2 - 2}
                    width={chit + 4}
                    height={chit + 4}
                    fill="none"
                    stroke="#c45c26"
                    strokeWidth={2.5}
                    rx={2}
                    pointerEvents="none"
                    className="battle-strike-target"
                  />
                )}
                <foreignObject
                  x={x - chit / 2}
                  y={y - chit / 2}
                  width={chit}
                  height={chit}
                  onClick={(e) => {
                    e.stopPropagation()
                    onUnitClick(u.id)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div
                    className={[
                      'battle-chit',
                      isAttacker ? 'attacker' : 'defender',
                      dead ? 'dead' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <CreatureChit
                      creature={u.creatureType}
                      power={power}
                      skill={skill}
                      baseColor={t?.baseColor}
                      size={chit}
                      hits={u.hits > 0 && u.hits < 999 ? u.hits : 0}
                    />
                    {dead && <span className="battle-chit-dead-x" aria-label="slain">✕</span>}
                  </div>
                </foreignObject>
              </g>
            )
          })}
        {[
          ...offBoardAtk.map((u, i) => ({ u, pos: atkStaging[i]!, isAttacker: true })),
          ...offBoardDef.map((u, i) => ({ u, pos: defStaging[i]!, isAttacker: false })),
        ].map(({ u, pos, isAttacker }) => {
          const t = state.variant.creatures[u.creatureType]
          const power = getUnitPower(state, u)
          const skill = getUnitSkill(state, u)
          const mine = u.playerId === battle.activePlayerId
          return (
            <g key={u.id}>
              <rect
                x={pos.x - chit / 2 - 3}
                y={pos.y - chit / 2 - 3}
                width={chit + 6}
                height={chit + 6}
                rx={4}
                className="battle-staging-slot"
                fill="rgba(10, 16, 20, 0.35)"
                stroke={selected === u.id ? '#e08a45' : 'rgba(126, 200, 255, 0.55)'}
                strokeWidth={selected === u.id ? 2.5 : 1.25}
              />
              <foreignObject
                x={pos.x - chit / 2}
                y={pos.y - chit / 2}
                width={chit}
                height={chit}
                onClick={(e) => {
                  e.stopPropagation()
                  onUnitClick(u.id)
                }}
                style={{ cursor: mine ? 'pointer' : 'default' }}
              >
                <div
                  className={[
                    'battle-chit',
                    'staging',
                    isAttacker ? 'attacker' : 'defender',
                    selected === u.id ? 'selected' : '',
                    mine ? '' : 'dim',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <CreatureChit
                    creature={u.creatureType}
                    power={power}
                    skill={skill}
                    baseColor={t?.baseColor}
                    size={chit}
                    hits={u.hits > 0 && u.hits < 999 ? u.hits : 0}
                  />
                </div>
              </foreignObject>
            </g>
          )
        })}
        {moveAnim && onMoveAnimDone && (
          <BattleAnimOverlay
            land={land}
            scale={scale}
            chit={chit}
            anim={moveAnim}
            mapCenter={mapCenter}
            onDone={onMoveAnimDone}
          />
        )}
      </svg>
    </div>
  )
}

