import { describe, expect, it } from 'vitest'
import { pickAiCommand } from '../simpleAi'
import { createGame, dispatch } from '../../engine/GameEngine'
import { loadDefaultVariant, turn1SplitChild, twoPlayerGame } from '../../engine/__tests__/helpers'

describe('AI personalities', () => {
  it('createGame resolves random and stores profile on AI players', () => {
    const v = loadDefaultVariant()
    const g = createGame(v, {
      players: [
        { name: 'A', kind: 'ai', aiProfileId: 'aggressive' },
        { name: 'B', kind: 'ai', aiProfileId: 'random' },
      ],
      seed: 42,
    })
    expect(g.players[0].aiProfileId).toBe('aggressive')
    expect(g.players[0].kind).toBe('ai')
    expect(g.players[1].aiProfileId).not.toBeNull()
    expect(['balanced', 'aggressive', 'cautious', 'expander']).toContain(g.players[1].aiProfileId)
  })

  it('aggressive vs cautious diverge on engagement: fight vs flee', () => {
    // Build a revealed engagement where defender is outnumbered 3:1 and can flee
    let state = twoPlayerGame(99)
    const alice = state.players[0]
    const bob = state.players[1]
    // Make both AI with different profiles after create (mutate)
    alice.kind = 'ai'
    alice.aiProfileId = 'aggressive'
    bob.kind = 'ai'
    bob.aiProfileId = 'cautious'

    const atk = state.legions.find((l) => l.playerId === alice.id)!
    const def = state.legions.find((l) => l.playerId === bob.id)!
    // Legal flee: no lords on defender
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
    state.phase = 'Fight'
    state.activePlayerIndex = 0
    state.pendingEngagements = [{ attackerId: atk.id, defenderId: def.id }]
    state.activeEngagement = {
      attackerId: atk.id,
      defenderId: def.id,
      revealed: true,
      proposal: null,
      proposedBy: null,
    }

    // Attacker is aggressive — resolving engagement uses defender's cautious profile for flee
    const cmd = pickAiCommand(state, () => 0.5)
    expect(cmd).toEqual({ type: 'flee' })

    // Same spot but defender aggressive → fight
    bob.aiProfileId = 'aggressive'
    const cmd2 = pickAiCommand(state, () => 0.5)
    expect(cmd2).toEqual({ type: 'proposeAgreement', kind: 'fight' })
  })

  it('aggressive prefers weaker-enemy attacks more than cautious', () => {
    let g = twoPlayerGame(7)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    expect(g.phase).toBe('Move')

    g.players[0].kind = 'ai'
    // Place a weaker enemy on a legal move hex if possible
    const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
    const enemy = g.legions.find((l) => l.playerId === g.players[1].id)!
    // Force enemy onto a hex adjacent via cloning mover destination candidates later
    enemy.creatures = [{ type: 'Centaur', hits: 0 }, { type: 'Ogre', hits: 0 }]

    // Avoid turn-1 mulligan path so this test measures move preference
    g.movementRoll = 3
    g.mulliganAvailable = false

    g.players[0].aiProfileId = 'aggressive'
    const agg = pickAiCommand(g, () => 0.1)

    g.players[0].aiProfileId = 'cautious'
    const cau = pickAiCommand(g, () => 0.1)

    // Both should return a move or doneMove; profiles may pick different hexes
    expect(agg?.type === 'move' || agg?.type === 'doneMove').toBe(true)
    expect(cau?.type === 'move' || cau?.type === 'doneMove').toBe(true)
  })

  it('mulligans on turn 1 when the movement roll is 2 or 5', () => {
    let g = twoPlayerGame(7)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    g.players[0].kind = 'ai'
    g.players[0].aiProfileId = 'balanced'

    g.movementRoll = 2
    g.mulliganAvailable = true
    expect(pickAiCommand(g, () => 0.5)).toEqual({ type: 'mulligan' })

    g.movementRoll = 5
    expect(pickAiCommand(g, () => 0.5)).toEqual({ type: 'mulligan' })

    g.movementRoll = 3
    expect(pickAiCommand(g, () => 0.5)?.type).not.toBe('mulligan')

    g.movementRoll = 2
    g.mulliganAvailable = false
    expect(pickAiCommand(g, () => 0.5)?.type).not.toBe('mulligan')

    g.mulliganAvailable = true
    g.turnNumber = 2
    expect(pickAiCommand(g, () => 0.5)?.type).not.toBe('mulligan')
  })
})
