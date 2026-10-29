import { useEffect, useRef, useState } from 'react'
import { CREATURE_ANIMATIONS, creatureAtlasUrl, loadCreatureAtlas, type CreatureAnimationState } from '../ui/creatureAnimations'
import { CREATURE_COLORS } from '../variant/assets'

interface Props {
  creature: string
  power: number
  skill: number
  baseColor?: string
  size: number
  hits?: number
  moving?: boolean
  attackId?: string
  attackStartedAt?: number
  dead?: boolean
  reducedMotion: boolean
  facingLeft?: boolean
  onAssetError: (message: string) => void
}

/** Reusable full-frame renderer. Labels never mirror or rotate with the artwork. */
export function AnimatedCreature({ creature, power, skill, baseColor = 'black', size, hits = 0,
  moving = false, attackId, attackStartedAt, dead = false, reducedMotion, facingLeft = false, onAssetError }: Props) {
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
  const tip = `${creature} ${power}-${skill}${hits > 0 ? ` (${hits} hits)` : ''}`
  return (
    <div className="animated-creature" role="img" aria-label={tip} title={failure ?? tip}
      data-creature={creature} data-animation={phase} data-frame={frame}
      style={{ width: size, height: size, color: CREATURE_COLORS[baseColor] ?? '#000' }}>
      {failure ? <span className="animated-creature-error">Art unavailable</span> : (
        <span className="animated-creature-art" aria-hidden="true" style={{
          backgroundImage: `url("${creatureAtlasUrl(timeline)}")`,
          backgroundSize: `${timeline.columns * size}px ${timeline.rows * size}px`,
          backgroundPosition: `${-(frame % timeline.columns) * size}px ${-Math.floor(frame / timeline.columns) * size}px`,
          transform: facingLeft ? 'scaleX(-1)' : undefined,
        }} />
      )}
      <span className="animated-creature-name">{creature}</span>
      <span className="animated-creature-power">{power > 0 ? power : 'X'}</span>
      <span className="animated-creature-skill">{skill}</span>
      {hits > 0 && <span className="animated-creature-hits">{hits}</span>}
    </div>
  )
}
