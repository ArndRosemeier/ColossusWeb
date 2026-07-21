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
  Drift: '#7eb8d4',
  Volcano: '#8a2a1a',
  Lake: '#3a6a9a',
  Tree: '#2a5a28',
  Stone: '#6a6a6a',
  Tower: '#6a727c',
}

function lightenHex(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amount))
  const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(255 * amount))
  const b = Math.min(255, (n & 0xff) + Math.round(255 * amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function terrainFill(terrain: string, elevation: number): string {
  const base = TERRAIN_FILL[terrain] ?? '#6a7a5a'
  if (elevation <= 0) return base
  // Tint the terrain color — never replace with generic yellow (broke Abyss rim/pit)
  return elevation >= 2 ? lightenHex(base, 0.28) : lightenHex(base, 0.14)
}

function usesHazardArt(terrain: string): boolean {
  // No Tower_Hazard.gif in Colossus assets — rim uses fill color only (Abyss inverted keep).
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

/** Same point used to place an on-board chit (foreignObject centered here). */
function chitCenterAtHex(
  land: ReturnType<typeof battleLand>,
  hexLabel: string,
  scale: number,
): { x: number; y: number } | null {
  const hex = land.hexByLabel[hexLabel]
  return hex ? hexCenter(hex.x, hex.y, scale) : null
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

/** Colossus GUIBattleHex.drawHexside — simplified SVG markers along a hex edge. */
function HexsideMarks({
  verts,
  side,
  hazard,
}: {
  verts: [number, number][]
  side: number
  hazard: string
}) {
  if (hazard === 'nothing') return null
  const a = verts[side]!
  const b = verts[(side + 1) % 6]!
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // Inward normal (toward hex center ≈ rotate edge 90° — use average of verts)
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const cx = verts.reduce((s, p) => s + p[0], 0) / 6
  const cy = verts.reduce((s, p) => s + p[1], 0) / 6
  let nx = cx - mx
  let ny = cy - my
  const nlen = Math.hypot(nx, ny) || 1
  nx /= nlen
  ny /= nlen

  if (hazard === 'river') {
    return (
      <line
        x1={a[0]}
        y1={a[1]}
        x2={b[0]}
        y2={b[1]}
        className="bhex-river"
        stroke="#4eb0e0"
        strokeWidth={3.2}
        strokeLinecap="round"
        pointerEvents="none"
      />
    )
  }

  if (hazard === 'tower' || hazard === 'cliff') {
    const blocks = [0.2, 0.5, 0.8].map((t, j) => {
      const px = a[0] + dx * t
      const py = a[1] + dy * t
      const hw = len * 0.08
      const hh = hazard === 'tower' ? 3.2 : 4.2
      const x0 = px - ux * hw + nx * 0.5
      const y0 = py - uy * hw + ny * 0.5
      const x1 = px + ux * hw + nx * 0.5
      const y1 = py + uy * hw + ny * 0.5
      const x2 = px + ux * hw + nx * hh
      const y2 = py + uy * hw + ny * hh
      const x3 = px - ux * hw + nx * hh
      const y3 = py - uy * hw + ny * hh
      return (
        <polygon
          key={j}
          points={`${x0},${y0} ${x1},${y1} ${x2},${y2} ${x3},${y3}`}
          fill={hazard === 'cliff' ? '#f4f4f4' : '#f0f0f0'}
          stroke="#0a1014"
          strokeWidth={0.7}
          pointerEvents="none"
        />
      )
    })
    return <g className={`bhex-hexside bhex-${hazard}`}>{blocks}</g>
  }

  if (hazard === 'slope' || hazard === 'dune') {
    const marks = [0.25, 0.5, 0.75].map((t, j) => {
      const px = a[0] + dx * t
      const py = a[1] + dy * t
      const inward = hazard === 'slope' ? 4 : 3
      return (
        <line
          key={j}
          x1={px - ux * 2}
          y1={py - uy * 2}
          x2={px + nx * inward}
          y2={py + ny * inward}
          stroke={hazard === 'dune' ? '#c4a35a' : '#1a1a1a'}
          strokeWidth={1.4}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )
    })
    return <g className={`bhex-hexside bhex-${hazard}`}>{marks}</g>
  }

  return null
}

/** Soft arc control point, scaled to chord length (mild for adjacent hexes). */
function curveControl(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  // Keep a gentle bend — strong bulge on short chords looked like edge-to-corner shots
  const amount = Math.min(22, len * 0.22)
  return { x: mx + px * amount, y: my + py * amount }
}

/** Move `from` toward `to` by at most `inset` world units (≤18% of chord). */
function insetAlong(
  from: { x: number; y: number },
  to: { x: number; y: number },
  inset: number,
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const t = Math.min(inset, len * 0.18) / len
  return { x: from.x + dx * t, y: from.y + dy * t }
}

function arrowHeadPath(
  tip: { x: number; y: number },
  along: { x: number; y: number },
  size: number,
): string {
  const dx = tip.x - along.x
  const dy = tip.y - along.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const baseX = tip.x - ux * size
  const baseY = tip.y - uy * size
  const wing = size * 0.58
  return `M ${tip.x} ${tip.y} L ${baseX + px * wing} ${baseY + py * wing} L ${baseX - px * wing} ${baseY - py * wing} Z`
}

/**
 * Strike arrow between chit placement centers.
 * Tip sits on the target center; only the shaft start is pulled out from under the attacker.
 */
function StrikeArrow({
  from,
  to,
}: {
  from: { x: number; y: number }
  to: { x: number; y: number }
}) {
  const tip = to
  const start = insetAlong(from, to, 10)
  const ctrl = curveControl(start.x, start.y, tip.x, tip.y)
  const headSize = 9
  const tdx = tip.x - ctrl.x
  const tdy = tip.y - ctrl.y
  const tlen = Math.hypot(tdx, tdy) || 1
  const shaftEnd = {
    x: tip.x - (tdx / tlen) * headSize * 0.92,
    y: tip.y - (tdy / tlen) * headSize * 0.92,
  }
  const shaft = `M ${start.x} ${start.y} Q ${ctrl.x} ${ctrl.y} ${shaftEnd.x} ${shaftEnd.y}`
  const head = arrowHeadPath(tip, ctrl, headSize)
  return (
    <g className="battle-strike-arrow" pointerEvents="none" aria-hidden>
      <path d={shaft} className="battle-strike-arrow-glow" fill="none" pathLength={1} />
      <path d={head} className="battle-strike-arrow-glow-fill" />
      <path d={shaft} className="battle-strike-arrow-shaft" fill="none" pathLength={1} />
      <path d={head} className="battle-strike-arrow-head" />
      <circle cx={start.x} cy={start.y} r={2.4} className="battle-strike-arrow-origin" />
    </g>
  )
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
  const centers = anim.pathLabels.map(
    (label) => chitCenterAtHex(land, label, scale) ?? { x: 0, y: 0 },
  )
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

  const strikePair =
    state.pendingDice?.strike ??
    (state.diceRoll?.context === 'strike' ? state.diceRoll.strike : undefined)
  const strikeAttacker = strikePair
    ? battle.units.find((u) => u.id === strikePair.attackerId)
    : undefined
  const strikeDefender = strikePair
    ? battle.units.find((u) => u.id === strikePair.defenderId)
    : undefined
  // Use the same chit-placement centers as the unit foreignObjects
  const strikeFrom =
    strikeAttacker?.hex != null ? chitCenterAtHex(land, strikeAttacker.hex, scale) : null
  const strikeTo =
    strikeDefender?.hex != null ? chitCenterAtHex(land, strikeDefender.hex, scale) : null
  const showStrikeArrow = Boolean(strikeFrom && strikeTo)

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
            {land.hasStartList && !land.tower && battle.turn === 1 && battle.activeHalf === 'defender'
              ? 'Click a unit beside the board, then a start hex in the pit (highlighted) to deploy.'
              : 'Click a unit beside the board, then an entry hex (highlighted) to bring it in.'}
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
          const verts = hexVertices(cx, cy, scale)
          const hazardArt = usesHazardArt(h.terrain) ? hazardImageUrl(h.terrain) : ''
          return (
            <g key={h.label} onClick={() => onHexClick(h.label)} style={{ cursor: 'pointer' }}>
              <polygon
                points={hexPath(cx, cy, scale)}
                fill={fill}
                stroke={lit ? '#e08a45' : entry ? '#7ec8ff' : '#0a1014'}
                strokeWidth={lit ? 3 : entry ? 2 : 1.2}
                className={lit ? 'bhex lit' : 'bhex'}
              />
              {hazardArt && (
                <SafeSvgImage
                  href={hazardArt}
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={bounds.height}
                  clipPath={`url(#bhex-clip-${h.label})`}
                  opacity={0.85}
                  preserveAspectRatio="xMidYMid slice"
                />
              )}
              {h.hexsides.map((hazard, side) => (
                <HexsideMarks key={`${h.label}-hs-${side}`} verts={verts} side={side} hazard={hazard} />
              ))}
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
            const pos = chitCenterAtHex(land, u.hex!, scale)
            if (!pos) return null
            const { x, y } = pos
            const t = state.variant.creatures[u.creatureType]
            const power = getUnitPower(state, u)
            const skill = getUnitSkill(state, u)
            const dead = !isUnitAlive(state, u)
            const isSelected = selected === u.id
            const isStrikeTarget = highlightUnitIds.has(u.id)
            const isStrikeAttacker = strikePair?.attackerId === u.id
            const isStrikeDefender = strikePair?.defenderId === u.id
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
                {(isStrikeAttacker || isStrikeDefender) && (
                  <rect
                    x={x - chit / 2 - 3}
                    y={y - chit / 2 - 3}
                    width={chit + 6}
                    height={chit + 6}
                    fill="none"
                    stroke={isStrikeAttacker ? '#ff6b35' : '#e8edf2'}
                    strokeWidth={2.5}
                    rx={2}
                    pointerEvents="none"
                    className="battle-strike-endpoint"
                  />
                )}
                {isStrikeTarget && !isSelected && !isStrikeDefender && (
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
        {showStrikeArrow && strikeFrom && strikeTo && (
          <StrikeArrow from={strikeFrom} to={strikeTo} />
        )}
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

