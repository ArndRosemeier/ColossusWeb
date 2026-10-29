import type { PresentationMode } from '../ui/presentationMode'
import { CreaturePresentation } from './CreaturePresentation'

/** Every battle slot takes this seam; classic retains its exact renderer. */
export function BattleCreature(props: {
  mode: PresentationMode; creature: string; power: number; skill: number
  baseColor?: string; size: number; hits?: number; moving?: boolean; attackId?: string; attackStartedAt?: number
  dead?: boolean; reducedMotion: boolean; isAttacker: boolean; onAssetError: (message: string) => void
}) {
  const { mode, reducedMotion, isAttacker, onAssetError, moving, attackId, attackStartedAt, dead, ...chit } = props
  return <CreaturePresentation {...chit} mode={mode} reducedMotion={reducedMotion} onAssetError={onAssetError}
    battleMotion={{ moving, attackId, attackStartedAt, dead, facingLeft: isAttacker }} />
}
