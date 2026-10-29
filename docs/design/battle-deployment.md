# Hard complete initial deployment

COPIES: 1 — allCanStillEnter remains the common entry-feasibility guard. The new
search receives Normal/formation/response/entry-safety callbacks from evaluateBattle;
battleDeployment depends only on engine authorities, never on evaluateBattle.

Hard can compare complete initial entry sequences instead of selecting each landing
independently. Normal/Easy retain the existing picker and exact real RNG use. The
current Normal root is computed once using the actual caller RNG. Its remaining
entry continuation uses that same picker with a deterministic local zero tie-break,
including the existing allCanStillEnter/Titan-priority policy, and is completed before
any comparison. It does not predict or consume the caller's future random stream.

The deterministic beam has width6, depth equal to pending initial entries (at most7),
a2000 generated-placement-node ceiling and4096 conditional enemy-response-node ceiling.
Options validate bounded integer limits. Every edge uses legalBattleMovesFor on a
scratch battle, marks the entrant moved and updates occupancy/stack. Reordering entries
can therefore open or block paths. Equivalent final partial placements are deduplicated;
the retained sequence is itself a legal witness. No factorial permutation search,
phase simulation, dice, real dispatch, world RNG or global ID allocation occurs.

Partial ordering reuses existing placement scores and formationScore. Full formations
including the completed Normal control use identical evaluateBattleHex/ownKeepValue/
legalEnemyResponse callbacks. Terrain damage, native effects, legal enemy landings,
LOS/contact, Titan risk and friendly screens remain the existing tactical model;
power×skill and all battle/engagement estimators are unchanged. The response-weight
expression is shared with ordinary maneuver scoring, preserving its arithmetic.

A completed alternative needs more than0.5 utility improvement, no greater conditional
Titan risk, and the SAME common allCanStillEnter guard for its first action. Complete
legal entry witnesses preserve every living pending creature; incomplete beam leaves
never become real moves. Any node/response exhaustion or incomplete Normal continuation
returns the exact current Normal command. No positive partial formation gets credit.
Normal's current mandatory work and its bounded existing entry-feasibility searches
remain outside the optional beam-node counters; this is not a wall-clock budget.

Only the first action is returned. After actual dispatch the planner recomputes from
the real partially entered position, with already placed creatures fixed. Each accepted
action again has a complete legal continuation and the shared safety check. There is
no stale saved plan, global cache or new game state. A new choice may improve the prior
formation; no promise is made that every previously proposed square stays unchanged.
Later reinforcement/summon entry and ordinary maneuvers retain their existing path.
Combat rollouts continue to censor unfinished initial deployment independently.

planBattleDeployment exposes the actual selected/control command, complete selected
and baseline plans, comparable scores and work counters. usedPlan means the bounded
comparison completed, not necessarily that the command changed; an improved complete
plan can share Normal's first action and diverge at the next real decision. changedDecision
tracks only the returned current action. legalQueries counts the explicit beam and
baseline-validation queries; baselineMoves counts Normal continuation entries, not
every internal Normal ranking/feasibility query. entrySafetyChecks counts additional
shared-guard validations of completed improving plans.

Evidence: actual Woods/Left seven-creature entry retains all units and recomputes from
each partial state. Defender Titan moves from the Normal rim formation with2 adjacent
friends to5. Against an enemy deployed by actual engine commands, the attacking
Gargoyle gains a legal melee target while the Centaur retains a separate target;
Normal's Gargoyle has no target. Fixed engine strike faces resolve the extra4 hits.
These are structural tactical fixtures, not a battle-win or aggregate-strength claim.
One-HP Titan/Tundra, frozen input/variant, deterministic output, no Date.now/Math.random,
caller RNG parity, small-budget fallback and Normal/Easy entry compatibility are pinned.
TESTING carries raw gates, node counts, measured fixture latency and limitations.
