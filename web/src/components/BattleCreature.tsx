import { hasCreatureAnimation } from '../ui/creatureAnimations'
import type { PresentationMode } from '../ui/presentationMode'
import { AnimatedCreature } from './AnimatedCreature'
import { CreatureChit } from './CreatureChit'

/** Every battle slot takes this seam; classic retains its exact renderer. */
export function BattleCreature(props: {
  mode: PresentationMode; creature: string; power: number; skill: number
  baseColor?: string; size: number; hits?: number; moving?: boolean; attackId?: string; attackStartedAt?: number
  dead?: boolean; reducedMotion: boolean; isAttacker: boolean; onAssetError: (message: string) => void
}) {
  const { mode, reducedMotion, isAttacker, onAssetError, moving, attackId, attackStartedAt, dead, ...chit } = props
  if (mode === 'classic') return <CreatureChit {...chit} />
  if (!hasCreatureAnimation(chit.creature)) {
    return <CreatureChit {...chit} title={`${chit.creature} ${chit.power}-${chit.skill} — Animated artwork unavailable for this variant creature; classic counter.`} />
  }
  return <AnimatedCreature {...chit} reducedMotion={reducedMotion} facingLeft={isAttacker}
    onAssetError={onAssetError} moving={moving} attackId={attackId} attackStartedAt={attackStartedAt} dead={dead} />
}
