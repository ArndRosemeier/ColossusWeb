# Hard complete non-entry maneuvers

COPIES: 2→1 — entry/ordinary movement share formationBeam, projection and budget
validation; evaluateBattle shares complete-position scoring and root comparison.
sampleBattleRoots and its acceptance/statistics remain unchanged.

Hard's optional branch follows the common Normal tactical safety pass. Protected
Titan escapes and certified final defender clock holds return before optional work.
Initial/off-board/reinforcement entries retain their existing dedicated path.
Normal/Easy and their real RNG use remain unchanged. maneuver:false exposes the
previous Hard local chooser for diagnostics; rollout:false retains the Normal core.

Root zero contains the exact Normal first command followed by its deterministic
Normal continuation until Done. Simulated continuation calls the local Normal core,
never Hard recursively. Its actual additional response/safety nodes and move count
are disclosed separately from the first Normal pass. Every projected move is legal
under its predecessor occupancy and marks the mover moved. A unit moves at most
once. The remaining units HOLD when Normal completes its maneuver.

The generic beam resolves up to seven currently mobile own units. Each decision
can HOLD internally or choose among three legal destinations ranked by existing
placement priors. HOLD is not a command or a fabricated moved flag. The node key
includes positions AND remaining/held IDs; equal positions do not imply equal
undecided-unit continuations. Entry uses the same beam without HOLD. Position-only
formation score caching does not merge those different continuation states.

Width8 retains useful different first movers before filling alternate destinations.
Logical HOLD/move expansions are capped at1200; all legal destination scans are
counted and capped at6000. Existing full-position conditional responses share4096
nodes. Initial placement priors use the existing evaluator, at most27 cells per
mobile unit; that additional count is exposed. The old Normal continuation and its
existing safety/ranking work are separately bounded and disclosed, not hidden in
the optional beam counters. Shared validators reject malformed limits. There are
no wall-clock-dependent decisions or unbounded permutations.

Static full-position utility only shortlists complete final formations with no worse
conditional Titan risk than the complete Normal control. Root zero plus up to two
alternatives use the existing8 paired samples/3072transition/20000policy caps. Each
root starts real Done, then the engine resolves strikes, dead ordinary Strikeback,
hazards and enemy response. Incomplete/weak/unsupported work retains actual Normal.
The existing paired acceptance and Titan/terminal utility remain unchanged; power×skill,
creature estimates, game resources and information policy are not replaced.

Only the first real move or Done is returned. Later calls recompute from the actual
state; already-moved units stay fixed. No saved plan, HOLD state, GameState field or
history-dependent cache exists. A replan may change future proposed positions/HOLDs,
but every accepted current move belongs to a complete legal sequence. Diagnostics
expose selected/control move sequences, internal held IDs, first-pass/continuation
work and shared sampled outcomes. Source/fixture verification and measured latency
are recorded in TESTING; a larger search is not itself a strength claim.
