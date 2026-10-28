/**
 * An AI legion entering a battle must not strand its own Titan off the board.
 *
 * Units still off the board after their side's first maneuver are eliminated
 * (`killUnentered`), and units block each other's paths. The AI used to deploy
 * its other creatures first wherever they scored best, which in Woods often
 * left no reachable hex for the Titan: the Titan died before the human had a
 * single turn, and that player was out of the game (owner's report, 1.01).
 */
import { describe, expect, it } from 'vitest'
import { dispatch } from '../../engine/GameEngine'
import type { EntrySide, GameState } from '../../engine/types'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { pickAiCommand } from '../simpleAi'

const LEGIONS = [
  ['Titan', 'Gorgon', 'Gorgon', 'Cyclops', 'Cyclops', 'Behemoth', 'Ogre'],
  ['Titan', 'Troll', 'Troll', 'Ranger', 'Lion', 'Lion', 'Cyclops'],
]

/** A human attacks a 7-high AI legion in Woods; returns the state after the AI moved in. */
function aiDefenderMovesIn(side: EntrySide, creatures: string[], seed: number): GameState {
  const s = twoPlayerGame(seed)
  s.players[1]!.kind = 'ai'
  const hex = s.variant.data.map.hexes.find((h) => h.terrain === 'Woods')!
  const attacker = s.legions[0]!
  const defender = s.legions[1]!
  attacker.hexLabel = defender.hexLabel = hex.label
  attacker.enteredFrom = side
  attacker.creatures = [
    { type: 'Titan', hits: 0 },
    { type: 'Ogre', hits: 0 },
  ]
  defender.creatures = creatures.map((type) => ({ type, hits: 0 }))
  s.phase = 'Fight'
  s.pendingEngagements = [{ attackerId: attacker.id, defenderId: defender.id }]
  let g = dispatch(s, { type: 'startEngagement', attackerId: attacker.id, defenderId: defender.id })
  g = dispatch(g, { type: 'proposeAgreement', kind: 'fight' })
  expect(g.battle?.activeHalf).toBe('defender')
  let x = seed * 7
  const rng = () => (x = (x * 9301 + 49297) % 233280) / 233280
  for (let i = 0; i < 60 && g.battle && !g.battle.firstManeuverDone.defender; i++) {
    const cmd = pickAiCommand(g, rng)
    if (!cmd) break
    g = dispatch(g, cmd, rng)
  }
  expect(g.battle?.firstManeuverDone.defender).toBe(true)
  return g
}

describe('AI battle entry keeps room for every creature', () => {
  for (const side of ['Bottom', 'Left', 'Right'] as const) {
    for (const creatures of LEGIONS) {
      it(`Woods from ${side}: ${creatures.join(', ')}`, () => {
        const g = aiDefenderMovesIn(side, creatures, 1)
        expect(g.log.filter((l) => /failed to enter/.test(l))).toEqual([])
        expect(g.winnerId).toBeFalsy()
      })
    }
  }
})
