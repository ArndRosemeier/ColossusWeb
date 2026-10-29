# Bounded tactical AI

COPIES: 1 — shared evaluateBattle decision seam; probability and enemy-response
helpers reuse engine legality/dice/strike-number/hazard authorities.

`pickBestBattleMove` keeps the existing deployment ordering and4000-node entry
feasibility DFS. Once deployment is complete, it compares holding the whole position
against a shortlist of legal moves. Position scores include every friendly unit,
so changing screens, ranged lines and formation affects the whole decision. No
command is dispatched into the live game while planning. Public hex scoring and
move ranking use scratch units, and enemy response uses its own scratch battle.

`legalEnemyResponse` enumerates actual legal next-maneuver landings and authoritative
strike targets, including LOS, contact, cliffs, flyers, startlists and occupancy.
Current pre-strike hazard casualties are removed before the future maneuver. A
separate maneuver snapshot preserves units that will die at the *next* pre-strike:
they still block movement. That next hazard tick changes target HP and can doom a
Titan. A newly slain ordinary enemy can still strike from its landing, matching
simultaneous combat. Rangestrikes are enabled for the future enemy Strike, while
current forced strikes/Strikeback continue to use the engine's existing paths.

Replies are conditional on surviving the current combat. Each enemy's best target
and landing is considered independently; multiple enemies may contest one cell.
This is a deliberately pessimistic legal-response envelope, not a full joint
minimax, complete maneuver permutation search, or sampled full-game rollout. It
does not forecast reinforcement/summon choices or resolve current combat chance
nodes. Attack response cost relaxes with clock/reinforcement urgency; Titans retain
a strong survival penalty. The parent measures actual strength with paired matches.

Mandatory safety: lethal immediate terrain is forbidden for Titan candidates;
deterministic future drains are scored in the response and escape selection. A
separate8192-node ceiling checks Titan hold/retreat positions, retaining the safest
retreat even when optional candidate pruning would omit it. A turn7 defender holds
when no legal enemy reply can damage its Titan and both intervening hazard ticks
are survivable. This is a sufficient clock certificate, not a force-ratio guess.
Budget exhaustion cannot replace a legal deterministic-terrain escape with Done.

Optional `BattlePlannerOptions` accepts candidateLimit1..32 and maxResponseNodes
1..16384; invalid values throw. Normal defaults are8 moves plus hold,2048 optional
reply nodes. A node is one enemy landing/strike evaluation. Whole-position candidates
stop at the first incomplete response and retain the best completed action. Work
counters expose optional responseNodes, mandatory safetyNodes, both exhaustion
flags and candidatesEvaluated. Entry feasibility has its separate existing budget.
Larger settings explore more candidate positions; no difficulty persistence/UI is
added here. Public `planBattleManeuver` exposes the deployed-position plan/counters;
normal game callers retain `pickBestBattleMove(..., rng, optionalOptions)`.

`strikeExpectations` uses a normalized binomial recurrence around its mode, so high
Titan power does not underflow the all-misses term. Its work is linear in dice.
Scores use expected capped damage, actual kill probability and expected overflow
capped by the HP of legal carry targets. Raised strike numbers come from the engine.
Carry utility remains a heuristic weighted by the best legal secondary target;
it is not an exact multi-target utility optimizer. Existing forced single-target
ordering and weaker-first information gathering remain, using kill probability
instead of the old mean-hit threshold. Known carry hits remain engine-owned.

Tests cover the audited Tundra/Plains/Hydra failures with actual commands and dispatch,
two-half hazard death, native immunity, screens, attacker approach, probability
mass/overflow, unchanged input, small/default/larger budgets and a7v7 position.
Existing battle entry, hazard, timing, range and dead strikeback tests are retained.
Measured work/timings and raw gates are recorded in TESTING; they are fixture
observations, not browser-wide latency or win-rate promises. No game rules or data
changes, version entry or independent verification claims belong to this writer.
