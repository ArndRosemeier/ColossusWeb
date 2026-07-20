# Titan / Colossus rules compliance

Living matrix for the TypeScript port (`web/src/engine`).  
Authority: **Colossus Java** when intentionally divergent → **official Titan** → MVP notes.

Statuses: `pass` | `partial` | `fail` | `colossus-diff` | `n/a`

**Counts (full rules port):** pass **~50** · partial **~5** · colossus-diff **3** · n/a **2** (dice etiquette)

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

## Split / Movement / Teleport / Muster

| ID | Rule | Status | Test |
|----|------|--------|------|
| P1–P3 | Split rules (turn-1 = 4:4 + 1 lord each) | pass | `rules-split` |
| M1–M4, M6–M7 | Movement | pass | `rules-movement` |
| M5, M8 | Engagement hex / arrows | partial | — |
| M9 | Mulligan | pass | `rules-port` |
| T1–T2, T4 | Teleport | pass | `rules-teleport` |
| T3 | Reveal lord on tower teleport | pass | `doMove` log |
| Q1–Q3 | Muster | pass | `rules-muster` |

## Engagements

| ID | Rule | Status | Code | Test |
|----|------|--------|------|------|
| E1 | Mover picks order | pass | `findEngagements` | — |
| E2 | Reveal stacks | pass | `revealEngagement` | UI |
| E3 | Flee half points | pass | `engagement.ts` | `rules-port` |
| E4 | Fight forfeits flee path | pass | propose fight | — |
| E5 | Agreement / mutual 0 | pass | `resolveAgreement` | `rules-port` |
| E6 | Concede full points | pass | `concedeEngagement` / `concededFullPoints` | `rules-port` |
| E7 | Caretaker recycle | pass | eliminate paths | — |

## Battle

| ID | Rule | Status | Code | Test |
|----|------|--------|------|------|
| B1 | Real battleland | pass | `battleland.ts` + convert | `rules-port` |
| B3 | Unentered after first maneuver die | pass | `killUnentered` | — |
| B4–B5 | Tower / defender first | pass | `startBattle` | `rules-battle-timing` |
| B6 | Titan-teleport entry | partial | `enteredFrom` entrances | — |
| B7 | Time-loss | pass | `applyTimeLoss` | `rules-battle-timing` |
| N1 | Skill movement | pass | `battleMovement.ts` | — |
| N3 | Contact lock | pass | `isInContact` | — |
| N5 | Occupied hexes | pass | movement | — |
| N6–N8 | Hazards entry/slow | pass | `getEntryCost` | — |
| K2 | Must strike | pass | `hasForcedStrike` | — |
| K3 | Strike chart | pass | `getStrikeNumber` | `rules-port` |
| K4 | Heal after battle | pass | `applyBattleResult` | `rules-scoring` |
| K5 | Carries | pass | `pendingCarry` / `battleCarry` | — |
| K6–K9 | Rangestrike / LOS / lords / Warlock | pass | `battleStrike.ts` | — |
| R1–R3 | Defender reinforce turn 4 | pass | `battleReinforce` | — |
| U1–U4 | Angel summon | pass | `battleSummon` | — |
| Q4–Q6 | Angels / scoring / titan power | pass | `rules-scoring` | |
| Q8–Q9 | Leftover half points + markers | pass | `checkTitanDeath` | — |
| L1–L2 | Dice etiquette | n/a | digital RNG | `rules-gaps` todo |

---

## How to extend

1. Prefer Colossus Java sources under `Colossus/core/...`.
2. Add/adjust Vitest under `web/src/engine/__tests__/`.
3. Update this matrix.
