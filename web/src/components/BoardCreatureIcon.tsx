import { creatureArtworkTitle, unsupportedCreatureTitle, useCreaturePresentation } from '../ui/creaturePresentation'
import { creatureImageUrl } from '../variant/assets'
import { CreaturePresentation } from './CreaturePresentation'
import { SafeSvgImage } from './SafeSvgImage'

/** SVG footprint adapter; tiny board illustrations carry no invented stats/text. */
export function BoardCreatureIcon({ creature, x, y, width, height }: {
  creature: string; x: number; y: number; width: number; height: number
}) {
  const policy = useCreaturePresentation(creature)
  const classic = <SafeSvgImage href={creatureImageUrl(creature)} x={x} y={y} width={width} height={height}
    preserveAspectRatio="xMidYMid meet" />
  if (policy.kind === 'classic') return classic
  if (policy.kind === 'unsupported') return <g>
    <title>{unsupportedCreatureTitle(creatureArtworkTitle({ creature, artOnly: true }))}</title>{classic}
  </g>
  return <foreignObject className="board-creature-icon" data-creature={creature} x={x} y={y} width={width} height={height} pointerEvents="none">
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CreaturePresentation creature={creature} size={Math.min(width, height)} artOnly />
    </div>
  </foreignObject>
}
