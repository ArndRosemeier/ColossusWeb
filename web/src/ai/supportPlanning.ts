/** Executable support policy shared by engagement estimates and actual AI commands. */
import { canDonateSummon } from '../engine/battle'
import type { GameState, Legion } from '../engine/types'

type Value = (type: string, hex: string) => number

export function planReinforcement(options: readonly string[], hex: string, value: Value): string | null {
  let best: string | null = null
  let bestValue = -Infinity
  for (const type of options) {
    const score = value(type, hex)
    if (score > bestValue) { best = type; bestValue = score }
  }
  return best
}

export function planSummon(state: GameState, attacker: Legion, value: Value,
  sources: readonly Legion[] = state.legions,
): { fromLegionId: string; creatureType: string } | null {
  if (attacker.creatures.length >= 7) return null
  let best: { fromLegionId: string; creatureType: string } | null = null
  let bestNet = 0
  for (const donor of sources) {
    if (!canDonateSummon(state, donor, attacker)) continue
    // The engine takes the FIRST eligible creature; the command only selects a donor.
    const creature = donor.creatures.find((c) => state.variant.creatures[c.type]?.summonable)
    if (!creature) continue
    const remaining = donor.creatures.filter((c) => c !== creature)
    if (remaining.length === 1 && remaining[0].type === 'Titan') continue
    const net = value(creature.type, attacker.hexLabel) - 0.25 * value(creature.type, donor.hexLabel)
    if (net > bestNet) {
      bestNet = net
      best = { fromLegionId: donor.id, creatureType: creature.type }
    }
  }
  return best
}
