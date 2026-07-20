import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hydrateVariant } from '../../variant/loadVariant'
import { buildBoard } from '../../variant/buildBoard'
import { createGame, dispatch, getLegalRecruits } from '../GameEngine'
import { listAllMoves } from '../movement'
import { listRecruits } from '../recruit'
import type { VariantData } from '../../types/variant'
import { turn1SplitChild } from './helpers'

const here = dirname(fileURLToPath(import.meta.url))

function loadVariantFromDisk(): ReturnType<typeof hydrateVariant> {
  const raw = readFileSync(
    resolve(here, '../../../public/variants/Default/variant.json'),
    'utf8',
  )
  return hydrateVariant(JSON.parse(raw) as VariantData)
}

describe('variant board', () => {
  it('loads Default map with 6 towers', () => {
    const v = loadVariantFromDisk()
    expect(v.board.towers).toHaveLength(6)
    expect(Object.keys(v.board.hexByLabel).length).toBe(96)
    expect(v.board.hexByLabel['100'].terrain).toBe('Tower')
  })

  it('wires neighbors for tower 100', () => {
    const v = loadVariantFromDisk()
    const hex = v.board.hexByLabel['100']
    const neighbors = hex.neighbors.filter(Boolean)
    expect(neighbors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('game engine', () => {
  it('starts with titan, angel, and six tower creatures', () => {
    const v = loadVariantFromDisk()
    const g = createGame(v, {
      players: [
        { name: 'Alice', kind: 'human' },
        { name: 'Bob', kind: 'ai' },
      ],
      seed: 42,
    })
    expect(g.legions).toHaveLength(2)
    for (const leg of g.legions) {
      const types = leg.creatures.map((c) => c.type)
      expect(types).toContain('Titan')
      expect(types).toContain('Angel')
      expect(types.filter((t) => t === 'Centaur')).toHaveLength(2)
      expect(types.filter((t) => t === 'Gargoyle')).toHaveLength(2)
      expect(types.filter((t) => t === 'Ogre')).toHaveLength(2)
      expect(types).toHaveLength(8)
    }
  })

  it('can split and move', () => {
    const v = loadVariantFromDisk()
    let g = createGame(v, {
      players: [
        { name: 'Alice', kind: 'human' },
        { name: 'Bob', kind: 'human' },
      ],
      seed: 7,
    })
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    expect(g.legions.filter((l) => l.playerId === g.players[0].id)).toHaveLength(2)

    g = dispatch(g, { type: 'doneSplit' })
    expect(g.phase).toBe('Move')
    expect(g.movementRoll).toBeGreaterThanOrEqual(1)

    const mover = g.legions.find((l) => l.playerId === g.players[0].id && !l.moved)!
    const moves = listAllMoves(g, mover, g.movementRoll!)
    expect(moves.size).toBeGreaterThan(0)
    const dest = [...moves.keys()][0]
    g = dispatch(g, { type: 'move', legionId: mover.id, toHex: dest })
    expect(mover.id)
    const moved = g.legions.find((l) => l.id === mover.id)!
    expect(moved.hexLabel).toBe(dest)
    expect(moved.moved).toBe(true)
  })

  it('only allows muster for a legion that moved', () => {
    const v = loadVariantFromDisk()
    let g = createGame(v, {
      players: [
        { name: 'Alice', kind: 'human' },
        { name: 'Bob', kind: 'human' },
      ],
      seed: 1,
    })
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    // Starting stack is size 8 — must split before leaving Split phase
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    expect(g.phase).toBe('Move')

    const stuck = dispatch(g, { type: 'doneMove' })
    expect(stuck.phase).toBe('Move')
    expect(stuck.message).toMatch(/must move/i)

    const movers = g.legions.filter((l) => l.playerId === g.players[0].id && !l.moved)
    let mover = movers[0]
    let dest: string | null = null
    for (const leg of movers) {
      const moves = listAllMoves(g, leg, g.movementRoll!)
      for (const label of moves.keys()) {
        const phantom = { ...leg, hexLabel: label, moved: true, recruited: false }
        if (listRecruits(g, phantom).length > 0) {
          mover = leg
          dest = label
          break
        }
      }
      if (dest) break
    }
    expect(dest).toBeTruthy()
    g = dispatch(g, { type: 'move', legionId: mover.id, toHex: dest! })
    g = dispatch(g, { type: 'doneMove' })
    expect(g.phase).toBe('Muster')

    const movedLeg = g.legions.find((l) => l.id === mover.id)!
    expect(movedLeg.moved).toBe(true)
    const recruits = getLegalRecruits(g, movedLeg.id)
    expect(recruits.length).toBeGreaterThan(0)

    const unmoved = g.legions.find(
      (l) => l.playerId === g.players[0].id && l.id !== mover.id,
    )!
    expect(getLegalRecruits(g, unmoved.id)).toEqual([])
  })
})

describe('buildBoard', () => {
  it('is deterministic', () => {
    const raw = JSON.parse(
      readFileSync(resolve(here, '../../../public/variants/Default/variant.json'), 'utf8'),
    ) as VariantData
    const a = buildBoard(raw)
    const b = buildBoard(raw)
    expect(a.boardParity).toBe(b.boardParity)
    expect(a.towers).toEqual(b.towers)
  })
})
