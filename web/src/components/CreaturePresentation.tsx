import type { PresentationMode } from '../ui/presentationMode'
import { creatureArtworkTitle, unsupportedCreatureTitle, useCreaturePresentation, type CreatureArtworkProps, type CreatureAssetErrorHandler } from '../ui/creaturePresentation'
import { creatureImageUrl } from '../variant/assets'
import { AnimatedCreature } from './AnimatedCreature'
import { CreatureChit, SafeImg } from './CreatureChit'

/** All revealed creature artwork shares this policy. UnknownChit never enters it. */
export function CreaturePresentation(props: CreatureArtworkProps & {
  mode?: PresentationMode
  reducedMotion?: boolean
  onAssetError?: CreatureAssetErrorHandler
  /** Only BattleCreature supplies combat presentation events. Other consumers rest. */
  battleMotion?: { moving?: boolean; attackId?: string; attackStartedAt?: number; dead?: boolean; facingLeft?: boolean }
}) {
  const { mode, reducedMotion, onAssetError, battleMotion, ...artwork } = props
  const policy = useCreaturePresentation(artwork.creature, mode)
  if (policy.kind !== 'animated') {
    const title = policy.kind === 'unsupported' ? unsupportedCreatureTitle(creatureArtworkTitle(artwork)) : artwork.title
    if (artwork.artOnly) return <SafeImg src={creatureImageUrl(artwork.creature)} alt={creatureArtworkTitle(artwork)}
      title={title} className={artwork.className} width={artwork.size ?? 48} height={artwork.size ?? 48} />
    const { artOnly: _artOnly, ...chit } = artwork
    return <CreatureChit {...chit} title={title} />
  }
  const reportError = onAssetError ?? policy.onAssetError
  if (!reportError) throw new Error('Animated creature artwork requires an App notice callback or CreatureAssetErrorContext provider.')
  return <AnimatedCreature {...artwork} size={artwork.size ?? 48} {...battleMotion}
    reducedMotion={reducedMotion} onAssetError={reportError} />
}
