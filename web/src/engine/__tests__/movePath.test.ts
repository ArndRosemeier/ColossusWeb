import { describe, expect, it } from 'vitest'
import { dispatch } from '../GameEngine'
import { listAllMoves, listNormalMoveHexes } from '../movement'
import { findMasterMovePath, isMasterTeleport, masterMovePathInfo } from '../movePath'
import { twoPlayerGame, turn1SplitChild } from './helpers'
import type { GameState } from '../types'

function splitAndRoll(seed: number): GameState {
  let g = twoPlayerGame(seed)
  const parent = g.legions.find((l) => l.playerId === g.players[0].id)!
  g = dispatch(g, {
    type: 'split',
    parentId: parent.id,
    childCreatures: turn1SplitChild(g, parent),
  })
  g = dispatch(g, { type: 'doneSplit' })
  return g
}

describe('movePath', () => {
  it('reconstructs a walk path for every legal normal destination', () => {
    const g = splitAndRoll(42)
    const mover = g.legions.find((l) => l.playerId === g.players[0].id && !l.moved)!
    const roll = g.movementRoll!
    const normal = listNormalMoveHexes(g, mover, roll)
    expect(normal.size).toBeGreaterThan(0)
    for (const dest of normal.keys()) {
      const path = findMasterMovePath(g, mover, roll, dest)
      expect(path, `path to ${dest}`).not.toBeNull()
      expect(path![0]).toBe(mover.hexLabel)
      expect(path![path!.length - 1]).toBe(dest)
      // Exact-roll walks have roll+1 labels; engagement stops may be shorter
      expect(path!.length - 1).toBeLessThanOrEqual(roll)
      expect(path!.length - 1).toBeGreaterThanOrEqual(1)
    }
  })

  it('marks tower teleports without inventing a walk path', () => {
    // Seed until we get a roll that allows teleport from a tower
    let found = false
    for (let seed = 1; seed < 80 && !found; seed++) {
      const g = splitAndRoll(seed)
      const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
      const roll = g.movementRoll!
      const all = listAllMoves(g, mover, roll)
      for (const [dest, info] of all) {
        if (!info.teleport) continue
        found = true
        expect(isMasterTeleport(g, mover, roll, dest)).toBe(true)
        const pathInfo = masterMovePathInfo(g, mover, roll, dest, true)
        expect(pathInfo.teleport).toBe(true)
        expect(pathInfo.path).toEqual([mover.hexLabel, dest])
        break
      }
    }
    expect(found).toBe(true)
  })

  it('reconstructs a full circular path for spin-cycle destinations', () => {
    let g = twoPlayerGame(7)
    const mover = g.legions.find((l) => l.playerId === g.players[0].id)!
    g.legions = g.legions.filter((l) => l.id === mover.id)
    const roll = 6
    let spinHex: string | null = null
    for (const label of Object.keys(g.variant.board.hexByLabel)) {
      mover.hexLabel = label
      mover.moved = false
      if (listNormalMoveHexes(g, mover, roll).has(label)) {
        spinHex = label
        break
      }
    }
    expect(spinHex).not.toBeNull()
    mover.hexLabel = spinHex!
    const path = findMasterMovePath(g, mover, roll, spinHex!)
    expect(path).not.toBeNull()
    expect(path![0]).toBe(spinHex)
    expect(path![path!.length - 1]).toBe(spinHex)
    expect(path!.length - 1).toBe(roll)
    // Must actually leave and return — not a degenerate single-hex path
    expect(path!.length).toBeGreaterThan(2)
    expect(new Set(path!).size).toBeGreaterThan(1)
  })
})
