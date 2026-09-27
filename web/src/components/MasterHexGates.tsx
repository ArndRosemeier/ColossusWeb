import type { GateType } from '../types/variant'
import { archGeometry, arrowTriple, blockOutline, gateLen, pts } from './gateGeometry'

function GateShape({
  vx1,
  vy1,
  vx2,
  vy2,
  gate,
  scale,
}: {
  vx1: number
  vy1: number
  vx2: number
  vy2: number
  gate: GateType
  scale: number
}) {
  if (gate === 'NONE') return null
  const len = gateLen(scale)
  const theta = Math.atan2(vy2 - vy1, vx2 - vx1)
  const x0 = vx1 + (vx2 - vx1) / 6
  const y0 = vy1 + (vy2 - vy1) / 6
  const x1 = vx1 + (vx2 - vx1) / 3
  const y1 = vy1 + (vy2 - vy1) / 3

  if (gate === 'BLOCK') {
    return (
      <polygon className="master-gate" points={pts(blockOutline(vx1, vy1, vx2, vy2, scale))} />
    )
  }

  // ARCH is ROUND on one side and square on the other. Drawn as Colossus draws it: a
  // filled half-disc cap plus a later-filled stem, with only the two perpendicular stem
  // sides stroked, so the flat far end and the hexside stay unlined. See gateGeometry.ts.
  if (gate === 'ARCH') {
    const arch = archGeometry(vx1, vy1, vx2, vy2, scale)
    return (
      <g className="master-gate">
        <path d={arch.cap} />
        <polygon points={pts(arch.stem)} stroke="none" />
        {arch.sides.map(([from, to], i) => (
          <line key={i} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />
        ))}
      </g>
    )
  }

  if (gate === 'ARROW') {
    const tri: [number, number][] = [
      [x0 - len * Math.sin(theta), y0 + len * Math.cos(theta)],
      [(x0 + x1) / 2 + len * Math.sin(theta), (y0 + y1) / 2 - len * Math.cos(theta)],
      [x1 - len * Math.sin(theta), y1 + len * Math.cos(theta)],
    ]
    return <polygon className="master-gate" points={pts(tri)} />
  }

  return (
    <g className="master-gate">
      {[0, 1, 2].map((j) => (
        <polygon key={j} points={pts(arrowTriple(j, vx1, vy1, vx2, vy2, theta, len))} />
      ))}
    </g>
  )
}

/**
 * Colossus GUIMasterHex gates: block / arch / arrow / triple-arrow.
 * Only every other hexside is painted (exits + neighbour entrances) so shared
 * edges are not drawn twice.
 */
export function MasterHexGates({
  verts,
  inverted,
  exitType,
  entranceType,
  scale,
}: {
  verts: [number, number][]
  inverted: boolean
  exitType: GateType[]
  entranceType: GateType[]
  scale: number
}) {
  const start = inverted ? 0 : 1
  const marks: { key: string; vx1: number; vy1: number; vx2: number; vy2: number; gate: GateType }[] =
    []
  for (let i = start; i < 6; i += 2) {
    const n = (i + 1) % 6
    const [ax, ay] = verts[i]!
    const [bx, by] = verts[n]!
    const exit = exitType[i] ?? 'NONE'
    if (exit !== 'NONE') {
      marks.push({ key: `ex-${i}`, vx1: ax, vy1: ay, vx2: bx, vy2: by, gate: exit })
    }
    const entrance = entranceType[i] ?? 'NONE'
    if (entrance !== 'NONE') {
      marks.push({ key: `en-${i}`, vx1: bx, vy1: by, vx2: ax, vy2: ay, gate: entrance })
    }
  }
  if (marks.length === 0) return null
  return (
    <g className="master-hex-gates" pointerEvents="none">
      {marks.map((m) => (
        <GateShape
          key={m.key}
          vx1={m.vx1}
          vy1={m.vy1}
          vx2={m.vx2}
          vy2={m.vy2}
          gate={m.gate}
          scale={scale}
        />
      ))}
    </g>
  )
}
