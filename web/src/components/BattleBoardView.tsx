import { battleLand, getUnitPower, getUnitSkill } from '../engine/battle'
import type { BattleState, GameState } from '../engine/types'
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
}

export function BattleBoardView({ state, battle, onHexClick, onUnitClick }: Props) {
  // Colossus HexMap uses scale = 2 * Scale.get(); we pick a readable web size.
  // Battle chits are 4*Scale in Colossus while hex scale is 2*Scale → chit ≈ 2*scale.
  const scale = 14
  const chit = scale * 2
  const land = battleLand(state, battle)
  const highlight = new Set(battle.highlighted)
  const selected = battle.selectedUnitId
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
          const lit = highlight.has(h.label)
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
            const hex = land.hexByLabel[u.hex!]
            if (!hex) return null
            const { x, y } = hexCenter(hex.x, hex.y, scale)
            const t = state.variant.creatures[u.creatureType]
            const power = getUnitPower(state, u)
            const skill = getUnitSkill(state, u)
            const dead = u.hits >= power
            return (
              <foreignObject
                key={u.id}
                x={x - chit / 2}
                y={y - chit / 2}
                width={chit}
                height={chit}
                onClick={(e) => {
                  e.stopPropagation()
                  onUnitClick(u.id)
                }}
                style={{ cursor: 'pointer', opacity: dead ? 0.35 : 1 }}
              >
                <div className={selected === u.id ? 'battle-chit selected' : 'battle-chit'}>
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
            )
          })}
      </svg>
    </div>
  )
}
