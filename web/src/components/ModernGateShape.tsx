import type { GateType } from '../types/variant'
import { archGeometry, arrowTriple, blockOutline, gateLen, pts } from './gateGeometry'

/** Crafted glyphs share Classic's actual geometry/normal and placement anchors. */
export function ModernGateShape({ vx1, vy1, vx2, vy2, gate, scale, metalId }: {
  vx1: number; vy1: number; vx2: number; vy2: number; gate: GateType; scale: number; metalId?: string
}) {
  const metal = metalId ? `url(#${metalId})` : '#d9c7a3'
  const len = gateLen(scale)
  const theta = Math.atan2(vy2 - vy1, vx2 - vx1)
  const centerX = vx1 + (vx2 - vx1) / 4
  const centerY = vy1 + (vy2 - vy1) / 4
  if (gate === 'BLOCK') {
    const outline = blockOutline(vx1, vy1, vx2, vy2, scale)
    return <g className="modern-gate-block">
      <polygon points={pts(outline)} fill={metal} stroke="#07121b" strokeWidth={2} strokeLinejoin="miter" />
      <polygon points={pts(outline)} transform={`translate(${centerX} ${centerY}) scale(.67) translate(${-centerX} ${-centerY})`}
        fill="#7c898b" stroke="#f0e4c9" strokeWidth={0.65} />
      <line x1={(outline[0][0] + outline[3][0]) / 2} y1={(outline[0][1] + outline[3][1]) / 2}
        x2={(outline[1][0] + outline[2][0]) / 2} y2={(outline[1][1] + outline[2][1]) / 2} stroke="#263b46" strokeWidth={0.7} />
    </g>
  }
  if (gate === 'ARCH') {
    const arch = archGeometry(vx1, vy1, vx2, vy2, scale)
    return <g className="modern-gate-arch">
      <path className="modern-arch-cap" d={arch.cap} fill={metal} stroke="#07121b" strokeWidth={2} />
      <polygon points={pts(arch.stem)} fill={metal} stroke="#07121b" strokeWidth={1.4} />
      <g transform={`translate(${centerX} ${centerY}) scale(.52) translate(${-centerX} ${-centerY})`}>
        <path d={arch.cap} fill="#12222c" stroke="#fff0cf" strokeWidth={1} />
        <polygon points={pts(arch.stem)} fill="#12222c" stroke="none" />
      </g>
      {arch.sides.map(([from, to], i) => <line key={i} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="#e8d5b0" strokeWidth={0.65} />)}
    </g>
  }
  if (gate !== 'ARROW' && gate !== 'ARROWS') return null
  return <g className="modern-gate-arrows">
    {(gate === 'ARROWS' ? [0, 1, 2] : [0]).map(index => {
      const triangle = arrowTriple(index, vx1, vy1, vx2, vy2, theta, len)
      const tip = triangle[1]
      const base = [(triangle[0][0] + triangle[2][0]) / 2, (triangle[0][1] + triangle[2][1]) / 2]
      const mid = [(tip[0] + base[0]) / 2, (tip[1] + base[1]) / 2]
      return <g key={index} data-arrow-head={index} data-tip-x={tip[0]} data-tip-y={tip[1]}>
        <line x1={base[0]} y1={base[1]} x2={base[0] - Math.sin(theta) * 1.4} y2={base[1] + Math.cos(theta) * 1.4}
          stroke="#09141d" strokeWidth={3.2} strokeLinecap="round" />
        <polygon className="modern-arrow-outline" points={pts(triangle)} fill={metal} stroke="#07121b" strokeWidth={2} strokeLinejoin="round" />
        <polygon points={pts(triangle)} transform={`translate(${mid[0]} ${mid[1]}) scale(.58) translate(${-mid[0]} ${-mid[1]})`}
          fill="#f6dfb0" stroke="#fff5df" strokeWidth={0.45} />
        <path d={`M ${triangle[0][0]} ${triangle[0][1]} L ${tip[0]} ${tip[1]}`} fill="none" stroke="#fff4d9" strokeWidth={0.55} />
      </g>
    })}
  </g>
}
