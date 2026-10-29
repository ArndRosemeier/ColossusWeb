# Stronger battle tactics — writer row34

Owner intent: improve AI strength following the strategy/tactics audit; leave a
measurable budget seam for later difficulty controls. Source authority is the
existing engine and rules README; no combat, map or serialized-state changes.

COPIES: 1 — shared evaluateBattle decision seam, with pure probability and legal
enemy-response helpers; existing simpleAi callers retain the same command contract.

Writer: `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\ai-tactics`,
branch `codex/ai-tactics-writer`, base `1c39d623dbe6beeb024e806af30b7a85026ee936`.
Ledger34. Scope evaluateBattle and new tactical helpers/tests, plus design, seam
index, board, ledger and testing evidence. Strategy writer owns simpleAi, profiles,
legion strength, split/masterboard and the integrated1.08 release entry. Do not
change those files or engine/types/rules/save/net/setup/sim/assets. Do not push/merge.

Implement deterministic hazard safety, meaningful hold/Done, legal enemy next-half
response for deployed units, exact binomial damage/kill/useful carry expectations,
and bounded whole-position candidate analysis. Preserve deployment feasibility,
dead strikeback, raised strike numbers and forced target ordering. Public decisions
must leave input unchanged. Mandatory Titan/clock/deployment safety remains outside
optional difficulty budgets. Report budget exhaustion and measured work honestly.

The coherent first improvement may use bounded legal reply analysis instead of a
full stochastic beam: no unbounded permutations or performance promises. If the
brief proves wrong, report BLOCKED with evidence. One shared-lock focused gate and
cheap gate, Node1024/worker1; parent owns complete suite, independent negative pin,
paired strength matches and browser. Commit before source differential. Docs
conflicts are a mechanical union of own row only; source conflicts stop the writer.

Cadence: LANDING or BLOCKED. No writer process survives the landing.
