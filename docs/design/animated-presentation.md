# Animated presentation — battles first

Owner intent: “Ok, nice. So, now establish an 'animated mode' (not touching the old way of fighting) and implement these animations into fights.” Follow-up: “i want to do more in animated mode, but fights are the first step”.

COPIES: 1 — checked, no duplication (grepped: CreatureChit, BattleAnimOverlay, pendingDice.strike, diceRoll.strike, backgroundAtmosphere); all three battle slots now route through BattleCreature, and strike identity through useBattleStrikePresentation.

`ui/presentationMode.ts` owns the application preference (`classic` / `animated`, localStorage key `colossus.presentationMode`). Setup and the game toolbar subscribe to the same store through `PresentationModeSelect`. Classic is the initial/default choice. Unknown saved preference values become classic; unavailable preference storage still permits a session choice. This value never enters GameState, save serialization, network traffic, commands or RNG. Future views can consume the same hook.

`BattleCreature` is the battle presentation boundary. Classic takes the existing `CreatureChit` path. Animated standard creatures use the reusable `AnimatedCreature`; variant-only creatures retain their classic counter and a title explaining the missing capability. The existing battle wrapper, target/selection markings, click handlers and dead cross remain in place. Animated attackers get a red side ring, defenders green; the illustration faces horizontally while all text stays upright. Classic attacker rotation is unchanged.

`useBattleStrikePresentation` observes pending physical dice and settled immediate/RNG dice. Engine roll IDs identify a strike across settlement, independently of selection and other renders. Each presentation records a local start time; remounting an illustration continues its event at the elapsed frame instead of replaying its windup. The renderer runs an attack once, then rests. It cancels existing frame timers on death, unmount, preference changes or reduced motion. A new explicit engine-authorized strike by an already slain unit still plays once: Titan permits dead Strikeback (`engine/__tests__/deadStrikeback.test.ts`). Its dead cross remains, and it returns to a still resting pose without an idle loop. Units removed by immediate engine resolution have no remaining on-board illustration to animate; artwork never holds up their removal. OS reduced motion displays resting frame zero and never starts a sprite timer. These visual effects do not dispatch attacks, wait for artwork before resolving strikes, or change rules.

Moving artwork rides the existing positional `BattleAnimOverlay` and `usePathTween` completion callback. Animated mode alone gives that overlay a minimum of 900 ms so several moving poses are readable. Live reduced motion completes an existing animated move on the next positional tick. Classic durations and the same eventual move command remain unchanged. AI “instant” continues to skip positional overlays as it did before.

## Assets and reproduction

The approved input is the owner's 2026-10-29 `output/creature-collection` directory, specifically its `manifest.json`, each creature's `animation.json`, and each state PNG atlas. Run from `web/`:

```powershell
node scripts/import-creature-animations.mjs 'C:\Users\windo\Documents\ChatGPT\ColossusWeb\output\creature-collection'
```

The importer requires exactly the 24 standard names, validates every timeline slot/duration and PNG grid dimensions, normalizes Dragon's older metadata shape explicitly, and copies the PNGs byte-for-byte. It generates `src/ui/creatureAnimationRegistry.json` and `public/creature-animations/provenance.json`, which records SHA-256 for the manifest, timeline inputs and every copied atlas. No images are generated, repainted, recompressed or taken from the generated `public/variants` tree. Dragon has twelve slots/state; the other creatures have eight. Held/resequenced poses and long attack holds come from metadata, not an invented uniform frame rate.

The 72 full-resolution approved PNGs occupy about 40.7 MB on disk. They are lazy browser requests for the creature/state currently displayed, cached by URL; classic mode requests none. The small registry is bundled as metadata. Supported atlas errors (including wrong dimensions) report the precise asset path through `App.notify`, the existing local-only notice surface, and show “Art unavailable” on the counter. There is no Unknown-art substitution for supported animated creatures. A later optimization may losslessly encode these PNGs if transfer size matters; preserving approved bytes was the deliberate choice for this first slice.

## Verification hooks

- Select `select[aria-label="Presentation mode"]`, or seed `localStorage['colossus.presentationMode']` before loading.
- `.battle-wrap[data-presentation="animated"]` identifies the consumer.
- `.animated-creature[data-creature][data-animation][data-frame]` exposes current art and timeline; `data-animation` is `resting`, `moving` or `attacking`.
- `foreignObject[data-unit-id]` identifies each board/staging/overlay unit. `.move-anim .animated-creature` is the existing moving overlay.
- `.battle-chit.animated-art.attacker` / `.defender` identify upright illustrated counters with side rings.
- Network requests contain `/creature-animations/`; classic should make zero such requests.
- Component tests reuse `engine/__tests__/helpers.ts` and `startBattle`, so the fixtures are actual game-engine battles.

Writer tests cover preference validation/storage, all atlas SHA/dimensions/timelines, lazy classic rendering, rest/move/attack lifecycle, pending-to-settled identity, immediate rolls, selection/click preservation, reduced motion, dead units, preference changes, StrictMode, remounts, teardown and asset failure reporting. `scripts/differential-animated-mode.sh` runs only under the shared gate lock; splitting a settled roll into a second identity must turn the pending-to-settled test red. Independent browser/combat comparison is complete on the integrated local branch: movement, normal strikes and dead Strikeback match unchanged-engine outcomes in both modes. Classic before/after screenshots are pixel-identical. The built production subpath also passed asset loading, preference persistence, mode switching, live reduced motion and precise asset failure reporting. See TESTING for evidence. This local verification does not claim deployment.
