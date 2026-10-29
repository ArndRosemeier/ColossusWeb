# AI planning difficulty

COPIES: 1 — ai/difficulty.ts owns normalization, labels and per-level planning budgets.

Each seat keeps an aiDifficultyId independent of its AI personality and the user's
AI playback speed. Optional new-game values defaultNormal. A required player-state
field persists the normalized choice through the existing save/snapshot serializer.
Missing old fields migrateNormal on a cloned state; explicit null, unknown IDs,
arrays, booleans, numbers and objects throw. Serialization also validates the field.
SAVE_VERSION remains1 because the addition has an explicit backwards migration.
No network transport changes or resources/information bonuses are introduced.

Setup uses one native labelled select per AI row, with Easy/Normal/Hard options.
Row state retains the value across AI→Human→AI; human new-game payloads omit it.
Added rows defaultNormal. Personality stays a separate native control. Desktop uses
the existing grid with an additional column; narrow screens put Difficulty beside
Color on row3 and Remove on row4, preserving actual hit areas and accessible labels.

| Level | Battle candidates / optional response nodes | Split plans / endpoints per roll |
| --- | --- | --- |
| Easy | 2 / 512 | 96 / 2 |
| Normal | 8 / 2048 | 1024 / 4 |
| Hard | 16 / 4096 | 4096 / 8 |

The battle planner resolves the battle activePlayerId, not masterboard active seat.
Its separate8192-node Titan safety budget, exact strike probabilities, deterministic
terrain/clock safety and deployment feasibility remain the same at all levels.
Explicit tactical options still override level defaults for diagnostics. Counters
measure actual candidate/reply work; larger limits need not change every decision.
Normal is the previous strengthened behavior. Hard considers more alternatives;
these labels are not a universal head-to-head win-rate guarantee.

After STRATEGY-READY the foundation was rebased onto9157fc648e04c727fac6b82081ea3beea7e635f1. Both planOptionalSplit and splitMovePolicy resolve the actual legion/group owner through the shared settings seam. Explicit diagnostic overrides remain available. SafeJointRoute, fixed moved siblings, held-piece exclusion and explicit least-loss fallback retain the strategy writer's current execution policy; no simpleAi/evaluateMove behavior was changed. All-level tests execute approved splits through all six rolls and retain the held child against the threatened bait. Lower optional budgets may approve fewer splits, never relax the safety test.

Offline simulateGame optionally accepts per-seat difficulties and validates their
length against player count before running. Missing settings keepNormal; invalid IDs
reach the same constructor boundary. This changes simulation setup, not AI logic.

The current AI can inspect hidden opposing legion contents. This slice does not
introduce fair-information inference and must not describe levels as human-equivalent
information. No level changes starting pieces, caretaker stock, towers, dice or RNG
consumption in createGame. Tests compare the entire seeded state apart from this
metadata, including resolved random personality. Presentation timing is untouched.

Writer evidence and raw logs are in TESTING. Independent full/negative/browser and
paired strength results belong to parent. The integrated release remains1.08.

Parent's independent browser found that strict invalid save data exposed a pre-existing missing catch around App.continueSaved. Approved scope expansion adds only that catch, reporting variant/manifest/deserialization failures through existing setError. The original save remains untouched. Actual App tests pin all three failure sources and parent repeats the browser case.

Calibration follow-up: node budgets alone did not separate challenge in the parent's
32 paired Hard/Easy games (15Hard wins,16Easy wins,one max_turns), so they are not
presented as a calibrated strength hierarchy. Easy now has an explicit simpler
coordination policy: normally finish optional masterboard movement after one friendly
legion moved. Normal/Hard have no such limit. Shared split routes and mandatory
separation run first. An executable risk-reducing rescue of an unmoved Titan returns before the cap; merely having a legal but losing move does not bypass it.
The move picker now also prioritizes a genuinely risk-reducing legal Titan escape
for every level, including zero-growth exits; a losing engagement cannot be mistaken
for refuge merely because incoming-threat scoring skips an enemy already there.
If no safer route exists, Easy finishes optional coordination; Normal/Hard retain their ordinary evaluation rather than forcing a Titan into a worse hex. No resources, dice, tactical objectives or
random mistakes change. Changelog1.08 describes simpler coordination explicitly.
The parent reruns paired calibration and held-out checks before making strength claims.

Hard-depth follow-up (row36, same unpublished1.08): `masterLookahead.ts` adds genuine two-future-turn six-roll board expectimax after shared safety. It compares a few legal current moves with the exact ordinary Normal control, or a two-turn HOLD when Normal stops; only completed expected army improvement can override. Real caretaker/composition projections, enemy survival, bounded counters and conservative fallback replace the claim that a wider shallow budget alone implies stronger play. Normal/Easy command/RNG behavior is pinned unchanged. Details/limitations: design/hard-master-lookahead.md. Parent withdrew a prior aggregate after a benchmark defender-controller leak and independently repeats corrected same-seed Hard-versus-Normal67 and old1.07 comparisons before claiming measured strength.
