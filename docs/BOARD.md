# The board — current work

reconciled: 1c39d623dbe6beeb024e806af30b7a85026ee936 · 2026-10-30

REMOTE | branch=origin/master | release=1.07 | AI changes remain unpublished
SESSION | actor=/root | branch=codex/ai-strength | base=a6c46de | state=continuing verified AI improvement
BUILT-LOCAL | rows=33–42 | tests=673passed/2todo;82files+1skip;Node1024/worker1;peakNOTMEASURED | log=.gate-logs/dispatcher-outcome-cohort/gate.log
BENCHMARK | source=a6c46de | opponent=frozen Normal67bc699 | games=100 | wins=55 | losses=44 | draws=1 | errors=0 | capped=0 | score=55.5% | paired95CI=48.5–62.5% | Normal command/RNG checks=42120 | data=../output/ai-strength/outcome-hard-normal-heldout-v3-cohort.json | interpretation=modest inconclusive lead
RECOVERY | row=43 | worktree=worktrees/ai-tactics | branch=codex/ai-tactics-writer | base=a6c46de | state=recovered by /root/maneuver_writer; complete local implementation awaiting parent verification | scope=evaluateBattle, shared formation beam, whole non-entry maneuver and tests/docs only
QUEUE | row=44 | worktree=worktrees/ai-strategy | state=implemented b8221f0; integrated checks running | scope=one unchanged support engine authority/shared AI support selector/trial support and cache keys
GUARD | at most2 isolated writers | all checks=scripts/gate.sh | shared lock=free | no Java toolchain | never npm run convert
GUARD | user Vite PID19812 and foreign bundled Playwright Chrome PID49708 are not ours; preserve | our ProgramFiles Chrome checks close in finally
TRAP | original v1 mixed-controller strength counts withdrawn | v2/v3 defender-owned controls valid | no per-seed tuning, no superiority claim from test counts
RECOVERY | full chronology=../output/ai-strength/STATE.txt | raw gates=.gate-logs | completed writer logs archived; worktrees ai-difficulty/ai-strategy/ai-tactics preserved until remote verification
QUEUE | acceptance=independent full/negative/production checks, quantified difficulty; automatic verified merge/push to master; one draft1.08 dated2026-10-30; no manual host deploy

BUILT-LOCAL | row=43 | actor=/root/maneuver_writer | worktree=worktrees/ai-tactics | branch=codex/ai-tactics-writer | base=a6c46de | lands=this commit | scope=shared entry/ordinary formation beam and complete sampled ordinary maneuvers | evidence=docs/TESTING.md row43;focused0/72tests/6files+tsc/Vite;negative0 A/C095e7a5 B b2f513b;peakNOTMEASURED | parent integrated verification/strength owed | no push/deploy

BUILT-LOCAL | row=44 | actor=/root/support_writer | branch=codex/ai-strategy-writer | worktree=C:/Users/windo/Documents/ChatGPT/ColossusWeb/source/worktrees/ai-strategy | base=a6c46de | lands=this commit | scope=one unchanged support engine authority/shared selector, actual trial support/cache and donor transfer accounting | focused=0;86passed/5files;lint0warnings0errors;Node1024worker1;peakNOTMEASURED | cheap=2;tsc/Vite118modules | negative=0;A18pass/Bnamedcensorfail/Cpass/Dnamedstockcachefail/Epass;exact9a0f4cebcbe2restored | COPIES=2→1 engine support and AI support policy | parent=integrated shared obsolete censor assertions/full/independent negative/production/outcomes owed; no strength claim | no push/merge/deploy/version edit
