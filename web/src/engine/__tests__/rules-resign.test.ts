/**
 * S9 part A — GIVE UP (resign), and WHAT THE RULES SAY IT DOES.
 *
 * ## The authority, and the evidence
 *
 * Titan has no "resign the game" rule text of its own: the written rules cover
 * leaving the game only through a Titan's death — *"Each player receives only one
 * Titan, and if it is lost the player is out of the game and all of his forces
 * are removed from play"* (`docs/rules/Titan-UltraBoardGames.html:525`) — and
 * through CONCEDING an Engagement, which is a different thing (it eliminates one
 * LEGION and awards the winner full value; `Titan-Engagements.html:23-25`). So the
 * authority for "a player gives up the whole game" is the Colossus Java server,
 * which the authority order puts FIRST when it intentionally differs
 * (`docs/rules/README.md:12-16`):
 *
 *  - `Colossus/core/src/main/java/net/sf/colossus/server/GameServerSide.java:1185-1218`
 *    `handlePlayerWithdrawal` — a player quits (or drops out) and is simply made
 *    dead: `((PlayerServerSide)player).die(slayer); checkForVictory();` and, when
 *    the game goes on, the turn is advanced if it was theirs. There is NO phase
 *    guard and NO second game-over notion.
 *  - `Colossus/core/src/main/java/net/sf/colossus/server/PlayerServerSide.java:606-661`
 *    `die(Player slayer)` — what leaving the board DOES: every legion of the
 *    player's is removed, and *"Engaged legions give half points to the player
 *    they're engaged with. All others give half points to slayer, if non-null."*
 *    The slayer is `null` for a withdrawal (`PlayerServerSide.java:609-610`: *"May
 *    be null if we just gave up or it is a draw"*), so an UNENGAGED leftover scores
 *    nobody, and `handleSlaying(null)` (`:645-656`) hands the resigner's markers to
 *    NOBODY — they stay with the dead player.
 *
 * ## What this port implements, and how it reuses the ONE ending
 *
 * `resign` removes the resigner's legions through the SAME `eliminatePlayer` body
 * that a Titan death uses, then calls the SAME `checkTitanDeath`, so "the game is
 * over" still has exactly ONE definition. The only difference is the REASON: the
 * `resigned` set tells the shared ending the Titan did not die, so the log does
 * not claim it did. Two players → one winner; three or more → the game goes on
 * (Java `checkForVictory`, `GameServerSide.java:1235-1275`).
 *
 * ## The owner's scope, which is narrower than Java's
 *
 * *"Anybody needs to have the option to give up the game (outside battles is
 * enough)"* — so a resignation INSIDE a battle is refused, loudly, instead of
 * being offered. Java has no such guard; this is the owner's own scope, and
 * refusing is the honest way to honour it (the in-battle equivalent already
 * exists as `concedeBattle`).
 */
import { describe, expect, it } from 'vitest'
import { canResign, createGame, dispatch, resignRefusalReason, takeMarker } from '../GameEngine'
import { isSharedCommand } from '../../net/sync'
import type { GameState, Legion, PendingDiceRoll, PlayerState } from '../types'
import { loadDefaultVariant, twoPlayerGame } from './helpers'

/** Three human players — the multi-player case Java keeps playing. */
function threePlayerGame(seed = 7): GameState {
  return createGame(loadDefaultVariant(), {
    players: [
      { name: 'Alice', kind: 'human' },
      { name: 'Bob', kind: 'human' },
      { name: 'Carol', kind: 'human' },
    ],
    seed,
  })
}

function playerOf(state: GameState, name: string): PlayerState {
  return state.players.find((p) => p.name === name)!
}

function legionsOf(state: GameState, player: PlayerState): Legion[] {
  return state.legions.filter((l) => l.playerId === player.id)
}

/** The engagement window, opened by the engine's own command. */
function pendingEngagement(seed = 61): GameState {
  const base = twoPlayerGame(seed)
  const attacker = base.legions[0]!
  const defender = base.legions[1]!
  // No Lords on the defender, so Flee is a real option (Titan: a Lord blocks it).
  defender.creatures = [
    { type: 'Centaur', hits: 0 },
    { type: 'Ogre', hits: 0 },
  ]
  defender.knownPublic = ['Centaur', 'Ogre']
  attacker.hexLabel = defender.hexLabel
  base.phase = 'Fight'
  base.pendingEngagements = [{ attackerId: attacker.id, defenderId: defender.id }]
  return base
}

describe('S9-A · giving up is a SHARED command that reuses the ONE elimination ending', () => {
  it('PIN 1: a player resigns OUTSIDE a battle and the game ends for two players', () => {
    const state = twoPlayerGame(11)
    const alice = playerOf(state, 'Alice')
    const bob = playerOf(state, 'Bob')
    // Both start in the Split phase with a legion — nothing battle-owned here.
    expect(state.phase).toBe('Split')
    expect(state.battle).toBeNull()
    expect(state.activeEngagement).toBeNull()

    const next = dispatch(state, { type: 'resign', playerId: alice.id })

    expect(playerOf(next, 'Alice').dead).toBe(true)
    expect(playerOf(next, 'Bob').dead).toBe(false)
    expect(next.winnerId).toBe(bob.id)
    expect(next.draw).toBe(false)
    expect(next.message).toContain('Bob')
    // Every legion of the resigner is off the board — the whole point of `die`.
    expect(legionsOf(next, playerOf(next, 'Alice'))).toHaveLength(0)
    expect(legionsOf(next, playerOf(next, 'Bob')).length).toBeGreaterThan(0)
    // The reason is stated: this player's Titan did NOT die.
    expect(next.log.some((l) => l.includes('Alice gives up the game'))).toBe(true)
    expect(next.log.some((l) => l.includes('gave up with the Titan still alive'))).toBe(true)
    expect(next.log.some((l) => l.includes('Titan slain'))).toBe(false)
  })

  it('PIN 2: with three players the game CONTINUES — the resigner leaves, the rest play on', () => {
    const state = threePlayerGame(7)
    const alice = playerOf(state, 'Alice')
    const bob = playerOf(state, 'Bob')

    const next = dispatch(state, { type: 'resign', playerId: alice.id })

    expect(playerOf(next, 'Alice').dead).toBe(true)
    expect(next.winnerId).toBeNull()
    expect(next.draw).toBe(false)
    expect(legionsOf(next, playerOf(next, 'Alice'))).toHaveLength(0)
    // A real turn still exists for a living player, and the game is playable.
    expect(bob.dead).toBe(false)
    expect(next.phase).not.toBe('Battle')
    expect(next.message).toContain('given up')
    // The resigner WAS the active player (seat 0): the turn moves on rather than
    // stalling on a dead seat (`GameServerSide.java:1207-1213`).
    expect(next.players[next.activePlayerIndex]!.dead).toBe(false)
  })

  it('PIN 3: giving up is REFUSED inside a battle, loudly, and changes NOTHING', () => {
    const base = pendingEngagement(61)
    const attacker = base.legions[0]!
    const defender = base.legions[1]!
    const engaged = dispatch(base, {
      type: 'startEngagement',
      attackerId: attacker.id,
      defenderId: defender.id,
    })
    const standing = dispatch(engaged, { type: 'standFight' })
    const battle = dispatch(standing, {
      type: 'startEngagement',
      attackerId: attacker.id,
      defenderId: defender.id,
    })
    expect(battle.battle).not.toBeNull()

    const alice = playerOf(battle, 'Alice')
    expect(canResign(battle, alice.id)).toBe(false)
    expect(resignRefusalReason(battle, alice.id)).toMatch(/during a battle/i)

    const after = dispatch(battle, { type: 'resign', playerId: alice.id })
    // LOUD, on the ONE message surface, and NO game change.
    expect(after.message).toMatch(/during a battle/i)
    expect(playerOf(after, 'Alice').dead).toBe(false)
    expect(after.winnerId).toBeNull()
    expect(after.battle).not.toBeNull()
    expect(after.log.some((l) => l.includes('gives up the game'))).toBe(false)
  })

  it('PIN 4: giving up is REFUSED while an engagement is on the table, and while a throw is pending', () => {
    const base = pendingEngagement(61)
    const attacker = base.legions[0]!
    const defender = base.legions[1]!
    const opened = dispatch(base, {
      type: 'startEngagement',
      attackerId: attacker.id,
      defenderId: defender.id,
    })
    expect(opened.activeEngagement).not.toBeNull()
    const alice = playerOf(opened, 'Alice')
    expect(canResign(opened, alice.id)).toBe(false)

    const after = dispatch(opened, { type: 'resign', playerId: alice.id })
    expect(after.message).toMatch(/engagement/i)
    expect(after.activeEngagement).not.toBeNull()
    expect(playerOf(after, 'Alice').dead).toBe(false)

    // A pending physical throw is battle-owned state too: the refusal names it.
    const pending: PendingDiceRoll = {
      id: 'd1',
      context: 'movement',
      dieCount: 1,
      playerId: alice.id,
      label: 'Movement',
    }
    const throwing: GameState = { ...base, pendingDice: pending }
    expect(canResign(throwing, alice.id)).toBe(false)
    expect(resignRefusalReason(throwing, alice.id)).toMatch(/throw|dice/i)
  })

  it('PIN 5: an ENGAGED leftover legion scores its enemy HALF — and only the ENGAGED one', () => {
    const base = twoPlayerGame(11)
    const alice = playerOf(base, 'Alice')
    const bob = playerOf(base, 'Bob')
    // Alice has TWO legions: her starting 8-high stack at her tower, and a plain
    // one standing on Bob's hex — an engagement with no battle running. (Built by
    // hand rather than through `split` so the arithmetic is the variant's own and
    // carries no Titan's variable power.)
    const state = structuredClone(base)
    const aliceLegion = state.legions.find((l) => l.playerId === alice.id)!
    const bobLegion = state.legions.find((l) => l.playerId === bob.id)!
    const engaged: Legion = {
      ...structuredClone(aliceLegion),
      id: 'leg-extra',
      markerId: takeMarker(playerOf(state, 'Alice')),
      hexLabel: bobLegion.hexLabel,
      creatures: [
        { type: 'Centaur', hits: 0 },
        { type: 'Ogre', hits: 0 },
      ],
      knownPublic: ['Centaur', 'Ogre'],
    }
    state.legions.push(engaged)
    expect(state.battle).toBeNull()
    expect(state.legions.filter((l) => l.playerId === alice.id)).toHaveLength(2)

    // Half points per creature, floored as summed — `PlayerServerSide.die`'s own
    // arithmetic: Centaur 4×3/2 = 6, Ogre 6×2/2 = 6.
    const bobScoreBefore = playerOf(state, 'Bob').score
    const next = dispatch(state, { type: 'resign', playerId: alice.id })

    // Colossus `die`: engaged legions give half points to the player they are
    // engaged with. A withdrawal's slayer is null, so the UNENGAGED 8-high stack
    // gives Bob NOTHING — only the engaged legion scores.
    expect(playerOf(next, 'Bob').score).toBe(bobScoreBefore + 12)
    expect(
      next.log.some((l) => l.includes(`half-points for Alice's ${engaged.markerId}`)),
    ).toBe(true)
    expect(next.log.some((l) => l.includes(`half-points for Alice's ${aliceLegion.markerId}`))).toBe(
      false,
    )
  })

  it('PIN 6: an UNENGAGED leftover scores NOBODY (the withdrawal slayer is null)', () => {
    const state = threePlayerGame(7)
    const alice = playerOf(state, 'Alice')
    // Alice's legion is on an empty hex: no enemy to engage, no slayer to score.
    const aliceLegion = legionsOf(state, alice)[0]!
    const occupied = new Set(
      state.players.filter((p) => p.id !== alice.id).map((p) => legionsOf(state, p)[0]!.hexLabel),
    )
    expect(occupied.has(aliceLegion.hexLabel)).toBe(false)

    const scoresBefore = state.players.map((p) => p.score)
    const next = dispatch(state, { type: 'resign', playerId: alice.id })

    expect(next.players.map((p) => p.score)).toEqual(scoresBefore)
    expect(playerOf(next, 'Bob').dead).toBe(false)
    expect(playerOf(next, 'Carol').dead).toBe(false)
  })

  it('PIN 7: with no slayer the resigner keeps their markers (Java handleSlaying(null))', () => {
    const state = twoPlayerGame(11)
    const alice = playerOf(state, 'Alice')
    const bobMarkersBefore = playerOf(state, 'Bob').markersAvailable.length
    expect(legionsOf(state, alice).length).toBeGreaterThan(0)

    const next = dispatch(state, { type: 'resign', playerId: alice.id })

    // Nobody inherited them: `handleSlaying` only transfers when there IS a slayer.
    expect(playerOf(next, 'Bob').markersAvailable.length).toBe(bobMarkersBefore)
    expect(playerOf(next, 'Alice').markersAvailable.length).toBeGreaterThan(0)
  })

  it('PIN 8: resign is a SHARED command, so the commit path PUBLISHES it', () => {
    // The brief's hard constraint: it must NEVER be added to LOCAL_ONLY_COMMANDS.
    expect(isSharedCommand({ type: 'resign', playerId: 'p1' })).toBe(true)
  })

  it('PIN 9: a player who is already out cannot give up again, and an unknown id is refused', () => {
    const state = twoPlayerGame(11)
    const alice = playerOf(state, 'Alice')
    const ended = dispatch(state, { type: 'resign', playerId: alice.id })
    expect(canResign(ended, alice.id)).toBe(false)
    expect(resignRefusalReason(ended, alice.id)).toMatch(/already out/i)
    expect(resignRefusalReason(state, 'nobody')).toMatch(/unknown player/i)
    // A missing id is a loud refusal, not a silent owner-less resignation.
    expect(resignRefusalReason(state, '')).toMatch(/unknown player/i)

    const after = dispatch(ended, { type: 'resign', playerId: alice.id })
    expect(after.winnerId).toBe(ended.winnerId)
  })
})
