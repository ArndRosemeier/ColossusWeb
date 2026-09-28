# Titan / Colossus rules compliance

Living matrix for the TypeScript port (`web/src/engine`).  
Authority: **Colossus Java** when intentionally divergent → **official Titan** → MVP notes.

Statuses: `pass` | `partial` | `fail` | `colossus-diff` | `n/a`

**Counts (full rules port):** pass **~55** · partial **~3** · colossus-diff **3** · n/a **2** (dice etiquette)

Port modules: `engagement.ts`, `battleland.ts`, `battleMovement.ts`, `battleStrike.ts`, `battle.ts`.

---

## Setup & win

| ID | Rule | Status | Code | Test |
|----|------|--------|------|------|
| A1 | Prefer Colossus when divergent | pass | docs/rules/README.md | — |
| A2 | Start: Colossus 8-high + turn-1 split | colossus-diff | `createGame` | `rules-setup` |
| A3 | Phase order Split → Move → Fight → Muster | pass | `GameEngine` | `rules-setup` |
| A4 | Max battle turns 7; time-loss | pass | `battle` | `rules-battle-timing` |
| S1 | Unique towers | pass | `createGame` | `rules-setup` |
| S2 | Starting Titan+Angel+6 | colossus-diff | `createGame` | `rules-setup` |
| S3–S4 | Titan death / last titan wins; mid-battle Titan ends after Strikeback (mutual → draw) | pass | `checkBattleTitanElimination` | `titanDeathBattle`, `rules-scoring` |
| S5 | **Giving up the game** — a player leaves with their Titan ALIVE | colossus-diff | `resignRefusalReason` / `doResign` / `eliminatePlayer` | `rules-resign` |
| S6 | **Deleting a game the caller was in** (lobby hygiene: the record + every player object + every snapshot, RECORD LAST) | n/a (lobby, not a board rule) | `deletionPlanFor` / `deleteGames` (`net/lobby.ts`) | `deleteGame` |

**S5 is a Colossus difference, and the only authority for it.** Titan's own text covers leaving
the game only through a Titan's death (*"if it is lost the player is out of the game and all of
his forces are removed from play"*, `Titan-UltraBoardGames.html:525`) and through CONCEDING an
Engagement, which eliminates one Legion and awards the winner full value
(`Titan-Engagements.html:23-25`) — there is no board-game "resign". The Java server has it:
`GameServerSide.java:1185-1218` `handlePlayerWithdrawal` makes the player dead through
`PlayerServerSide.die(slayer)` and then `checkForVictory()`, with no phase guard and no second
game-over; `PlayerServerSide.java:606-661` `die` removes every legion, gives **half** the value
of a legion that is in an engagement to the enemy on its hex ("Engaged legions give half points
to the player they're engaged with. All others give half points to slayer, if non-null"), gives
nothing for an unengaged one when the slayer is null (a withdrawal's slayer IS null,
`:609-610`), and hands the markers on only when there is a slayer (`handleSlaying`, `:645-656`).
This port routes resignation through the SAME elimination body and the SAME ending
(`checkTitanDeath`), so "the game is over" keeps ONE definition. The owner's scope is NARROWER
than Java's: a resignation INSIDE a battle is refused, because the in-battle equivalent already
exists as `concedeBattle`.

## Split / Movement / Teleport / Muster

| ID | Rule | Status | Test |
|----|------|--------|------|
| P1–P3 | Split rules (turn-1 = 4:4 + 1 lord each) | pass | `rules-split` |
| M1–M4, M6–M7 | Movement | pass | `rules-movement` |
| M-spin | Exact-roll loop back to start (spin cycle) | pass | UI double-click chit + `listNormalMoveHexes` | `rules-movement`, `movePath` |
| M5, M8 | Engagement hex / arrows | partial | — |
| M9 | Mulligan | pass | `rules-port` |
| T1–T2, T4 | Teleport | pass | `rules-teleport` |
| T3 | Reveal lord on tower teleport | pass | `doMove` | `rules-engagement-extras` |
| Q1–Q3 | Muster | pass | `rules-muster` |

## Engagements

| ID | Rule | Status | Code | Test |
|----|------|--------|------|------|
| E1 | Mover picks order | pass | `findEngagements` | `rules-engagement-extras` |
| E2 | Reveal stacks | pass | auto on `openEngagement` | `rules-engagement-extras` |
| E3 | Flee half points | pass | `resolveEngagementConcession(..., half)` | `rules-port` |
| E4 | The defender may immediately flee; the attacker may not, and a Lord blocks it | pass | `canFlee` / `openEngagement` (`fleeDeclined`) / `flee` | `rules-engagement-choice`, `rules-engagement-extras` |
| E4b | Either player may demand Battle — only once the defender's flee window is closed | pass | `startBattleFromEngagement` guard + `standFight` | `rules-engagement-choice`, `engagementChoice` (overlay) |
| E5 | Agreement / mutual 0 | pass | `resolveAgreement` | `rules-port` |
| E6 | Concede **full** points (≠ flee) | pass | `concedeEngagement` / `concededFullPoints` | `rules-port` |
| E7 | Caretaker: immortals recycle; mobs removed | pass | `returnEliminatedCreature` | `rules-caretaker` |

## Battle

| ID | Rule | Status | Code | Test |
|----|------|--------|------|------|
| B1 | Real battleland | pass | `battleland.ts` + convert | `rules-port` |
| B3 | Unentered after first maneuver die | pass | `killUnentered` | `rules-battle-maneuver` |
| B4–B5 | Tower / defender first | pass | `startBattle` | `rules-battle-timing` |
| B6 | Titan-teleport entry | partial | `enteredFrom` entrances | — |
| B7 | Time-loss | pass | `applyTimeLoss` | `rules-battle-timing` |
| N1 | Skill movement | pass | `battleMovement.ts` | `rules-battle-maneuver` |
| N3 | Contact lock (cliffs break contact) | pass | `isInContact` / `meleeNeighbors` | `rules-battle-maneuver` |
| N5 | Occupied hexes | pass | movement | `battleEntryDeploy` |
| N6–N8 | Hazards entry/slow | pass | `getEntryCost` | `rules-battle-hazards` H14 |
| H1–H15 | Hazard combat / rangestrike / entry | pass | `battleStrike` / `battleland` | `rules-battle-hazards` |
| K2 | Must strike | pass | `hasForcedStrike` | `rules-battle-maneuver` |
| K2b | Dead creatures strike back before removal | pass | `legalStrikes` / Strikeback | `deadStrikeback` |
| K3 | Strike chart | pass | `getStrikeNumber` | `rules-port` |
| K4 | Heal after battle | pass | `applyBattleResult` | `rules-scoring` |
| K5 | Carries + optional raised SN (announce before roll) | pass | `listStrikeRaiseOptions` / `battleStrike` | `rules-carries` |
| K6–K9 | Rangestrike / LOS (terrain+chits) / lords / Warlock / dead-adjacent | pass | `battleLos.ts` / `battleStrike.ts` | `rules-rangestrike` |
| R1–R3 | Defender reinforce turn 4 | pass | `battleReinforce` | `rules-reinforce-summon` |
| U1–U4 | Angel summon (one window: first Maneuver after first blood only) | pass | `summonState` / `battleSummon` | `rules-reinforce-summon` |
| Q4–Q6 | Angels / scoring / titan power | pass | `rules-scoring` | |
| Q8–Q9 | Leftover half points + markers | pass | `checkTitanDeath` | `rules-engagement-extras`, `titanDeathBattle` |
| L1–L2 | Dice etiquette | n/a | digital RNG | `rules-gaps` todo |

---

## How to extend

1. Prefer Colossus Java sources under `Colossus/core/...`.
2. Add/adjust Vitest under `web/src/engine/__tests__/`.
3. Update this matrix.
