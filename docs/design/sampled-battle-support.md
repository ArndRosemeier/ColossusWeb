# Real battle support in sampled futures

COPIES: 2→1 — live dispatch and trials use applyBattleSupport in engine/battle.ts;
live AI and trials use pickBattleSupport in ai/battleSupport.ts. Existing
supportPlanning remains the ranking seam. No copied battle rule or second AI policy.

The four existing handler bodies (reinforce, skip, summon, skip) moved verbatim
from GameEngine into the exported lower-level engine authority. Dispatch delegates;
validation order, error messages, deterministic battle-local IDs, caretaker use,
legion/public roster changes, support flags and direct Move transition are preserved.
In particular the existing explicit summon handler does not independently reject a
`tooLate` window; the options/AI selector do. This extraction deliberately does not
silently change that pre-existing distinction. A separate rules decision can address it.

The real deterministic support chooser moved without changing order/ranking or RNG.
Normal/Easy still use exactly that policy. First eligible summonable in the selected
donor is what the engine transfers; a later stronger Archangel is not substituted.
No world RNG/global ID allocator, dispatch, post-battle reinforcement, acquisition or
engagement completion is invoked by a trial.

A Recruit/Summon encountered before the requested horizon now executes the shared
selector and engine authority. Its new unit starts off board and uses actual legal
later-entry moves. A blocked entry retains null, just as the existing engine permits
for a later support unit; neither a landing nor an initial-entry casualty is invented.
The next half's Recruit/Summon exactly at the completed horizon remains an unexpanded
leaf. Living pending INITIAL entry remains censored. Incomplete work retains Normal.
Support commands consume transition work and policy selection counts; the existing
3072 transitions/20000 policy evaluations and common paired sampler are unchanged.

Policy cache keys now include each unit's creature type, player and legion identity;
actual stock; ordered donor and participant rosters/locations; player Titan powers;
and summon/reinforce rights in addition to the previous position/health/phase/actor
and held IDs. The same deterministic battle-local recruited ID can name a different
type in another root, so ID/position alone is insufficient. Caches stay local to a
single decision and all sampled engine transitions still execute.

Support accounting adds current-minus-original outside-battle material to the field
utility, from ONE root-independent original state. It uses the same power×skill
material seam and both sides' outside legions. No-support values are unchanged.
A surviving summoned Angel24 plus its donor's loss24 is a transfer, not army growth;
its death is a real24 loss. Terminal survivors heal as before. A reinforced creature
really consumes caretaker stock and adds a field creature, unlike a donor transfer.
Titan elimination retains the existing dominant terminal utility. No creature
strength formula, information/resource advantage or confidence threshold is changed.

Dedicated tests cover real turn-four reinforcement, actual first blood and later
summon, mixed donor order, public roster/stock effects, dispatch parity, blocked late
entry, changing support cache context, frozen input, tiny bounds, full paired trials,
no-free-material terminal accounting and live support chooser commands/RNG at all
three levels. Existing rules-reinforce-summon remains the rules coverage authority;
its pass status is unchanged. See TESTING row44 for actual gates and limitations.
A completed search or stronger fixture is not a tournament strength claim.
