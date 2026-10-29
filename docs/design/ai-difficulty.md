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

Split-owner default wiring is pending the strategy execution writer's ready signal
and rebase. The safe execution policy must remain unchanged; an incomplete safety
screen holds. This paragraph is replaced when that sequential integration is verified.

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
