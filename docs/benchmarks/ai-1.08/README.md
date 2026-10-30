# AI strength: release 1.08

The new Hard AI won **60–37–3 against Normal** and **66–32–2 against the old AI**
in two separate 100-game comparisons. These are Default, two-player games with
Balanced/Random personalities and swapped seats for every seed.

| Candidate vs opponent | Wins | Losses | Draws | Score | Approx. paired 95% range |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hard 1.08 vs frozen Normal | 60 | 37 | 3 | 61.5% | 54–69% |
| Hard 1.08 vs old 1.07 AI | 66 | 32 | 2 | 67% | 57.5–76% |
| Normal control vs old 1.07 AI | 55 | 39 | 6 | 58% | 48–68% |

Score counts a draw as half a point. The two old-AI comparisons use the same
seed/seat pairs: **58% → 67% is a descriptive nine-percentage-point score gain**.
It is not an Elo estimate or an isolated measurement of any one feature. Historical
Normal used an earlier equivalent engine/controller revision and a shorter wall cap;
all games finished, so no cap awarded points or removed an unfinished game.

| Hard comparison | Balanced W–L–D | Random W–L–D |
| --- | ---: | ---: |
| vs Normal | 32–17–1 | 28–20–2 |
| vs old AI | 35–14–1 | 31–18–1 |

Random resolves an AI personality; it does not mean random legal play. These results
cover these conditions, not other variants, multiplayer, human opponents or universal
playing strength. The approximate ranges use 10,000 stratified seed-pair bootstrap
resamples. Swapped seats remain paired.

## What changed

- Shared safety compares optional seven-high splits with keeping the legion together,
  considers both resulting legions and their real movement routes, and protects
  developed creatures and Titans. Available caretaker stock and real support donors matter.
- Hard looks ahead through future movement/recruiting opportunities, including legal
  HOLD/helper choices and shared stock. Completed comparisons remain usable when a
  later optional branch exhausts its budget; incomplete actual controls retain Normal.
- Tactical decisions use exact strike/kill/carry expectations, legal enemy responses,
  Titan/terrain/clock safeguards and bounded actual-engine combat samples. Complete
  formations can clear blockers before stronger creatures move. Reinforcements and
  summons inside the search use the same engine authority and support policy as live play.
- Power × skill remains the creature-strength baseline. Ordinary terminal material,
  healed survivors and outside donor losses share a consistent scale. A transferred
  Angel does not create free army material. No difficulty receives extra pieces,
  stronger dice or different rules.
- Easy/Normal/Hard are selectable per computer player, separately from personality
  and playback speed. Missing difficulty in older saves becomes Normal; malformed
  explicit settings are reported visibly.

## Verification and provenance

The shipped `web/src` tree exactly matches tested candidate
`e35192ae4189f716f774f6b16f567a26ac929516`:
`638566160f5d6b77329a58c47d744dfb47d80741`.

The independent full gate passed **700 tests**, with two existing todo tests,
84 passed files and one skipped file. Node heap 1024 MB / one Vitest worker; peak memory
was not measured because the host lacks the timer. Independent physical fault
injections fail when complete-maneuver wiring, donor accounting or completed-proof
wiring are removed, and pass after exact restoration. Production Chrome checks cover
real paused AI actions, complete saved-state equality to engine dispatch, setup,
legacy saves, visible invalid-save errors,360px layout and served build hashes.
Bounded variant/multiplayer checks found no invariant violations; their caps are
stability checks, not strength evidence.

Both final endpoints contain 100 finished games, zero errors and zero caps. Every
eligible Normal decision in the Hard/Normal endpoint was replayed against current
Normal: **43,039 commands and exact RNG consumption matched**. Old and Normal
controllers import complete isolated source snapshots. Choice RNG is separate per
seat and from world dice. Each defender owns flee/stand; the closed pre-battle
transition is neutral. See [the protocol and commands](PROTOCOL.md).

A common-state larger-budget census completed more plans but was not adopted as a
playing-strength improvement. Its isolated experimental build hit four old budget
exhaustion diagnostics; no experimental match results were produced. The owner asked
to finish with the verified version. Its constants were restored exactly, with no
assertion weakening or experimental product code included in this release.

## Data and reproduction

[Machine summaries](results.json) link every raw profile file. The `data/` directory
contains both final endpoints, the historical Normal/old control, earlier inconclusive
100-game candidates and the 32-game development comparison. Earlier candidates scored
55–44–1 and 51–48–1 against Normal; they are recorded separately and never pooled with
the released candidate. Interrupted or withdrawn mixed-controller v1 runs are excluded.

The scripts in [`scripts/ai-benchmark`](../../../scripts/ai-benchmark) reconstruct
frozen sources from Git and rerun comparisons without Java or browser dependencies.
The actual endpoint harness SHA256 is
`5963181b5ac609fd0780a38ddead31e7f3c2f80f266e64c0cd2dfed47ca7d0d4`.
Every raw endpoint records the source commit/tree, harness hash, caps, seeds and
per-game metrics. Node latency is an observation rather than a browser guarantee.
