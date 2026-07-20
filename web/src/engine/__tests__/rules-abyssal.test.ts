import { describe, expect, it } from 'vitest'
import { createGame, dispatch, getLegalRecruits } from '../GameEngine'
import { listTeleportMoves } from '../movement'
import { listRecruits } from '../recruit'
import { loadNamedVariant, turn1SplitChild } from './helpers'

describe('Abyssal6 variant', () => {
  it('loads with Abyss terrain, skill-5 Titan, teleport@1000, Tower+Abyss battlelands', () => {
    const v = loadNamedVariant('Abyssal6')
    expect(v.data.name).toBe('Abyssal6')
    expect(v.data.titanTeleport).toBe(1000)
    expect(v.data.titanImprove).toBe(100)
    expect(v.creatures.Titan!.skill).toBe(5)
    expect(v.creatures.Balrog!.count).toBe(1)
    expect(v.creatures.Knight).toBeTruthy()
    expect(v.terrains.Abyss).toBeTruthy()
    expect(v.data.battlelands.Abyss).toBeTruthy()
    expect(v.data.battlelands.Tower).toBeTruthy()
    expect(Object.values(v.board.hexByLabel).some((h) => h.terrain === 'Abyss')).toBe(true)
  })

  it('Tower offers Knight with 5 identical non-lords; Abyss Titan recruits Druid', () => {
    const v = loadNamedVariant('Abyssal6')
    const g = createGame(v, {
      players: [
        { name: 'Alice', kind: 'human' },
        { name: 'Bob', kind: 'human' },
      ],
      seed: 1,
    })
    const titanLeg = g.legions.find((l) => l.creatures.some((c) => c.type === 'Titan'))!
    titanLeg.moved = true
    titanLeg.recruited = false
    // Opening stack is 8-high — muster requires height ≤ 6
    titanLeg.creatures = [
      { type: 'Titan', hits: 0 },
      { type: 'Angel', hits: 0 },
      { type: 'Centaur', hits: 0 },
    ]
    g.phase = 'Muster'

    const abyssHex = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Abyss')!
    titanLeg.hexLabel = abyssHex.label
    expect(listRecruits(g, titanLeg)).toContain('Druid')

    const towerHex = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Tower')!
    titanLeg.hexLabel = towerHex.label
    titanLeg.creatures = Array.from({ length: 5 }, () => ({ type: 'Centaur', hits: 0 }))
    expect(getLegalRecruits(g, titanLeg.id)).toContain('Knight')
    expect(getLegalRecruits(g, titanLeg.id)).toContain('Guardian')
  })

  it('Titan teleport uses score >= 1000 (not power 10)', () => {
    const v = loadNamedVariant('Abyssal6')
    let g = createGame(v, {
      players: [
        { name: 'Alice', kind: 'human' },
        { name: 'Bob', kind: 'human' },
      ],
      seed: 2,
    })
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    const titanLeg = g.legions.find(
      (l) =>
        l.playerId === g.players[0].id &&
        l.creatures.some((c) => c.type === 'Titan'),
    )!
    const enemyHex = g.legions.find((l) => l.playerId !== g.players[0].id)!.hexLabel
    g.players[0]!.score = 400
    g.players[0]!.titanPower = 10
    expect(listTeleportMoves(g, titanLeg, 6).has(enemyHex)).toBe(false)
    g.players[0]!.score = 1000
    expect(listTeleportMoves(g, titanLeg, 6).has(enemyHex)).toBe(true)
  })
})

describe('Abyssal3 / Abyssal9', () => {
  it('Abyssal3: max 3 players and Lion/Troll/Cyclops tower starts', () => {
    const v = loadNamedVariant('Abyssal3')
    expect(v.data.maxPlayers).toBe(3)
    expect(v.terrains.Tower!.starting.map((s) => s.name).sort()).toEqual(
      ['Cyclops', 'Lion', 'Troll'].sort(),
    )
    const g = createGame(v, {
      players: [
        { name: 'A', kind: 'human' },
        { name: 'B', kind: 'human' },
        { name: 'C', kind: 'ai' },
      ],
      seed: 1,
    })
    expect(g.legions).toHaveLength(3)
    expect(() =>
      createGame(v, {
        players: [
          { name: 'A', kind: 'human' },
          { name: 'B', kind: 'human' },
          { name: 'C', kind: 'ai' },
          { name: 'D', kind: 'ai' },
        ],
        seed: 1,
      }),
    ).toThrow(/at most 3/i)
  })

  it('Abyssal9: max 9 players and teleport at 1500', () => {
    const v = loadNamedVariant('Abyssal9')
    expect(v.data.maxPlayers).toBe(9)
    expect(v.data.titanTeleport).toBe(1500)
    expect(v.board.towers.length).toBeGreaterThanOrEqual(9)
  })
})
