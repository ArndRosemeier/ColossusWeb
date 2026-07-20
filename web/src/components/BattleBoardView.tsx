import { battleLand, getUnitPower, getUnitSkill } from '../engine/battle'
import type { BattleState, GameState } from '../engine/types'
import { CreatureChit } from './CreatureChit'

const SQRT3 = Math.sqrt(3)

function pixelFromXY(col: number, row: number, size: number): { x: number; y: number } {
  const x = size * (1.5 * col)
  const y = size * SQRT3 * (row + 0.5 * (col & 1))
  return { x, y }
}

function hexPath(x: number, y: number, size: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180
    pts.push(`${x + size * Math.cos(angle)},${y + size * Math.sin(angle)}`)
  }
  return pts.join(' ')
}

interface Props {
  state: GameState
  battle: BattleState
  onHexClick: (hex: string) => void
  onUnitClick: (unitId: string) => void
}

export function BattleBoardView({ state, battle, onHexClick, onUnitClick }: Props) {
  const size = 28
  const chit = 40
  const land = battleLand(state, battle)
  const highlight = new Set(battle.highlighted)
  const selected = battle.selectedUnitId
  const hexes = Object.values(land.hexByLabel)

  let maxX = 0
  let maxY = 0
  for (const h of hexes) {
    const p = pixelFromXY(h.x, h.y, size)
    maxX = Math.max(maxX, p.x + size * 2)
    maxY = Math.max(maxY, p.y + size * 2)
  }

  return (
    <div className="battle-wrap">
      <div className="battle-meta">
        <strong>{battle.terrain}</strong> battle — {battle.activeHalf} {battle.phase} (turn{' '}
        {battle.turn}/7)
        <span className="muted">
          {' '}
          Active: {state.players.find((p) => p.id === battle.activePlayerId)?.name}
        </span>
      </div>
      <svg viewBox={`-50 -50 ${maxX + 100} ${maxY + 100}`} className="battle-board">
        {hexes.map((h) => {
          const { x, y } = pixelFromXY(h.x, h.y, size)
          const lit = highlight.has(h.label)
          return (
            <g key={h.label} onClick={() => onHexClick(h.label)} style={{ cursor: 'pointer' }}>
              <polygon
                points={hexPath(x, y, size)}
                className={lit ? 'bhex lit' : 'bhex'}
                data-terrain={h.terrain}
              />
              <text x={x} y={y + 4} textAnchor="middle" className="bhex-label">
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
            const { x, y } = pixelFromXY(hex.x, hex.y, size)
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
                  />
                </div>
              </foreignObject>
            )
          })}
      </svg>
    </div>
  )
}
