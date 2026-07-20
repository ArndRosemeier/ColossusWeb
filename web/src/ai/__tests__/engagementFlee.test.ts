import { describe, expect, it } from 'vitest'
import { aiDefenderShouldFlee } from '../engagementDecision'
import { twoPlayerGame } from '../../engine/__tests__/helpers'

describe('aiDefenderShouldFlee', () => {
  function hopelessEngagement(defProfile: 'balanced' | 'aggressive' | 'cautious') {
    const state = twoPlayerGame(101)
    const alice = state.players[0]!
    const bob = state.players[1]!
    bob.kind = 'ai'
    bob.aiProfileId = defProfile
    alice.kind = 'ai'
    alice.aiProfileId = 'aggressive'
    const atk = state.legions.find((l) => l.playerId === alice.id)!
    const def = state.legions.find((l) => l.playerId === bob.id)!
    def.creatures = [
      { type: 'Centaur', hits: 0 },
      { type: 'Ogre', hits: 0 },
    ]
    atk.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Angel', hits: 0 },
      { type: 'Centaur', hits: 0 },
      { type: 'Centaur', hits: 0 },
      { type: 'Gargoyle', hits: 0 },
      { type: 'Ogre', hits: 0 },
    ]
    def.hexLabel = atk.hexLabel
    state.activeEngagement = {
      attackerId: atk.id,
      defenderId: def.id,
      revealed: true,
      proposal: null,
      proposedBy: null,
    }
    return state
  }

  it('balanced flees when the attacker is clearly favored', () => {
    expect(aiDefenderShouldFlee(hopelessEngagement('balanced'))).toBe(true)
  })

  it('aggressive still fights moderately crushing odds', () => {
    expect(aiDefenderShouldFlee(hopelessEngagement('aggressive'))).toBe(false)
  })

  it('does not flee when the defender has a Lord', () => {
    const state = hopelessEngagement('balanced')
    const def = state.legions.find((l) => l.id === state.activeEngagement!.defenderId)!
    def.creatures.push({ type: 'Angel', hits: 0 })
    expect(aiDefenderShouldFlee(state)).toBe(false)
  })
})
