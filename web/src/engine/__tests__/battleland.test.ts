import { describe, expect, it } from 'vitest'
import { buildBattleland, defenderEntryKey, VISIBLE_HEXES } from '../battleland'
import type { BattlelandDef } from '../../types/variant'

const emptyLand: BattlelandDef = {
  terrain: 'Plains',
  tower: false,
  subtitle: null,
  hexes: [],
  startlist: [],
}

describe('battleland geometry', () => {
  it('has 27 visible hexes forming a hexagon (Colossus VISIBLE_HEXES)', () => {
    let n = 0
    for (const col of VISIBLE_HEXES) for (const v of col) if (v) n += 1
    expect(n).toBe(27)
    const land = buildBattleland(emptyLand)
    expect(land.labels).toHaveLength(27)
  })

  it('attacker sides have 4 landing hexes; defender opposites have 3', () => {
    const land = buildBattleland(emptyLand)
    expect(land.entrances.Bottom).toHaveLength(4)
    expect(land.entrances.Left).toHaveLength(4)
    expect(land.entrances.Right).toHaveLength(4)
    expect(land.entrances.Top).toHaveLength(3)
    expect(land.entrances.LeftDefense).toHaveLength(3)
    expect(land.entrances.RightDefense).toHaveLength(3)
  })

  it('defenderEntryKey maps to the 3-hex opposing side', () => {
    expect(defenderEntryKey('Bottom')).toBe('Top')
    expect(defenderEntryKey('Left')).toBe('RightDefense')
    expect(defenderEntryKey('Right')).toBe('LeftDefense')
  })

  it('includes standard Colossus labels A1–A3 … F1–F4', () => {
    const land = buildBattleland(emptyLand)
    expect(land.hexByLabel.A1).toBeTruthy()
    expect(land.hexByLabel.A3).toBeTruthy()
    expect(land.hexByLabel.A4).toBeUndefined()
    expect(land.hexByLabel.D6).toBeTruthy()
    expect(land.hexByLabel.F4).toBeTruthy()
    expect(land.hexByLabel.F5).toBeUndefined()
  })
})
