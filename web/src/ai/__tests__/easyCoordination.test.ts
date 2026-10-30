import { describe, expect, it } from 'vitest'
import { dispatch } from '../../engine/GameEngine'
import { twoPlayerGame } from '../../engine/__tests__/helpers'
import { listAllMoves } from '../../engine/movement'
import type { GameState, Legion } from '../../engine/types'
import { AI_PROFILES } from '../profiles'
import { AI_DIFFICULTY_CHOICES } from '../difficulty'
import { pickAiCommand } from '../simpleAi'
import { pickBestMove, rankMoves } from '../evaluateMove'
import { incomingThreatScore } from '../boardSpatial'
import { estimateBattleOutcome } from '../battleEstimate'
import { searchMasterMoves } from '../masterLookahead'

function extraLegion(state: GameState, original: Legion, id: string, hexLabel: string, types: string[], moved: boolean): Legion {
  const owner = state.players.find(player => player.id === original.playerId)!
  return { ...original, id, markerId: owner.markersAvailable.shift()!, hexLabel, moveOriginHex: hexLabel,
    creatures: types.map(type => ({ type, hits: 0 })), knownPublic: types, moved, splitParentId: null, splitThisTurn: false }
}

describe('Easy uses simpler legion coordination with shared safety', () => {
  it.each(Object.values(AI_PROFILES))('keeps Easy quiet coordination and Normal/Hard ordinary growth when later optional depth exhausts for $id', profile => {
    for (const level of AI_DIFFICULTY_CHOICES) {
      const state = twoPlayerGame(71), moved = state.legions[0]
      state.turnNumber = 3; state.phase = 'Move'; state.movementRoll = 3
      state.players[0].kind = 'ai'; state.players[0].aiProfileId = profile.id; state.players[0].aiDifficultyId = level.id
      moved.moved = true; moved.creatures = ['Titan', 'Angel', 'Centaur', 'Centaur'].map(type => ({ type, hits: 0 }))
      const useful = extraLegion(state, moved, 'useful', '1', ['Centaur', 'Centaur'], false)
      state.legions = [moved, useful]
      const ranked = rankMoves(state, profile)
      expect(ranked[0].score).toBeGreaterThan(0)
      const before = JSON.stringify(state), command = pickAiCommand(state, () => 0)!
      expect(JSON.stringify(state)).toBe(before)
      const next = dispatch(state, command, () => 0)
      if (level.id === 'easy') {
        expect(command).toEqual({ type: 'doneMove' }); expect(next.phase).not.toBe('Move')
        expect(next.legions.find(legion => legion.id === useful.id)!.moved).toBe(false)
      } else if (level.id === 'normal') {
        expect(command).toMatchObject({ type: 'move', legionId: useful.id })
        expect(next.legions.find(legion => legion.id === useful.id)!.moved).toBe(true)
      } else {
        // Later optional work can exhaust after the actual control and HOLD
        // finish. Retained complete proof finds no better action here.
        const ordinary = pickBestMove(state, profile, () => 0, true, new Set(), { masterLookahead: false })
        expect(ordinary).toMatchObject({ type: 'move', legionId: useful.id })
        const control = ranked.find(move => ordinary.type === 'move' && move.legionId === ordinary.legionId && move.hex === ordinary.toHex)!
        const proof = searchMasterMoves(state, [control, ...ranked.filter(move => move !== control)], profile,
          { compareHold: true, holdLegionId: useful.id, stopAfterHoldImprovement: true })
        expect(proof.diagnostics.exhausted).toBe(true)
        expect(proof.diagnostics.controlComplete).toBe(true)
        expect(proof.control?.command).toEqual(ordinary)
        expect(proof.best!.move).toBe(control)
        expect(proof.best!.expectedArmyQuality).toBe(proof.control!.expectedArmyQuality)
        expect(proof.control!.expectedArmyQuality).toBeCloseTo(155.77292534722218, 8)
        expect(proof.bestHold!.expectedArmyQuality).toBeCloseTo(150.80463107638886, 8)
        expect(command).toEqual(ordinary)
        expect(next.legions.find(legion => legion.id === useful.id)!.moved).toBe(true)
      }
    }
  })
  it.each(Object.values(AI_PROFILES))('Hard still coordinates a genuinely productive second legion for $id', profile => {
    const state = twoPlayerGame(71), moved = state.legions[0]
    state.turnNumber = 3; state.phase = 'Move'; state.movementRoll = 3
    state.players[0].kind = 'ai'; state.players[0].aiProfileId = profile.id; state.players[0].aiDifficultyId = 'hard'
    moved.hexLabel = '200'; moved.moveOriginHex = '200'; moved.moved = true
    moved.creatures = ['Titan', 'Angel', 'Centaur', 'Centaur'].map(type => ({ type, hits: 0 }))
    const useful = extraLegion(state, moved, 'useful', '100', ['Cyclops', 'Cyclops', 'Cyclops'], false)
    state.legions = [moved, useful]
    const command = pickAiCommand(state, () => 0)!
    expect(command).toMatchObject({ type: 'move', legionId: useful.id, toHex: '5' })
    const next = dispatch(state, command)
    expect(next.legions.find(legion => legion.id === useful.id)!.moved).toBe(true)
  })
  it.each(Object.values(AI_PROFILES))('still rescues a threatened unmoved Titan after another move for $id at every level', profile => {
    for (const level of AI_DIFFICULTY_CHOICES) {
      const state = twoPlayerGame(71), titan = state.legions[0], enemy = state.legions[1]
      state.turnNumber = 3; state.phase = 'Move'; state.movementRoll = 6
      state.players[0].kind = 'ai'; state.players[0].aiProfileId = profile.id; state.players[0].aiDifficultyId = level.id
      titan.hexLabel = '1'; titan.moveOriginHex = '1'; titan.creatures = ['Titan', 'Cyclops', 'Cyclops', 'Cyclops', 'Ogre', 'Ogre', 'Centaur'].map(type => ({ type, hits: 0 }))
      enemy.hexLabel = '1000'; enemy.creatures = Array.from({ length: 7 }, () => ({ type: 'Hydra', hits: 0 }))
      state.legions.push(extraLegion(state, titan, 'moved-escort', '4000', ['Centaur', 'Centaur'], true))
      const threat = incomingThreatScore(state, titan, titan.hexLabel)
      expect(threat).toBeGreaterThan(0); expect(listAllMoves(state, titan, 6).size).toBeGreaterThan(0)
      const command = pickAiCommand(state, () => 0)!
      expect(command).toMatchObject({ type: 'move', legionId: titan.id })
      const next = dispatch(state, command, () => 0), rescued = next.legions.find(legion => legion.id === titan.id)!
      expect(rescued.moved).toBe(true)
      expect(incomingThreatScore(next, rescued, rescued.hexLabel)).toBeLessThan(threat)
    }
  })
  it.each(Object.values(AI_PROFILES))('never stops a forced split separation after another move for $id', profile => {
    const initial = twoPlayerGame(2)
    initial.players[0].kind = 'ai'; initial.players[0].aiProfileId = profile.id; initial.players[0].aiDifficultyId = 'easy'
    let next = dispatch(dispatch(initial, pickAiCommand(initial, () => 0.5)!), { type: 'doneSplit' }, () => (3 - 0.5) / 6)
    const pieces = next.legions.filter(legion => legion.playerId === next.players[0].id)
    next.legions.push(extraLegion(next, pieces[0], 'moved-escort', '4000', ['Centaur', 'Centaur'], true))
    expect(pieces[0].hexLabel).toBe(pieces[1].hexLabel)
    const command = pickAiCommand(next, () => 0.5)!
    expect(command.type).toBe('move')
    next = dispatch(next, command, () => 0)
    for (let step = 0; step < 4 && next.phase === 'Move'; step++) next = dispatch(next, pickAiCommand(next, () => 0.5)!, () => 0)
    expect(next.phase).not.toBe('Move')
    expect(next.legions.find(legion => legion.id === pieces[0].id)!.hexLabel).not.toBe(next.legions.find(legion => legion.id === pieces[1].id)!.hexLabel)
  })
  it.each(Object.values(AI_PROFILES))('does not unlock unrelated optional moves for a trapped Titan for $id', profile => {
    for (const level of AI_DIFFICULTY_CHOICES) {
      const state = twoPlayerGame(71), titan = state.legions[0], enemy = state.legions[1]
      state.turnNumber = 3; state.phase = 'Move'; state.movementRoll = 6
      state.players[0].kind = 'ai'; state.players[0].aiProfileId = profile.id; state.players[0].aiDifficultyId = level.id
      titan.hexLabel = '1'; titan.moveOriginHex = '1'; titan.creatures = ['Titan', 'Cyclops', 'Cyclops', 'Cyclops', 'Ogre', 'Ogre', 'Centaur'].map(type => ({ type, hits: 0 }))
      enemy.hexLabel = '1000'; enemy.creatures = Array.from({ length: 7 }, () => ({ type: 'Hydra', hits: 0 }))
      state.legions.push({ ...enemy, id: 'blocking-enemy', markerId: 'Bu02', hexLabel: '7' })
      state.legions.push(extraLegion(state, titan, 'moved-escort', '4000', ['Centaur', 'Centaur'], true))
      const productive = extraLegion(state, titan, 'productive', '200', ['Centaur', 'Centaur'], false)
      state.legions.push(productive)
      expect(incomingThreatScore(state, titan, titan.hexLabel)).toBeGreaterThan(0)
      const exits = [...listAllMoves(state, titan, 6).keys()]
      expect(exits.length).toBeGreaterThan(0)
      for (const hex of exits) {
        const blocker = state.legions.find(legion => legion.playerId !== titan.playerId && legion.hexLabel === hex)!
        expect(blocker).toBeDefined()
        expect(estimateBattleOutcome(state, titan, blocker, hex).ratio).toBeLessThan(1.3)
      }
      expect(rankMoves(state, profile)[0].score).toBeGreaterThan(0)
      const command = pickAiCommand(state, () => 0)!
      const next = dispatch(state, command, () => 0)
      if (level.id === 'easy') {
        expect(command).toEqual({ type: 'doneMove' }); expect(next.phase).not.toBe('Move')
        expect(next.legions.find(legion => legion.id === productive.id)!.moved).toBe(false)
      } else {
        expect(command).toMatchObject({ type: 'move', legionId: productive.id })
      }
    }
  })
})
