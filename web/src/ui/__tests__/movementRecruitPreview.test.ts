import { describe, expect, it } from 'vitest'
import { movementRecruitPreview } from '../movementRecruitPreview'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { bestRecruit, bestRecruitAt, listRecruitOptionsAt } from '../../engine/recruit'
import type { CreatureType } from '../../types/variant'

function fixture() {
  const state = twoPlayerGame(31)
  const legion = state.legions[0]
  legion.creatures = [{ type: 'Cyclops', hits: 0 }, { type: 'Cyclops', hits: 0 }]
  const brush = Object.values(state.variant.board.hexByLabel).find(hex => hex.terrain === 'Brush')!.label
  return { state, legion, brush }
}

/** Use a real Brush graph/caretaker; modify only the two candidate stat records
 * for isolated ranking examples, never mock or duplicate recruit eligibility. */
function candidates(first: Partial<CreatureType>, second: Partial<CreatureType>) {
  const result = fixture()
  const { state, legion, brush } = result
  state.caretaker.Gargoyle = 0
  for (const [name, stats] of [['Cyclops', first], ['Gorgon', second]] as const) {
    state.variant.creatures[name] = { ...state.variant.creatures[name], power: 1, skill: 1, flies: false, rangestrikes: false, magicMissile: false, ...stats }
  }
  expect(listRecruitOptionsAt(state, legion, brush)).toEqual(['Cyclops', 'Gorgon'])
  return result
}

describe('movement destination recruit illustration ranking', () => {
  it('shows immediate Gorgon strength for two Cyclops in Brush without changing strategic current/destination muster', () => {
    const { state, legion, brush } = fixture()
    const before = JSON.stringify(state)
    expect(listRecruitOptionsAt(state, legion, brush)).toContain('Gorgon')
    expect(movementRecruitPreview(state, legion, brush)).toBe('Gorgon') // 6×3+fly+range =20; Cyclops9×2 =18
    expect(bestRecruitAt(state, legion, brush)).toBe('Cyclops')
    expect(JSON.stringify(state)).toBe(before)
    legion.hexLabel = brush; legion.moved = true
    expect(bestRecruit(state, legion)).toBe('Cyclops')
  })
  it('uses power times skill, so a higher skill alone cannot outrank greater adjusted strength', () => {
    const { state, legion, brush } = candidates({ power: 8, skill: 2 }, { power: 3, skill: 4 })
    expect(movementRecruitPreview(state, legion, brush)).toBe('Cyclops')
  })
  for (const ability of ['flies', 'rangestrikes'] as const) {
    it(`${ability} adds strength when base products tie`, () => {
      const { state, legion, brush } = candidates({ power: 6, skill: 2 }, { power: 6, skill: 2, [ability]: true })
      expect(movementRecruitPreview(state, legion, brush)).toBe('Gorgon')
    })
    it(`${ability} adds exactly one rather than two points`, () => {
      const { state, legion, brush } = candidates({ power: 4, skill: 3 }, { power: 2, skill: 5, [ability]: true })
      expect(movementRecruitPreview(state, legion, brush)).toBe('Cyclops') // 12 >11; a two-point bonus would tie and favor skill5
    })
  }
  it('counts flight and rangestrike independently for a combined two points, then compares skill', () => {
    const { state, legion, brush } = candidates({ power: 4, skill: 3 }, { power: 2, skill: 5, flies: true, rangestrikes: true })
    expect(movementRecruitPreview(state, legion, brush)).toBe('Gorgon')
  })
  it('prefers higher skill when adjusted scores tie', () => {
    const { state, legion, brush } = candidates({ power: 6, skill: 2 }, { power: 4, skill: 3 })
    expect(movementRecruitPreview(state, legion, brush)).toBe('Gorgon')
  })
  it('preserves first legal-provider order when both score and skill tie', () => {
    const { state, legion, brush } = candidates({ power: 6, skill: 2 }, { power: 6, skill: 2 })
    expect(movementRecruitPreview(state, legion, brush)).toBe('Cyclops')
  })
  it('does not award a separate magic-missile bonus', () => {
    const { state, legion, brush } = candidates({ power: 3, skill: 4 }, { power: 4, skill: 3, magicMissile: true })
    expect(movementRecruitPreview(state, legion, brush)).toBe('Cyclops')
  })
  it('uses actual caretaker availability and returns null for no eligible, available or capacity-safe option', () => {
    const { state, legion, brush } = fixture()
    state.caretaker.Gorgon = 0
    expect(listRecruitOptionsAt(state, legion, brush)).not.toContain('Gorgon')
    expect(movementRecruitPreview(state, legion, brush)).toBe('Cyclops')
    state.caretaker.Cyclops = 0; state.caretaker.Gargoyle = 0
    expect(listRecruitOptionsAt(state, legion, brush)).toEqual([])
    expect(movementRecruitPreview(state, legion, brush)).toBeNull()
    const ineligible = fixture()
    ineligible.legion.creatures = [{ type: 'Ogre', hits: 0 }]
    expect(listRecruitOptionsAt(ineligible.state, ineligible.legion, ineligible.brush)).toEqual([])
    expect(movementRecruitPreview(ineligible.state, ineligible.legion, ineligible.brush)).toBeNull()
    const full = fixture()
    full.legion.creatures = Array.from({ length: 7 }, () => ({ type: 'Cyclops', hits: 0 }))
    expect(listRecruitOptionsAt(full.state, full.legion, full.brush)).toEqual([])
    expect(movementRecruitPreview(full.state, full.legion, full.brush)).toBeNull()
  })
  it('keeps the legal provider destination-preview semantics even when the source legion has not moved or previously recruited', () => {
    const { state, legion, brush } = fixture()
    legion.moved = false; legion.recruited = true
    expect(listRecruitOptionsAt(state, legion, brush)).toContain('Gorgon')
    expect(movementRecruitPreview(state, legion, brush)).toBe('Gorgon')
  })
  it.each(['missing', 'power', 'skill', 'flies', 'rangestrikes'] as const)('rejects invalid candidate %s metadata loudly', invalid => {
    const { state, legion, brush } = fixture()
    if (invalid === 'missing') delete state.variant.creatures.Gorgon
    else if (invalid === 'power' || invalid === 'skill') state.variant.creatures.Gorgon[invalid] = NaN
    else state.variant.creatures.Gorgon[invalid] = undefined as unknown as boolean
    expect(() => movementRecruitPreview(state, legion, brush)).toThrow('Invalid movement recruit preview data for Gorgon')
  })
})
