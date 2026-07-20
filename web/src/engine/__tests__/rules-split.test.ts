import { describe, expect, it } from 'vitest'
import { eliminateLegionToCaretaker } from '../engagement'
import { dispatch } from '../GameEngine'
import { turn1SplitChild, twoPlayerGame } from './helpers'

describe('rules-split', () => {
  it('P1: cannot split outside Split phase', () => {
    let g = twoPlayerGame(5)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'doneSplit' })
    expect(g.phase).toBe('Move')
    const still = g.legions.find((l) => l.playerId === g.players[0].id)!
    const bad = dispatch(g, {
      type: 'split',
      parentId: still.id,
      childCreatures: ['Ogre', 'Ogre'],
    })
    expect(bad.message).toMatch(/Not split phase/i)
    expect(bad.legions.filter((l) => l.playerId === g.players[0].id)).toHaveLength(
      g.legions.filter((l) => l.playerId === g.players[0].id).length,
    )
  })

  it('P3: child and parent must each keep at least 2 creatures', () => {
    const g = twoPlayerGame(5)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    const tooSmall = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: ['Centaur'],
    })
    expect(tooSmall.message).toMatch(/Turn 1 split must be 4 and 4|at least 2/i)
    expect(tooSmall.legions).toHaveLength(g.legions.length)

    const tooBig = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: [
        'Centaur',
        'Centaur',
        'Ogre',
        'Ogre',
        'Gargoyle',
        'Gargoyle',
        'Angel',
      ],
    })
    expect(tooBig.message).toMatch(/Turn 1 split must be 4 and 4|at least 2/i)
  })

  it('P3: cannot leave Split with a legion taller than 7', () => {
    const g = twoPlayerGame(5)
    const stuck = dispatch(g, { type: 'doneSplit' })
    expect(stuck.phase).toBe('Split')
    expect(stuck.message).toMatch(/taller than 7/i)
  })

  it('warns when Done is pressed while a size-7 legion has not split yet', () => {
    let g = twoPlayerGame(5)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g.turnNumber = 3
    g.phase = 'Split'
    for (const l of g.legions) l.splitThisTurn = false
    const fat = g.legions.find((l) => l.playerId === g.players[0].id)!
    fat.creatures.push(
      { type: 'Lion', hits: 0 },
      { type: 'Lion', hits: 0 },
      { type: 'Lion', hits: 0 },
    )
    expect(fat.creatures.length).toBe(7)

    const warned = dispatch(g, { type: 'doneSplit' })
    expect(warned.phase).toBe('Split')
    expect(warned.splitSkipWarned).toBe(true)
    expect(warned.message).toMatch(/has not split/i)

    const skipped = dispatch(warned, { type: 'doneSplit' })
    expect(skipped.phase).toBe('Move')
  })

  it('does not warn about a size-7 legion that already split this phase', () => {
    let g = twoPlayerGame(5)
    const opening = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: opening.id,
      childCreatures: turn1SplitChild(g, opening),
    })
    g.turnNumber = 3
    g.phase = 'Split'
    for (const l of g.legions) l.splitThisTurn = false

    const fat = g.legions.find((l) => l.playerId === g.players[0].id)!
    fat.creatures.push(
      { type: 'Lion', hits: 0 },
      { type: 'Lion', hits: 0 },
      { type: 'Lion', hits: 0 },
      { type: 'Lion', hits: 0 },
      { type: 'Lion', hits: 0 },
    )
    expect(fat.creatures.length).toBe(9)
    g = dispatch(g, {
      type: 'split',
      parentId: fat.id,
      childCreatures: ['Lion', 'Lion'],
    })
    const parentAfter = g.legions.find((l) => l.id === fat.id)!
    expect(parentAfter.creatures.length).toBe(7)
    expect(parentAfter.splitThisTurn).toBe(true)

    const done = dispatch(g, { type: 'doneSplit' })
    expect(done.phase).toBe('Move')
    expect(done.splitSkipWarned).toBe(false)
  })

  it('P2: turn 1 requires a single 4:4 split with one Lord each', () => {
    let g = twoPlayerGame(5)
    expect(g.turnNumber).toBe(1)
    expect(g.phase).toBe('Split')
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    expect(parent.creatures.length).toBe(8)

    const uneven = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: ['Centaur', 'Ogre'],
    })
    expect(uneven.message).toMatch(/4 and 4/i)
    expect(uneven.legions).toHaveLength(g.legions.length)

    const noLord = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: ['Centaur', 'Centaur', 'Ogre', 'Ogre'],
    })
    expect(noLord.message).toMatch(/one Lord/i)

    const twoLords = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: ['Titan', 'Angel', 'Centaur', 'Ogre'],
    })
    expect(twoLords.message).toMatch(/one Lord/i)

    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    const mine = g.legions.filter((l) => l.playerId === g.players[0].id)
    expect(mine).toHaveLength(2)
    expect(mine.every((l) => l.creatures.length === 4)).toBe(true)
    expect(
      mine.every(
        (l) => l.creatures.filter((c) => g.variant.creatures[c.type]?.lord).length === 1,
      ),
    ).toBe(true)

    const second = dispatch(g, {
      type: 'split',
      parentId: mine[0].id,
      childCreatures: ['Centaur', 'Ogre'],
    })
    expect(second.message).toMatch(/Cannot split twice on turn 1/i)
  })

  it('enforces 12 markers per color — 13th split fails and elimination returns a marker', () => {
    let g = twoPlayerGame(7)
    const alice = g.players[0]!
    expect(alice.markersAvailable).toHaveLength(11) // starting legion took one
    expect(g.legions[0]!.markerId).toMatch(/01$/)

    const template = g.legions.find((l) => l.playerId === alice.id)!
    for (let i = 0; i < 11; i++) {
      const marker = alice.markersAvailable.shift()!
      g.legions.push({
        id: `leg-extra-${i}`,
        markerId: marker,
        playerId: alice.id,
        hexLabel: template.hexLabel,
        creatures: [
          { type: 'Ogre', hits: 0 },
          { type: 'Ogre', hits: 0 },
          { type: 'Centaur', hits: 0 },
          { type: 'Centaur', hits: 0 },
        ],
        moved: false,
        teleported: false,
        recruited: false,
        musteredThisTurn: null,
        splitThisTurn: false,
        splitParentId: null,
        moveOriginHex: null,
        enteredFrom: null,
        knownPublic: [],
      })
    }
    expect(alice.markersAvailable).toHaveLength(0)
    expect(g.legions.filter((l) => l.playerId === alice.id)).toHaveLength(12)

    g.phase = 'Split'
    g.turnNumber = 3
    const fat = g.legions.find((l) => l.playerId === alice.id)!
    fat.creatures.push({ type: 'Gargoyle', hits: 0 }, { type: 'Gargoyle', hits: 0 })
    const blocked = dispatch(g, {
      type: 'split',
      parentId: fat.id,
      childCreatures: ['Ogre', 'Ogre'],
    })
    expect(blocked.message).toMatch(/No legion markers available|maximum 12/i)
    expect(blocked.legions.filter((l) => l.playerId === alice.id)).toHaveLength(12)

    const victim = g.legions.find((l) => l.playerId === alice.id && l.id !== fat.id)!
    const returnedMarker = victim.markerId
    eliminateLegionToCaretaker(g, victim)
    expect(alice.markersAvailable).toContain(returnedMarker)

    const after = dispatch(g, {
      type: 'split',
      parentId: fat.id,
      childCreatures: ['Ogre', 'Ogre'],
    })
    expect(after.message).not.toMatch(/No legion markers/i)
    expect(after.legions.filter((l) => l.playerId === alice.id)).toHaveLength(12)
    expect(after.players[0]!.markersAvailable).toHaveLength(0)
  })

  it('undoSplit recombines child into parent and returns the marker', () => {
    let g = twoPlayerGame(5)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    const parentId = parent.id
    const beforeMarkers = g.players[0]!.markersAvailable.length
    g = dispatch(g, {
      type: 'split',
      parentId,
      childCreatures: turn1SplitChild(g, parent),
    })
    expect(g.legions.filter((l) => l.playerId === g.players[0].id)).toHaveLength(2)
    const child = g.legions.find((l) => l.splitParentId === parentId)!
    expect(child).toBeTruthy()
    expect(g.players[0]!.markersAvailable.length).toBe(beforeMarkers - 1)

    g = dispatch(g, { type: 'undoSplit', childId: child.id })
    expect(g.phase).toBe('Split')
    const restored = g.legions.filter((l) => l.playerId === g.players[0].id)
    expect(restored).toHaveLength(1)
    expect(restored[0]!.id).toBe(parentId)
    expect(restored[0]!.creatures.length).toBe(8)
    expect(restored[0]!.splitThisTurn).toBe(false)
    expect(g.players[0]!.markersAvailable.length).toBe(beforeMarkers)
    expect(g.selectedLegionId).toBe(parentId)
  })

  it('undoSplit works when the parent is selected', () => {
    let g = twoPlayerGame(5)
    const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
    g = dispatch(g, {
      type: 'split',
      parentId: parent.id,
      childCreatures: turn1SplitChild(g, parent),
    })
    g = dispatch(g, { type: 'undoSplit', childId: parent.id })
    expect(g.legions.filter((l) => l.playerId === g.players[0].id)).toHaveLength(1)
  })
})
