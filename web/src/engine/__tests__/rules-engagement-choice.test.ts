/**
 * S8 — the defender's pre-battle window (the owner's live bug).
 *
 * The rule, from `docs/rules/Titan-Engagements.html` (authority order in
 * `docs/rules/README.md`: Colossus Java → official Titan rules → noted MVP
 * simplifications):
 *
 *   "The defender may immediately opt to Flee. If the defender flees, his
 *    characters are automatically eliminated and the attacker wins with no
 *    losses. The attacker receives only half the total value ... The attacker
 *    cannot flee and a defending Legion containing a Lord cannot flee."
 *   "If the defender SUGGESTS an agreement or accepts Battle, he may not then
 *    flee."
 *   "Except when the defender wishes to flee, either player may demand that the
 *    Battle be played out."
 *
 * So the ORDER is: defender's flee window → (either player demands battle) →
 * battle. It is NOT the attacker's single command. Colossus encodes the same
 * order at `Colossus/core/src/main/java/net/sf/colossus/server/GameServerSide.java`:
 * `:2719-2728` asks the defender (`server.askFlee`) or goes straight on when the
 * legion cannot flee; `:2747-2754` `doNotFlee` → `engage2`; `:2792-2805` →
 * `engage3` negotiation; `:2866-2893` `fight()` is only reachable after that.
 *
 * WHAT WENT WRONG (the defect this file pins): `proposeAgreement{kind:'fight'}`
 * called `startBattleFromEngagement` directly, so the attacker's one click
 * skipped the defender's window entirely. In hotseat one person holds both sides
 * and nothing looked wrong; in a two-browser game it stole the defender's
 * decision and the log ran straight from `Engagement` to `Battle`.
 */
import { describe, expect, it } from 'vitest'
import { canFlee } from '../engagement'
import { dispatch } from '../GameEngine'
import type { GameState, Legion } from '../types'
import { twoPlayerGame } from './helpers'

/** A revealed, pending engagement between two HUMAN players, defender able to flee. */
function humanEngagement(seed = 61): { state: GameState; attacker: Legion; defender: Legion } {
  const state = twoPlayerGame(seed)
  const attacker = state.legions[0]!
  const defender = state.legions[1]!
  // No Lords on the defender, so Flee is a real option (Titan: a Lord blocks it).
  defender.creatures = [
    { type: 'Centaur', hits: 0 },
    { type: 'Ogre', hits: 0 },
  ]
  defender.knownPublic = ['Centaur', 'Ogre']
  attacker.hexLabel = defender.hexLabel
  state.phase = 'Fight'
  state.pendingEngagements = [{ attackerId: attacker.id, defenderId: defender.id }]
  const opened = dispatch(state, {
    type: 'startEngagement',
    attackerId: attacker.id,
    defenderId: defender.id,
  })
  return { state: opened, attacker, defender }
}

function points(state: GameState, legion: Legion, full: boolean): number {
  let total = 0
  for (const c of legion.creatures) {
    const t = state.variant.creatures[c.type]
    if (!t) continue
    const power =
      c.type === 'Titan'
        ? (state.players.find((p) => p.id === legion.playerId)?.titanPower ?? 6)
        : t.power
    total += full ? power * t.skill : Math.floor((power * t.skill) / 2)
  }
  return total
}

describe('S8 engagement choice — whose decision it is', () => {
  it('PIN 1: an engagement does NOT start a battle on the attacker command alone', () => {
    const { state } = humanEngagement()
    expect(state.phase).toBe('Fight')
    expect(state.activeEngagement).not.toBeNull()

    const after = dispatch(state, { type: 'proposeAgreement', kind: 'fight' })

    // The owner's bug: this used to be `Battle` with the engagement gone.
    expect(after.phase).toBe('Fight')
    expect(after.battle).toBeNull()
    expect(after.activeEngagement).not.toBeNull()
    expect(after.message).toMatch(/not answered flee or fight/i)
    // And the refusal is not a silent no-op: nothing moved, and the same state
    // still lets the defender answer.
    expect(after.log).toEqual(state.log)
    const answered = dispatch(after, { type: 'standFight' })
    expect(answered.activeEngagement?.fleeDeclined).toBe(true)
  })

  it('PIN 2: flee, concede and fight each produce their OWN outcome — battle only for fight', () => {
    // Flee: defender eliminated, HALF points to the attacker, no battle.
    const fleeArm = humanEngagement(62)
    const halfPts = points(fleeArm.state, fleeArm.defender, false)
    const atkBefore = fleeArm.state.players.find((p) => p.id === fleeArm.attacker.playerId)!.score
    const fled = dispatch(fleeArm.state, { type: 'flee' })
    expect(fled.phase).toBe('Fight')
    expect(fled.battle).toBeNull()
    expect(fled.activeEngagement).toBeNull()
    expect(fled.legions.some((l) => l.id === fleeArm.defender.id)).toBe(false)
    expect(fled.players.find((p) => p.id === fleeArm.attacker.playerId)!.score).toBe(
      atkBefore + halfPts,
    )

    // Concede: defender eliminated, FULL points to the attacker, no battle.
    const concedeArm = humanEngagement(63)
    const fullPts = points(concedeArm.state, concedeArm.defender, true)
    const atkBefore2 = concedeArm.state.players.find(
      (p) => p.id === concedeArm.attacker.playerId,
    )!.score
    const conceded = dispatch(concedeArm.state, {
      type: 'concedeEngagement',
      loserId: concedeArm.defender.id,
    })
    expect(conceded.battle).toBeNull()
    expect(conceded.activeEngagement).toBeNull()
    expect(conceded.legions.some((l) => l.id === concedeArm.defender.id)).toBe(false)
    expect(conceded.players.find((p) => p.id === concedeArm.attacker.playerId)!.score).toBe(
      atkBefore2 + fullPts,
    )
    expect(fullPts).toBeGreaterThan(halfPts)

    // Fight: the defender's stand closes the window, then the battle starts.
    const fightArm = humanEngagement(64)
    const stood = dispatch(fightArm.state, { type: 'standFight' })
    expect(stood.phase).toBe('Fight')
    expect(stood.battle).toBeNull()
    const fought = dispatch(stood, { type: 'proposeAgreement', kind: 'fight' })
    expect(fought.phase).toBe('Battle')
    expect(fought.battle).not.toBeNull()
    expect(fought.activeEngagement).toBeNull()
  })

  it('PIN 3: in a two-human game the state says the window is WAITING (fleeDeclined false)', () => {
    const { state, defender } = humanEngagement(65)
    expect(canFlee(state, defender)).toBe(true)
    expect(state.activeEngagement?.fleeDeclined).toBe(false)

    // The window closes exactly once.
    const stood = dispatch(state, { type: 'standFight' })
    expect(stood.activeEngagement?.fleeDeclined).toBe(true)
    const again = dispatch(stood, { type: 'standFight' })
    expect(again.message).toMatch(/already closed/i)

    // A defender that CANNOT flee (it holds a Lord) has no window to wait on at
    // all: the engagement opens already declined, so the battle may be demanded
    // at once (Titan: "a defending Legion containing a Lord cannot flee").
    const noFleeState = twoPlayerGame(66)
    const noFleeAttacker = noFleeState.legions[0]!
    const noFleeDefender = noFleeState.legions[1]!
    noFleeDefender.creatures = [
      { type: 'Angel', hits: 0 },
      { type: 'Ogre', hits: 0 },
    ]
    noFleeAttacker.hexLabel = noFleeDefender.hexLabel
    noFleeState.phase = 'Fight'
    noFleeState.pendingEngagements = [
      { attackerId: noFleeAttacker.id, defenderId: noFleeDefender.id },
    ]
    expect(canFlee(noFleeState, noFleeDefender)).toBe(false)
    const noFlee = dispatch(noFleeState, {
      type: 'startEngagement',
      attackerId: noFleeAttacker.id,
      defenderId: noFleeDefender.id,
    })
    expect(noFlee.activeEngagement?.fleeDeclined).toBe(true)
    const noFleeFought = dispatch(noFlee, { type: 'proposeAgreement', kind: 'fight' })
    expect(noFleeFought.phase).toBe('Battle')

    // The window's opening rule is the DEFENDER's ability to flee, not a
    // hardcoded `false`: a legion under a Lord opens DECLINED. If that were ever
    // "always false", this engagement could never start a battle at all.
    expect(noFlee.activeEngagement?.fleeDeclined).toBe(!canFlee(noFlee, noFleeDefender))
  })

  it('PIN 4: a hotseat two-human game can still complete an engagement in one sitting', () => {
    // Both seats are human and played by the SAME person (hotseat): the attacker
    // opens, the defender answers, the attacker proceeds — no deadlock.
    const { state, defender } = humanEngagement(67)
    let g = dispatch(state, { type: 'standFight' })
    expect(g.message).toMatch(/stands and fights/i)
    g = dispatch(g, { type: 'proposeAgreement', kind: 'fight' })
    expect(g.phase).toBe('Battle')
    expect(g.battle).not.toBeNull()

    // And the flee route also completes in one sitting.
    const fleeArm = humanEngagement(68)
    const fled = dispatch(fleeArm.state, { type: 'flee' })
    expect(fled.activeEngagement).toBeNull()
    expect(fled.legions.some((l) => l.id === defender.id)).toBe(false)

    // The AI defender path still resolves: an AI that declines to flee closes
    // its own window before any battle (simpleAi `standFight`).
    const aiArm = humanEngagement(69)
    const aiState = structuredClone(aiArm.state)
    aiState.players.find((p) => p.id === aiArm.defender.playerId)!.kind = 'ai'
    const aiStood = dispatch(aiState, { type: 'standFight' })
    const aiFought = dispatch(aiStood, { type: 'proposeAgreement', kind: 'fight' })
    expect(aiFought.phase).toBe('Battle')
  })
})
