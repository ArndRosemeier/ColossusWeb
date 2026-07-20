export type AiSpeedId = 'paused' | 'slow' | 'normal' | 'fast' | 'instant'

export const AI_SPEEDS: Record<
  AiSpeedId,
  { label: string; delayMs: number | null; batch: number }
> = {
  paused: { label: 'Paused', delayMs: null, batch: 0 },
  slow: { label: 'Slow', delayMs: 750, batch: 1 },
  normal: { label: 'Normal', delayMs: 300, batch: 1 },
  fast: { label: 'Fast', delayMs: 90, batch: 1 },
  instant: { label: 'Instant', delayMs: 0, batch: 20 },
}
