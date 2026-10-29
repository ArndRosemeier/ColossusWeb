# Hard tactical outcome sampling

COPIES: 1 — evaluateBattle is the real decision adapter; battleRollout uses the
existing lower-level battle engine for future outcomes and never calls Hard again.

Normal/Easy keep their existing commands and real chooser RNG consumption. Hard
first obtains the explicit Normal8/2048 control action and samples that action
equally with shortlisted alternatives. The existing Hard16/4096 first-ply pass may
supply extra root choices, but its wider choice is not the fallback. Root Move
options have no worse conditional Titan risk than Normal. Entry, critical Titan
retreat/terrain escapes and certified final defender holds run before sampling.
Final-defender turn7 strikes with a Titan retain the common Normal choice as well.

Each trial clones mutable game data with log trimmed and shares the read-only
variant. It uses legalBattleMovesFor/legalStrikesFor, authoritative strike dice/SN,
raised carry options, resolveStrikeFor, doCarry and advanceBattlePhase. Thus damage,
dead Strikeback, casualties, opened lines, legal future maneuvers, hazards and the
clock alter later choices. Moves apply the engine-validated placement/moved/stack
projection. The live dispatch path is never used; no real dice IDs, Date.now or
Math.random are consumed by simulations. A local seeded RNG restarts with the same
sample seed for each candidate, providing paired common random numbers.

Horizon is two maneuver/strike cycles: finish current combat and the relevant
enemy maneuver/Strike/Strikeback, or stop at an actual terminal result. Recruitment
and summoning are explicit unsupported boundaries; no units are invented. Pending
initial deployment is also censored until both first maneuvers are done: the cheap
rollout policy does not share the real AI's entry-feasibility planner, so it must
never receive credit for stranding an opposing Titan. Any
boundary or incomplete requested sample set returns the Normal control. Completed
trials from an incomplete round are counted as actual work, but their utility is
not credited to candidate comparison. Terminal results can legitimately finish
before two cycles; terminalRollouts and minCompletedCycles expose that distinction.

Default roots: up to3 actions including Normal. Move retains one best root per
different mover before filling alternate destinations for the same mover, after
the whole-position ranking and existing Titan-risk filter. Move uses8 paired rounds; Strike
uses16 rounds, or32 when at most6 battle units remain. Hard moves therefore normally
complete up to24 trials; small strikes up to96. All share hard ceilings of3072 actual
transition nodes and20000 policy evaluations, with strict option validation and
diagnostic overrides. Policy work counts cheap destination scores, full utility
evaluations and cache lookups. The inexpensive deterministic simulated policy first
shortlists3 legal destinations per unit, then evaluates actual strikes/threats;
strike selection uses exact binomial utility and engine raised/carry options.
It never invokes the expensive real enemy-response planner recursively.

Exact-position policy caching reuses only a deterministic action and held-unit
decisions keyed by phase/turn/actor, every unit's position/health/flags and carry.
Every trial still applies its own real engine transitions and sampled dice. Cached
choices came from engine legality at that identical position; root commands are
validated independently. Distance/policy caches live only for the current decision
and are bounded by the existing node limits. No world state or variant is cached
mutably across calls. Counters expose cache hits separately from transitions.

Utility prioritizes Titan player elimination. Ordinary completed battles use
actual surviving material with fully healed wounds, on the same scale as horizon
material/fractional health. There is no fixed ordinary-win/loss bonus: a quick
pyrrhic win cannot dwarf every unfinished superior army. Time loss excludes every
attacker even if a pending-result snapshot still marks that unit alive; completed
results have no remaining-clock term. Horizon states retain the small clock term.
Titan loss is
identified through units/fallen and whole-legion time loss, not only the engine's
endedByTitanKill flag. Strike/hazard/failed-entry/clock elimination have the same
value. Mutual Titan loss is a neutral draw with two contenders, but remains own
elimination when another player survives; this remains true after real result
application marks the players dead. No acquisition/scoring result is invented.

A candidate must beat Normal's paired mean by1.5 estimated standard errors plus0.5
utility. Terminal improvements require at least two favorable terminal samples and
more favorable than unfavorable terminal samples. One lucky Titan kill is not
enough. This is a conservative acceptance rule, not a win-rate guarantee or formal
calibrated confidence interval. usedRollout means the full comparison completed;
changedDecision says whether it actually changed Normal's action. Per-choice mean,
paired advantage/error and acceptance are available for independent inspection.

Diagnostics: planBattleManeuver exposes first-ply work, normalControlWork and rollout
work; planBattleStrike exposes the decision and rollout work. rollout:false disables
the new branch and uses Normal core unless explicit planning overrides are supplied.
Tiny budgets, deployment/support boundaries and insufficient evidence retain Normal. No new
difficulty persistence, UI, net, engine rule or playback-speed setting is introduced.

Tests independently apply identical legal dice to a final-turn two-Hydra line:
kill the nearly dead Colossus first and its absorbed hit leaves the Titan alive for
time loss; focus both strikes on the Titan and the engine ends in a Titan victory.
The search changes that root choice with paired evidence. Another real7v7 contact
fixture changes strike sequencing; a7v7 maneuver compares full outcomes and keeps
Normal because the measured difference is not convincing. Mandatory safety and
Normal/Easy RNG/input invariants are retained. Node fixture timings/counters and
honest limitations are in TESTING. Parent owns independent full/negative/browser
and controlled strength comparisons; earlier withdrawn aggregates are not evidence.
