# Animated mode, first implementation: battles

You are the sole WRITER. Read the worktree AGENTS.md, docs/ARCHITECTURE.md,
docs/TESTING.md and docs/BRIEF.md first. The dispatcher has read the shared
Toolbox docs/WAY-OF-WORKING.md: separation of writer and independent verifier is
why this task is delegated. Do not spawn further agents. No other writer exists.

## Absolute worktree (read twice)
Work ONLY at C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\animated-mode
on codex/animated-battles, base origin/master ccb661e95bb2bc5e653bab4ecb1f90ba221cf4d1.
Every file edit and shell cwd must use this absolute worktree. The parent checkout
is C:\Users\windo\Documents\ChatGPT\ColossusWeb\source; do not edit it.
Asset inputs are read-only at C:\Users\windo\Documents\ChatGPT\ColossusWeb\output\creature-collection.
Your decision-ledger row is 18. No remote push, PR or deployment in this slice.
Commit the coherent finished feature locally and report its SHA. If blocked,
commit coherent partial work and report the evidence, not an empty result.

## Owner's exact intent
"Ok, nice. So, now establish an 'animated mode' (not touching the old way of
fighting) and implement these animations into fights."
Steering: "i want to do more in animated mode, but fights are the first step".

The approved assets are a full-color standard Titan roster: 24 creatures, each
resting/moving/attacking. Dragon has 12 frames per state, others eight timeline
slots (some intentionally held or resequenced poses). These are whole-frame,
white-background illustrations. Original mode must remain the default and retain
its current battle mechanics and presentation; animated mode is an opt-in,
application-wide LOCAL presentation preference, with battles its first consumer.
Do not create a second combat engine, change rules, dice, turn order, networking,
save format or command authority. Do not replace the classic art files.

## Existing seams and scope
COPIES: 1 — checked, no animated-mode seam exists (grepped: CreatureChit,
BattleAnimOverlay, pendingDice.strike, diceRoll.strike, backgroundAtmosphere).
BattleBoardView currently renders CreatureChit in on-board, staging and moving
overlay slots. App already delays local moves through buildMoveAnim/usePathTween,
then commits the same command. Strike identity is in pendingDice.strike and
diceRoll.strike, with stable roll IDs. The latter handles immediate/RNG strikes.
The existing preference pattern is ui/backgroundAtmosphere.ts + Select component.

Build ONE general presentation preference ('classic'/'animated'), persisted in
localStorage, shared by setup and in-game controls, suitable for later non-battle
consumers. Keep it out of GameState, serializers, network commands and seed/RNG.

Build a single reusable animated-creature renderer/asset registry and a battle
presentation seam. In animated battles:
- all standard creatures idle/rest while waiting and staging;
- moving pieces display moving artwork on the existing positional overlay;
- the striker plays attacking once per strike event, then returns to resting;
- handle both pending physical and settled instant/RNG strike events, without
  replaying the same strike when pending becomes settled or selection rerenders;
- stop animation on dead units, teardown and preference change; respect reduced
  motion (colored still art is fine); preserve labels, power, skill, damage,
  selection, targets, clicks and side recognition;
- keep illustrations upright. Classic attacker chits rotate 180deg; use sensible
  horizontal facing for the new creature art instead, without rotating labels.
If animated presentation needs a slightly longer visual movement to read clearly,
that may affect animated mode only and must use the existing completion callback.
Do not delay or reroute attack commands/rule resolution for artwork.

Unsupported variant-only creatures: intentionally retain classic counters with a
clear capability note/title; do not pretend missing art exists. Missing/broken
assets for a supported creature must be visible through the existing App notice
surface, not a silent unknown-image fallback. Loading should be lazy/on-demand;
classic mode must not fetch the new sprite atlases.

Use manifest.json and each creature's animation.json as the actual timeline and
grid source. New assets live outside public/variants (generated files overwritten
by convert). A compact validated registry may be generated into TS/JSON. PNG or
lossless WebP are both fine. Preserve accepted artwork; no new image generation
or hand repainting. The Dragon folder has different metadata shape: normalize it
deliberately, validate all 24 names and timeline sizes. Add the registry-generation
script if needed, with reproducible source/provenance notes.

## Verification and docs
Add meaningful tests for preference/default/storage/validation; atlas coverage and
timelines; classic rendering path; move/rest/one-shot attack lifecycle incl.
pending->settled same ID, unrelated rerender, reduced-motion and teardown. Reuse
existing battle engine fixture helpers where needed; no second fixture framework.
The parent will independently verify actual battles in a browser and run the full
gate on the integrated tree. Keep test runs memory bounded; one full suite at a time.

Use C:\Program Files\Git\bin\bash.exe for scripts/gate.sh on this Windows host,
not WindowsApps bash (that is WSL). Install web dependencies with npm ci. Never
use npm run build/dev here: predev/build run convert and rewrite tracked variants.
Use the gate; NODE_OPTIONS=--max-old-space-size=1024 and bounded Vitest workers are
reasonable. /usr/bin/time may be absent: report peak NOT MEASURED honestly.
The dispatcher reconciled the board: exit 0, HEAD==origin/master; the Linux host
probes uptime/ps are unavailable in Git Bash, so those are not host evidence.

Run at least the cheap gate (exit 2 is only cheap, not full verified). Run your
focused behavioral tests through gate overrides if appropriate. Do not run a full
suite concurrently with another actor. Keep raw logs. You may run the full gate
yourself if needed; report exactly what ran. No gate is running now.

Update architecture seam rows, testing notes, board record, ledger row 18, and add
one 1.02 changelog entry dated 2026-10-29, in the same commit. Include COPIES line
in docs/report. Copy this brief into docs/briefs/animated-mode.md if useful.
Do not rewrite unrelated historical board/ledger content. If this brief is provably
wrong, report the evidence rather than implementing the flaw.

Report only on LANDING or BLOCKED: SHA, code/asset summary, gate codes/counts,
limitations, doc paths, COPIES line, and browser hooks/selectors the dispatcher
can use. Leave no running server/browser processes. No remote push/deployment.

## Dispatcher clarification, 2026-10-29

`web/src/engine/__tests__/deadStrikeback.test.ts` proves slain units remain on board and may legally Strikeback. “Stop animation on dead units” stops idle/move loops and existing animation; a new explicit legal Strikeback event may still play attacking once, with the dead marker retained. The presentation must not add a second rules guard.
