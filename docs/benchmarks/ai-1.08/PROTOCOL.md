# Reproducing the AI comparison

This benchmark measures finished games, not configured search budgets. Run it from
the repository root with Node and the locked `web/` dependencies installed. It needs
Git and `tar`; it does not need Java, a browser or Playwright.

## Fixed controllers

- Old AI: complete `web/src` snapshot at `1c39d623dbe6beeb024e806af30b7a85026ee936` (v1.07).
- Normal control: complete snapshot at `67bc699e4a6f4250abfa4b437b952115a60c2e26`.
- Earlier coordinated Hard candidate: `de6cdf15a93781e8ffa9a62d0824e30c1dd7e24c`.
  Its `web/src` tree is `6135da5c8809beefe2a910360a1f3a26a2ebb83f`.

All controller-relative imports resolve inside their own source snapshot. The current
engine supplies one common set of game rules. Its support-handler extraction is
verbatim equivalent to the old handler; independent full-dispatch comparisons cover
all four support commands. Every Normal decision in the Hard-versus-Normal cohort
is also replayed against current Normal on the exact consumed RNG tape: both command
and number of RNG calls must match.

The released completed-action candidate is
`e35192ae4189f716f774f6b16f567a26ac929516`; its source tree is
`638566160f5d6b77329a58c47d744dfb47d80741`. Additional common-state budget calibration
is a cost/completion experiment, not strength evidence.

## Match conditions

- Default variant, two players, identical starting resources and legal actions.
- Balanced and Random personalities, 25 seeds each, both seat assignments per seed:
  100 games per comparison. Random resolves an AI personality; it is not random legal play.
- Choice RNG is separate for each seat; combat/movement dice have a separate world
  stream. Hard simulation uses local deterministic RNG and cannot read future dice.
- Each controller owns its own flee/stand choice as defender. After standing, the
  pre-battle transition is neutral `fight`, with no controller or decision RNG call.
  Live battle commands always belong to the active battle player.
- The engine's automatic current-AI flee path is disabled by representing seats as
  human inside the engine; controller decision views still contain AI seats. This
  prevents accidentally applying the candidate policy to the old defender.
- Maximum 200 rounds, 20,000 commands and 90 seconds wall time per game. A capped
  game is unfinished, never a win or a draw. Any unfinished/error result fails the
  complete cohort; raw partial results remain available.
- Invariants are checked after every command. Forty unchanged fingerprints fail a
  game. Candidate source must match committed `web/src` bytes.
- All controllers see the same game state, including legion compositions accessible
  to the existing AI. These are not human-equivalent hidden-information results.

The earlier Normal-versus-old control used a 30-second wall limit rather than
90 seconds; all 100 games finished, so neither wall limit affected its outcomes.
It used engine67bc699 and the corrected v2 controller protocol; current v3 retains
that decision ownership and adds provenance/replay diagnostics.

## Predeclared seeds

`cohort.cjs` generates seed `start + 9973*i`, `i=0..24`, with both seats:

| Cohort | Balanced start | Random start | Opponent |
| --- | ---: | ---: | --- |
| final-normal (earlier candidate) | 3400003 | 3700007 | frozen Normal |
| confirmation-normal (coordinated candidate) | 4400009 | 4700017 | frozen Normal |
| confirmation-normal-next (completed actions) | 5400013 | 5700023 | frozen Normal |
| final-old (matched to Normal/old control) | 900013 | 1200011 | old AI |

The separate 32-game development screen uses eight seed pairs per personality,
starts 2400001/2700013. Do not pool different candidate versions or overlapping
cohorts. The confirmation seeds were reserved before examining the coordinated
candidate results. No code or HEAD changes occurred during either final comparison.

## Running

From a checkout of the candidate with installed `web/node_modules`, prepare the
complete frozen imports once:

```bash
node scripts/ai-benchmark/prepare-baselines.cjs
```

The preparation refuses to overwrite an existing snapshot. For historical candidate
reproduction, use a separate worktree at the candidate commit, set `AI_PROJECT` to
its absolute path, and invoke these scripts by their absolute paths from the current
checkout. The historical worktree needs its own installed `web/` dependencies.

Run one cohort through the shared gate (Git Bash also works on Windows):

```bash
NODE_OPTIONS=--max-old-space-size=1024 \
GATE_CHEAP_CMD='node --check scripts/ai-benchmark/matches.cjs' \
GATE_FULL_CMD='AI_COHORT_STAGE=confirmation-normal AI_COHORT_LABEL=reproduction-hard-normal node scripts/ai-benchmark/cohort.cjs' \
GATE_LOG_DIR=.gate-logs/reproduction-hard-normal \
bash scripts/gate.sh
```

For the old opponent, change the stage to `final-old` and use a new unique label.
The scripts refuse to overwrite cohort result files. Results go to
`<AI_PROJECT>/../output/ai-strength` (AI_PROJECT defaults to the current directory);
`AI_OUTPUT` can select another output directory for matches/cohorts.
`matches.cjs` also accepts individual profiles/seeds via its explicit `AI_*`
environment variables; the raw JSON records the complete conditions.

The recorded coordinated-candidate script and packaged `matches.cjs` are byte-identical;
its recorded SHA256 is `5963181b5ac609fd0780a38ddead31e7f3c2f80f266e64c0cd2dfed47ca7d0d4`.
The source commit/tree and harness hash are embedded in every result file. After a
source change, a new run is a new candidate even if the difficulty label is unchanged.

Summarize the two raw profile files, not the cohort manifest:

```bash
node scripts/ai-benchmark/summarize.cjs path/to/balanced.json path/to/random.json
```

Score is `(wins + 0.5*draws)/games`. The approximate 95% interval uses 10,000
stratified seed-pair bootstrap resamples, keeping swapped seats paired. It describes
uncertainty on these seeds/profiles; it is not Elo or a universal strength estimate.
Timing reports individual policy decisions, excluding verification replay; p95 is
reported separately by personality rather than averaged. Node timing is not a
browser latency guarantee.

## Scope and exclusions

These outcomes do not establish strength across other variants, multiplayer or
human opponents. Bounded variant/multiplayer games are stability checks only.
Constructed tactical regression wins prove the specific coordination mechanism,
not a tournament win rate. Earlier mixed-controller v1 results were withdrawn after
an ownership defect was found and are excluded. Corrected v2/v3 comparisons retain
the defender-owned protocol above.
