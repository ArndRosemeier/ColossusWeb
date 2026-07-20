import { describe, expect, it } from 'vitest'
import { buildRecruitEdges, listRecruits, numberOfRecruiterNeeded } from '../recruit'
import type { CreatureType, TerrainDef } from '../../types/variant'
import { twoPlayerGame } from './helpers'

function creature(name: string, opts: Partial<CreatureType> = {}): CreatureType {
  return {
    name,
    power: 1,
    skill: 2,
    rangestrikes: false,
    flies: false,
    magicMissile: false,
    summonable: false,
    lord: false,
    demilord: false,
    count: 10,
    pluralName: name + 's',
    baseColor: 'black',
    native: {},
    ...opts,
  }
}

describe('recruit graph (data-driven)', () => {
  it('Tower Anything/AnyNonLord/Titan edges: basics, Guardian, Knight, Warlock', () => {
    const tower: TerrainDef = {
      name: 'Tower',
      color: 'grey',
      regularRecruit: false,
      recruits: [
        { name: 'Anything', number: 0 },
        { name: 'Centaur', number: 0 },
        { name: 'Anything', number: 0 },
        { name: 'Gargoyle', number: 0 },
        { name: 'Anything', number: 0 },
        { name: 'Ogre', number: 0 },
        { name: 'AnyNonLord', number: 0 },
        { name: 'Guardian', number: 3 },
        { name: 'AnyNonLord', number: 0 },
        { name: 'Knight', number: 5 },
        { name: 'Titan', number: -1 },
        { name: 'Warlock', number: 1 },
      ],
      starting: [],
    }
    const cre: Record<string, CreatureType> = {
      Titan: creature('Titan', { lord: true }),
      Angel: creature('Angel', { lord: true }),
      Centaur: creature('Centaur'),
      Gargoyle: creature('Gargoyle'),
      Ogre: creature('Ogre'),
      Guardian: creature('Guardian', { demilord: true }),
      Knight: creature('Knight', { demilord: true }),
      Warlock: creature('Warlock', { demilord: true }),
    }
    const edges = buildRecruitEdges(tower)
    expect(edges.some((e) => e.from === 'Anything' && e.to === 'Centaur' && e.number === 0)).toBe(
      true,
    )
    expect(edges.some((e) => e.from === 'AnyNonLord' && e.to === 'Guardian' && e.number === 3)).toBe(
      true,
    )
    expect(edges.some((e) => e.from === 'AnyNonLord' && e.to === 'Knight' && e.number === 5)).toBe(
      true,
    )
    expect(edges.some((e) => e.from === 'Titan' && e.to === 'Warlock' && e.number === 1)).toBe(true)

    expect(numberOfRecruiterNeeded(tower, 'Titan', 'Warlock', cre)).toBe(1)
    expect(numberOfRecruiterNeeded(tower, 'Centaur', 'Guardian', cre)).toBe(3)
    expect(numberOfRecruiterNeeded(tower, 'Centaur', 'Knight', cre)).toBe(5)
    expect(numberOfRecruiterNeeded(tower, 'Titan', 'Guardian', cre)).toBe(99)
    expect(numberOfRecruiterNeeded(tower, 'Ogre', 'Centaur', cre)).toBe(0)
  })

  it('Abyss-style Titan→Druid climb with regularRecruit', () => {
    const abyss: TerrainDef = {
      name: 'Abyss',
      color: 'purple',
      regularRecruit: true,
      recruits: [
        { name: 'Titan', number: -1 },
        { name: 'Druid', number: 1 },
        { name: 'AirElemental', number: 2 },
        { name: 'Balrog', number: 3 },
      ],
      starting: [],
    }
    const cre: Record<string, CreatureType> = {
      Titan: creature('Titan', { lord: true }),
      Druid: creature('Druid', { demilord: true }),
      AirElemental: creature('AirElemental'),
      Balrog: creature('Balrog', { lord: true, demilord: true }),
    }
    expect(numberOfRecruiterNeeded(abyss, 'Titan', 'Druid', cre)).toBe(1)
    expect(numberOfRecruiterNeeded(abyss, 'Druid', 'AirElemental', cre)).toBe(2)
    expect(numberOfRecruiterNeeded(abyss, 'AirElemental', 'Balrog', cre)).toBe(3)
    // regularRecruit: higher can recruit lower with 1
    expect(numberOfRecruiterNeeded(abyss, 'AirElemental', 'Druid', cre)).toBe(1)
  })

  it('listRecruits offers Knight when graph and caretaker allow', () => {
    const g = twoPlayerGame(1)
    // Inject Knight into Default tower tree + caretaker for the fixture
    const tower = g.variant.terrains.Tower!
    tower.recruits = [
      ...tower.recruits.slice(0, tower.recruits.findIndex((r) => r.name === 'Guardian') + 1),
      { name: 'AnyNonLord', number: 0 },
      { name: 'Knight', number: 5 },
      ...tower.recruits.slice(tower.recruits.findIndex((r) => r.name === 'Titan')),
    ]
    g.variant.creatures.Knight = creature('Knight', { demilord: true, power: 9, skill: 5 })
    g.caretaker.Knight = 2

    const leg = g.legions.find((l) => l.playerId === g.players[0].id)!
    const towerHex = Object.values(g.variant.board.hexByLabel).find((h) => h.terrain === 'Tower')!
    leg.hexLabel = towerHex.label
    leg.moved = true
    leg.recruited = false
    leg.creatures = Array.from({ length: 5 }, () => ({ type: 'Centaur', hits: 0 }))

    expect(listRecruits(g, leg)).toContain('Knight')
    expect(listRecruits(g, leg)).toContain('Guardian')
  })
})
