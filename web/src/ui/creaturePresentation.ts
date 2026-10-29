import { createContext, useContext } from 'react'
import { hasCreatureAnimation } from './creatureAnimations'
import { usePresentationMode, type PresentationMode } from './presentationMode'

export type CreatureAssetErrorHandler = (message: string) => void

/** Scoped transport to App.notify, never a second error UI or game-state store. */
export const CreatureAssetErrorContext = createContext<CreatureAssetErrorHandler | null>(null)

export type CreatureArtworkProps = {
  creature: string
  baseColor?: string
  size?: number
  hits?: number
  title?: string
  className?: string
} & ({ artOnly: true; power?: never; skill?: never } | { artOnly?: false; power: number; skill: number })

export function useCreaturePresentation(creature: string, explicitMode?: PresentationMode): {
  kind: 'classic' | 'animated' | 'unsupported'
  onAssetError: CreatureAssetErrorHandler | null
} {
  const preferred = usePresentationMode()
  const onAssetError = useContext(CreatureAssetErrorContext)
  const mode = explicitMode ?? preferred
  return { kind: mode === 'classic' ? 'classic' : hasCreatureAnimation(creature) ? 'animated' : 'unsupported', onAssetError }
}

export function creatureArtworkTitle(props: CreatureArtworkProps): string {
  return props.title ?? (props.artOnly ? props.creature : `${props.creature} ${props.power}-${props.skill}${
    props.hits && props.hits > 0 ? ` (${props.hits} hit${props.hits === 1 ? '' : 's'})` : ''}`)
}

export function unsupportedCreatureTitle(title: string): string {
  return `${title} — Animated artwork unavailable for this variant creature; classic counter.`
}
