import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CREATURE_ANIMATIONS, creatureAtlasUrl, loadCreatureAtlas, type CreatureAnimationState } from '../ui/creatureAnimations'
import { useReducedMotion } from '../ui/battlePresentation'
import { creatureArtworkTitle, type CreatureArtworkProps } from '../ui/creaturePresentation'
import { CREATURE_COLORS } from '../variant/assets'

type Props = CreatureArtworkProps & {
  size: number
  hits?: number
  moving?: boolean
  attackId?: string
  attackStartedAt?: number
  dead?: boolean
  reducedMotion?: boolean
  facingLeft?: boolean
  onAssetError: (message: string) => void
}

/** Reusable full-frame renderer. Labels never mirror or rotate with the artwork. */
export function AnimatedCreature(props: Props) {
  const { creature, baseColor = 'black', size, hits = 0,
    moving = false, attackId, attackStartedAt, dead = false, reducedMotion: reducedMotionOverride, facingLeft = false, onAssetError,
    artOnly = false, className } = props
  const systemReducedMotion = useReducedMotion()
  const reducedMotion = reducedMotionOverride ?? systemReducedMotion
  const animations = CREATURE_ANIMATIONS[creature]
  const [playback, setPlayback] = useState<{ phase: CreatureAnimationState; frame: number }>({ phase: 'resting', frame: 0 })
  const [failure, setFailure] = useState<string | null>(null)
  const attack = useRef({ id: undefined as string | undefined, startedAt: 0, finished: true, deadAtStart: false })
  const onErrorRef = useRef(onAssetError)
  onErrorRef.current = onAssetError

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    if (attack.current.id !== attackId) {
      attack.current = { id: attackId, startedAt: attackStartedAt ?? Date.now(), finished: attackId === undefined, deadAtStart: dead }
    }
    // Death stops existing animation. A NEW engine strike may still be a legal
    // dead unit's Strikeback: the presentation must not invent a second rules guard.
    if (reducedMotion || moving || (dead && !attack.current.deadAtStart)) attack.current.finished = true
    const newAttack = attackId !== undefined && !attack.current.finished
    setFailure(null)
    const play = async (phase: CreatureAnimationState) => {
      const timeline = animations[phase]
      try {
        await loadCreatureAtlas(timeline)
        if (cancelled) return
        let frame = 0
        let firstDuration = timeline.durations[0]
        // Continue the same event after an overlay/remount; never replay its windup.
        if (phase === 'attacking') {
          let elapsed = Math.max(0, Date.now() - attack.current.startedAt)
          while (frame < timeline.durations.length && elapsed >= timeline.durations[frame]) {
            elapsed -= timeline.durations[frame]
            frame += 1
          }
          if (frame === timeline.durations.length) {
            attack.current.finished = true
            void play(moving ? 'moving' : 'resting')
            return
          }
          firstDuration = timeline.durations[frame] - elapsed
        }
        setPlayback({ phase, frame })
        if (reducedMotion || (dead && phase !== 'attacking')) return
        const advance = () => {
          if (cancelled) return
          frame += 1
          if (frame === timeline.durations.length) {
            if (phase === 'attacking') { attack.current.finished = true; void play(moving ? 'moving' : 'resting'); return }
            frame = 0
          }
          setPlayback({ phase, frame })
          timer = setTimeout(advance, timeline.durations[frame])
        }
        timer = setTimeout(advance, firstDuration)
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setFailure(message)
        onErrorRef.current(message)
      }
    }
    void play(reducedMotion ? 'resting' : newAttack ? 'attacking' : dead ? 'resting' : moving ? 'moving' : 'resting')
    return () => { cancelled = true; clearTimeout(timer) }
  }, [animations, attackId, attackStartedAt, moving, dead, reducedMotion])

  const still = reducedMotion || (dead && (attack.current.finished || !attack.current.deadAtStart))
  const phase = still ? 'resting' : playback.phase
  const frame = still ? 0 : playback.frame
  const timeline = animations[phase]
  const tip = creatureArtworkTitle(props)
  const unit = size / 28
  const tinyError = artOnly && size < 24
  return (
    <div className={`animated-creature${className ? ` ${className}` : ''}`} role="img" aria-label={failure ? `${tip} — artwork unavailable` : tip} title={failure ? `${tip} — ${failure}` : tip}
      data-creature={creature} data-animation={phase} data-frame={frame}
      data-art-only={artOnly ? 'true' : undefined}
      style={{ width: size, height: size, color: CREATURE_COLORS[baseColor] ?? '#000',
        '--creature-unit': `${unit}px`, '--creature-name-size': `${5 * unit}px`, '--creature-stat-size': `${7 * unit}px`,
        '--creature-hit-size': `${9 * unit}px`, '--creature-hit-top': `${7 * unit}px`,
        '--creature-error-size': `${tinyError ? Math.max(8, size * 0.55) : Math.max(5, 6 * unit)}px`, '--creature-error-inset': `${tinyError ? 0 : Math.min(size / 4, 6 * unit)}px`,
      } as CSSProperties}>
      {failure ? <span className="animated-creature-error">{tinyError ? '!' : 'Art unavailable'}</span> : (
        <span className="animated-creature-art" aria-hidden="true" style={{
          backgroundImage: `url("${creatureAtlasUrl(timeline)}")`,
          backgroundSize: `${timeline.columns * size}px ${timeline.rows * size}px`,
          backgroundPosition: `${-(frame % timeline.columns) * size}px ${-Math.floor(frame / timeline.columns) * size}px`,
          transform: facingLeft ? 'scaleX(-1)' : undefined,
        }} />
      )}
      {props.artOnly !== true && <>
        <span className="animated-creature-name">{creature}</span>
        <span className="animated-creature-power">{props.power > 0 ? props.power : 'X'}</span>
        <span className="animated-creature-skill">{props.skill}</span>
        {hits > 0 && <span className="animated-creature-hits">{hits}</span>}
      </>}
    </div>
  )
}
