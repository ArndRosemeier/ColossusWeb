# Hard sampled battle outcomes — row37

Owner: “Honestly, that seems to be not better than the normal diff. At all.
Even a bit worse.” Intent: genuinely deeper Hard reasoning, not merely wider
one-ply choices or weakened shared safety. Parent calibrates actual strength.

COPIES: 1 — evaluateBattle remains the real decision seam; battleRollout consumes
the existing lower-level battle authorities instead of duplicating game rules.

Writer `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\ai-tactics`,
codex/ai-tactics-writer, base67bc699, ledger37. Source scope evaluateBattle and new
tactical rollout helpers/tests only. Other writer owns deeper masterboard search.
No engine/difficulty/save/setup/simpleAi/masterboard/version changes; parent owns
the sole integrated1.08 final entry. No merge/push/deploy.

Hard-only local deterministic sampled trials must complete current Strike and
Strikeback plus the relevant enemy response, using actual legal moves, dice,
hazards, kills, carry and phase advance. Never recursively invoke Hard planning,
consume simulation dice from the caller RNG, allocate real dice IDs or mutate input.
Share the read-only variant and clone mutable state with trimmed logs. Stop at
unsupported reinforcement/summon boundaries without inventing units or crediting
partial candidates. Normal/Easy choices/RNG usage and mandatory safety stay intact.

Expose decisions, completed/credited trials, actual transition/policy work,
horizon and exhaustion. Tiny budgets use safe Normal fallback. Measure real7v7
completed work and latency before making responsiveness claims. Parent owns full
gate, independent negatives, fair controlled match harness and browser. The parent
withdrew earlier aggregate strength claims after discovering a harness controller
leak; do not tune against those figures. If any requested design is demonstrably
wrong, report BLOCKED with evidence rather than fake a deeper search.

Writer focused/cheap gate only, Node1024/worker1/shared lock. Commit before source
differentials, retain raw red/VOID evidence, close every process. Docs conflicts
are a mechanical union of own row; source conflicts stop the writer. Cadence only
LANDING/BLOCKED.
