# Architecture — the seam index

The seam index answers *"how does this codebase work, and where is the ONE place that
does X?"* — the layer map, the seam rows, the gotchas and the known debt. It is what a
brief is scoped against and what a writer reads before touching an area.

The point of it: **duplication is invisible when a copy is BORN.** Nothing fails, and
each copy is correct where it was written. So the index is what makes "there is one way
to do this" a fact you can check rather than a thing everyone remembers.

> **Status: PARTIALLY SURVEYED.** The layer map below is taken from the project's own
> `web/README.md` (authored by the owner, not by an agent). **Section 2 is not yet
> surveyed** — no dispatcher session has walked `web/src` seam by seam. Treat a missing
> row as *unknown*, not as *absent*: do not cite this file as proof that a seam does not
> exist. Filling it in is legitimate work for a read-only probe.

## The rule

- **An index entry is CHECKABLE, never prose.** It names a seam and where it lives.
  "We agreed there is one way to do X" is not an entry; `escapeHtml — src/lib/text.ts:14`
  is.
- **Updated in the same commit as the change.** A landing that adds, moves or deletes a
  seam updates its row in that landing. An unamended seam is treated as missing.
- **A decision is history; a seam is the present.** Superseded decisions go to the
  [decision ledger](DECISION-LEDGER.md) and stay there.
- **The index does not restate behaviour.** Behaviour lives in a test. The row holds the
  pointer.
- **Obligation before the work:** when a change touches more than one site, or the same
  idea is found written twice, the FIRST examination is whether one seam can carry it —
  never how to fix each copy. The answer is written down in the brief and the landing as
  the `COPIES:` line (see [`BRIEF.md`](BRIEF.md)).

## 1 · Layer map

Two trees, one product. **`Colossus/` is not built here** — see `AGENTS.md §Host facts`.

| Path | What it is | May depend on |
| --- | --- | --- |
| `web/src/variant/` | board construction, ported from Java `MasterBoard` | `types` |
| `web/src/engine/` | game phases, movement, recruit, battle — the rules core | `variant`, `types` |
| `web/src/ai/` | random-legal + heuristic AI (move/battle/split evaluation, muster search) | `engine`, `variant` |
| `web/src/ui/` | non-React UI logic (dice physics, animation, path tween, speed) | `engine` |
| `web/src/components/` | React views (master board SVG, battle, controls, the online lobby) | `engine`, `ai`, `ui`, `net` |
| `web/src/persistence/` | save/load | `engine`, `types` |
| `web/src/net/` | online play over GameHub (`games.futuremagic.de`): the ONE live connection (`session.ts`), the host's pure rules (`room.ts`), turn sync (`sync.ts`), the local identity and saved copy — no socket outside `session.ts` | `types`, `persistence` (the ONE save serialiser), `engine` (adoption recomputes the derived `legalHexes` through `GameEngine.getMovesForSelected`) |
| `web/src/sim/` | headless simulations + tournaments (`npm run simulate`, `tourney`) | `engine`, `ai`, `variant` |
| `web/public/variants/**` | **generated + tracked** variant JSON (see `AGENTS.md` fact 3) | — |
| `Colossus/**` | original Java implementation — **reference only, not buildable here** | — |
| `docs/rules/` | authoritative rules references + the project's own `COMPLIANCE.md` matrix | — |

Dependency direction is asserted from `web/README.md` and directory shape, **not** yet
verified by import analysis. Verify before relying on it.

**The state-flow direction (one arrow each way, and they meet at one setter).**

```
board input ─▶ commitPath.local(reducer, command) ─▶ putState(next) ─▶ session.commit ─▶ host
                                                        ▲                                  │ hostHandle (room.ts)
host's setState ─▶ session (adoptSeq) ─▶ commitPath.remote(blob) ─▶ adopt(state) ─────┘ ◀──┘
```

A LOCAL command and a REMOTE adoption both end at the same `putState`; only the
local side sends. `App.tsx` has no other write to the game state, so "no path
changes state without sending" is structural rather than a convention.

**One host, everyone mirrors (GameHub).** GameHub is a relay that never reads our
state. The room's HOST holds the authoritative `RoomWorld` (lobby members, seats,
`rev`, and the game in the save format) and publishes it with `setState`; every
other client mirrors it and sends INTENTS (`hello`, `leave`, `commit`). The host
runs `room.ts`'s pure `hostHandle` on each intent — the SAME `actingPlayerIds` the
board uses decides whether a move is accepted, and a move names the `rev` it was
built on, so a move built on an old state is refused (`stale_move`) rather than
silently overwriting. When the host leaves, GameHub promotes another player, who
continues from its copy. Nothing is polled: the server pushes.

**Seats are tokens, the game outlives the room.** A GameHub player id lives for one
socket, so a seat is bound to the browser's stable token (`identity.ts`). Every
client keeps its latest world in `localStorage` (`activeGame.ts`); GameHub deletes
an empty room after 60 s, and any seated player can then re-open the game in a new
room — the others find it in the lobby by `gameId`, and a rejoiner holding a newer
copy hands it to the host (`send-backup`).

## 2 · The one way to do X

| Seam | The ONE way | Where | Notes |
| --- | --- | --- | --- |
| Master-hex gate shapes and placement | `MasterHexGates` → `GateShape` or `ModernGateShape`; `archGeometry` / `blockOutline` / `arrowTriple` / `gateLen` / `pts` | `web/src/components/MasterHexGates.tsx`, `ModernGateShape.tsx`, `gateGeometry.ts` | ONE alternating-edge mark enumeration for both modes. Pure canonical geometry is ported from GUIMasterHex.drawGate(). ARCH stays rounded, BLOCK square, arrows retain direction and 1/3 heads. Classic per-hex painter order is unchanged; Animated paints one final decorative gate layer above all faces, below legions. Existing masterHexGates.test.ts and modernBoard.test.ts pin both dispatch/geometry; ledger rows5/24. |
| The game server's address and app key | `hubConfig()` (`VITE_GAMEHUB_URL` / `VITE_GAMEHUB_APP` / `VITE_GAMEHUB_KEY`, or `VITE_GAMEHUB_ACCESS=1`) | `web/src/net/hubConfig.ts` | The ONE place it is decided. The key is not a secret (it ships in the bundle). A build without one is a LOUD `hub_not_configured` the moment online play is used, never an unexplained socket failure. |
| The live connection | `HubSession` (`start` / `create` / `join` / `leave` / `reopen` / `startGame` / `commit`, plus `subscribe`/`getSnapshot` for React) | `web/src/net/session.ts` | The ONLY code that touches the GameHub client (`gamehub.ts`, copied verbatim from the gameserver repo). Owned by `App` (one per app life, no socket until used), so it outlives the setup screen. Reconnects with backoff and rejoins its room; re-sends a move that died with the old host. `session.test.ts` drives it end to end over `__tests__/fakeHub.ts`. |
| The host's rules | `hostHandle` / `startWorld` / `startRefusal` / `hostDisconnect` / `hostReconcile` / `parseWorld` | `web/src/net/room.ts` | PURE. Who may join (`game_full`), who may move (`not_seated` / `not_your_turn` / `stale_move`), seats in join order at Start, presence per member, the newer-backup rule. A world that does not parse is `bad_world`, never an empty game. |
| Who this browser is | `loadLocalPlayer` / `saveLocalPlayerName` (`colossusweb.player.v1`) | `web/src/net/identity.ts` | A random stable token plus a display name; no key, no account. A corrupt entry is LOUD (`bad_identity`), never silently replaced, because replacing it would cost the player their seats. |
| The game to resume | `rememberActiveGame` / `readActiveGame` / `forgetActiveGame` (`colossusweb.online.v1`) | `web/src/net/activeGame.ts` | The last room code AND the latest world, written on every change. A reload rejoins that room; when the room is gone the lobby offers Re-open from this copy. Removes the ServerStore-era keys on first read. |
| A failure → the screen | `NetError` + `describeFailure` (title + the code and message, verbatim) | `web/src/net/failure.ts` | The ONE mapping; `LobbyPanel` and `MultiplayerStatus` render its result and neither invents a message. |
| A local state change | `createCommitPath` (`local` / `remote`) | `web/src/net/sync.ts` | The ONE path a command takes. `local` updates state AND sends it (through a `MoveSink`) for a shared command; UI-only selection and a pending physical throw send nothing. `remote` adopts through the same seam and NEVER sends. |
| Adopting a remote state | `adopt` + `LOCAL_UI_FIELDS` | `web/src/net/sync.ts` | `deserializeGame` (the ONE deserialiser — migration included) plus the local UI-only fields. **Before preserving ANY field across an adoption, ask whether it is DERIVED** — `legalHexes` is, and is recomputed through `getMovesForSelected` (ledger row 12). Same question for `diceRoll`, `pendingDice`, `message`, `pendingEngagements`. |
| The cued.de player | `readCuedPlayer` / `cuedPlayerName` / `cuedRoom` (+ `cued.ts`, copied from the gameserver repo) | `web/src/net/cuedPlayer.ts` | The ONE reader of `#cued=<pass>`, read once in `App`. DISPLAY only (the badge, the online name): the browser cannot verify the pass. A bad pass is `bad_cued_pass` on screen; an expired one names nobody. `CuedBadge` renders it. |
| The online status line | `MultiplayerStatus` (seat, turn, read-only, room/host, away players, failure) | `web/src/components/MultiplayerStatus.tsx` | Presentational, checkable with `react-dom/server`. |
| Whose turn it is | `actingPlayerIds` / `isMyTurn` | `web/src/net/sync.ts` | The ONE turn-authority predicate, and it is the STATE's answer, not a claim: the active seat, the battle step's `activePlayerId`, the thrower of a pending physical roll, the defender awaiting a post-battle reinforcement, or BOTH parties to a pre-battle engagement. It feeds the board's `interactive` flag; the engine's own refusal is the backstop. **Paint, click and `interactive` are the SAME decision:** `App.tsx` computes `canAct` from this predicate and BOTH the painted fields (`MasterBoardView`) and the click verdict read that one value through `ui/boardInteraction.ts` — two authorities here was S7 (ledger row 13). |
| Who may answer an ENGAGEMENT, and when a battle may begin | `canStartBattleFromEngagement` + `EngagementOffer.fleeDeclined` + `standFight` | `web/src/engine/GameEngine.ts`, `web/src/engine/types.ts` | The ONE seam a battle can begin from: `startBattleFromEngagement` refuses while the DEFENDER's window is open, so no caller can skip it. The rule (Titan Engagements; Colossus `GameServerSide.java:2719-2728 → :2747-2754 → :2792-2805 → :2866`): the defender may immediately flee (the attacker may not, and a Lord blocks it), and *either player may demand battle* only after that window closes. `standFight` is the defender's own answer and awards nothing. **The seat question is separate and lives in the UI**: the engine's only notion of a seat here is the ATTACKER (`activePlayer`), so `BoardDecisionOverlay` takes `myPlayerId` and shows each side's controls only to the client that holds it (`localControls`; hotseat passes `null` and holds both). S7's `actingPlayerIds` is NOT widened — both parties to an engagement may still act, and a spectator still may not. |
| Who has LEFT the game, and whether the game is over | `eliminatePlayer` + `checkTitanDeath(state, slayerId, resigned?)` | `web/src/engine/battle.ts` | The ONE end-of-a-player body and the ONE game-over ending. A Titan death and a RESIGNATION (`resign`, `GameEngine.doResign`) both route through `eliminatePlayer` — every legion leaves the board, an ENGAGED leftover gives half its value to the enemy on its hex, an unengaged one gives half to the `slayer` (and nothing when there is none, which is a withdrawal's case: `PlayerServerSide.java:606-661`). `resigned` only changes the REASON in the log, never the board effect; `checkTitanDeath` returns whether the game ENDED here (one survivor wins, zero is a draw) so a caller does not carry on with the turn. `resignRefusalReason` / `canResign` are the ONE wording of WHEN giving up is refused (a battle, the engagement window, a pending throw, a post-battle reinforcement) — the UI's button and the engine's refusal both read it. |
| Who may act ON THE BOARD (what is painted + what a click does) | `boardInteraction` / `boardClickVerdict` / `boardBlockedReason` | `web/src/ui/boardInteraction.ts` | The ONE place that decides which fields the board PAINTS and what a click ACCEPTS, both from the same `canAct`. `canAct === false` (spectator, the other seat's turn, an AI playing) paints NO actionable field and a click is REFUSED with a sentence on the ONE message surface (the LOCAL_ONLY `notice` command) — never a silent deselect. An inspected OPPONENT's legion is painted as a PREVIEW (cyan, each field's cheapest roll 1–6) and its fields are refused, never destinations; a plain hex is still the deselect gesture. `boardInteraction.test.ts` pins painted == accepted across own/opponent/not-my-turn/nothing-selected/a non-Move phase, and the browser check drives it on the owner's own chain. |
| Application presentation preference | `getPresentationMode` / `setPresentationMode` / `usePresentationMode` | `web/src/ui/presentationMode.ts`, `components/PresentationModeToggle.tsx` | One native Animated mode checkbox in title navigation and game toolbar shares local classic/animated storage. Animated defaults for absent/invalid/unavailable optional storage; explicit Classic is preserved. Static snapshots use the same getter. Outside game/save/network state. |
| Main-board / battle camera boundary | `useBattleCamera` → `battleCameraBoundary` / `battleCameraFocus` → `showBattleCamera` | `web/src/ui/useBattleCamera.ts`, `battleCamera.ts`, `battleCameraOverlay.ts`, `battleCamera.css`; `components/App.tsx` | ONE observer before putState captures revealed outgoing SVG; layout commit captures real incoming SVG. Local/remote state commits remain immediate. Animated zoom/turn/crossfade reverses on exit; Classic instant, reduced150ms fade. Shared active flag covers capture through native finish/cancel/error; victory waits on that actual lifetime, not another timer. Namespaced inert snapshots, cleanup/no RAF/timers/engine state; replacement reset. Errors use existing notify. battleCamera.test.ts; design/battle-camera.md; ledger26/32. |
| Fresh winner celebration | `useVictoryCelebration` → `VictoryCelebration`; `GamePresentationObserver` | `web/src/ui/useVictoryCelebration.ts`, `gamePresentation.ts`, `components/VictoryCelebration.tsx`, `victoryCelebration.css`; App.putState presentation fanout | ONE winner observer across local/remote commits; records event even in Classic, skips finished loads/draws/replacement replay. Animated native dialog after camera.active clears, exact player color/name/score and bounded CSS confetti; reduced still. Native modal plus explicit Tab-edge/Escape/dismiss/focus restoration, existing header New game reused. UI-only pending event, no commands/save/network/AI changes. victoryCelebration.test.ts; design/victory-celebration.md; ledger32. |
| Battle creature presentation | `BattleCreature` → `CreaturePresentation` | `web/src/components/BattleCreature.tsx`, `AnimatedCreature.tsx`, `BattleBoardView.tsx` | ONE battle event/orientation adapter for on-board, staging and positional-overlay slots. General artwork policy is CreaturePresentation; classic leaf and variant capability fallback are shared with all other creature uses. Accepted metadata/PNG provenance: `docs/design/animated-presentation.md`. |
| Tactical battleland presentation | `ModernBattleHex` / `ModernBattleDefs`; `battleSurface` / `battleHazardUrl`; `battleEdgeGeometry` | `web/src/components/ModernBattleHex.tsx`, `modernBattle.css`, `BattleBoardView.tsx`, `web/src/ui/modernBattle.ts` | Animated materials consume actual built-cell terrain/elevation; eight bounded RGBA obstacles, native labels/height and distinct owner-side hexside cues. Classic retains original paint; both styles share endpoint/tangent/inward-normal geometry. Wall+river pairs remain separate. Required image errors reach existing App.notify and mark the local cell. Geometry, clicks, units and combat events remain engine-owned. modernBattle.test.ts; design/modern-battle.md; ledger25. |
| Creature sprite timelines and loads | `CREATURE_ANIMATIONS` / `loadCreatureAtlas` | `web/src/ui/creatureAnimations.ts`, generated `creatureAnimationRegistry.json`, `web/scripts/import-creature-animations.mjs` | 24 standard creatures, 72 byte-preserved PNG atlases outside generated variants; lazy requests, validated grids, visible App notice on supported asset errors. |
| Strike presentation event identity | `useBattleStrikePresentation` | `web/src/ui/battlePresentation.ts` | Pending physical and settled RNG/instant events share engine roll IDs; local start times prevent replay after rerenders/remounts. Reduced motion is live; visual timers never resolve attacks. |
| Main-board visual presentation | `ModernBoardDefs` / `ModernTerrainArt` / `ModernHexLabels`; `MODERN_TERRAINS`; `terrainMotionKind` / `terrainMotionTiming` | `web/src/components/ModernBoardArt.tsx`, `modernBoard.css`, `MasterBoardView.tsx`, `web/src/ui/modernBoard.ts`, `terrainMotion.ts` | Animated uses 12 registered transparent landscapes in one centered full-face square clipped to each hex (row27), shared gradients, fixed native labels/number pills and the existing art-only CSS motion. Live reduced motion retains modern art and freezes movement. Required art errors use App.notify through CreatureAssetErrorContext. Unknown terrain has explicit Classic capability fallback. Classic retains original direct MasterTerrainArt/SafeSvgImage; measured GIF-crop helpers remain pinned standalone. Design/provenance: docs/design/modern-board.md. |
| Movement-target recruit recommendation | `movementRecruitPreview` consuming `listRecruitOptionsAt` | `web/src/ui/movementRecruitPreview.ts`, `components/MasterBoardView.tsx` | ONE UI ranking for destination icons in both modes: power×skill +1flies +1rangestrikes; equal scores prefer skill, full ties retain first legal order. Engine owns eligibility/caretaker/capacity. AI/Enter/current-hex/pending muster keep existing strategic scorer. Invalid candidate metadata throws. ui movementRecruitPreview.test.ts and component creatureTokens.test.ts; design/movement-recruit-preview.md; ledger31. |
| Legion marker artwork | `MarkerArtwork` via `MarkerChit` / standing board / `MasterAnimOverlay` | `web/src/components/MarkerArtwork.tsx`, `MarkerChit.tsx`, `MasterBoardView.tsx`, `web/src/ui/markerArtwork.ts` | ONE Animated pure-vector body uses exact owning-player color, contrasting full-ID crest/text and separate count. Explicit owner color wins over captured marker prefix. Main-board markerCenter shares standing/movement/popup anchors; one board-only tokenScale now grows Animated markers/muster icons44% over the original baseline (another20% on the row28 sizes), preserving the original bottom edge (row30). HTML sizes, Classic canvas and original SVG leaves stay unchanged. modernBoard.test.ts pins nine colors, capture identity, count and Classic roundtrip. |
| Revealed creature artwork throughout the app | `useCreaturePresentation` / `CreaturePresentation` / `BoardCreatureIcon` | `web/src/ui/creaturePresentation.ts`, `web/src/components/CreaturePresentation.tsx`, `BoardCreatureIcon.tsx`, `AnimatedCreature.tsx` | ONE classic/approved/unsupported policy across all HTML callers, BattleCreature and three board muster SVG sites. App provides its existing notify callback via CreatureAssetErrorContext; no second error UI/store. UnknownChit and player markers remain outside the seam. Tiny art-only icons require no invented stats; larger labels scale from existing 28px battle sizes. |
| Title screen and local setup | `SetupScreen` / `VARIANT_META` | `web/src/components/SetupScreen.tsx`, `web/src/components/setup.css` | ONE setup controller retains caps/cappedRows/player payload and always-mounted LobbyPanel. Full-width local decorative hero uses BASE_URL; saved entry calls existing continue callback. Setup-only styles replace obsolete narrow rules while retaining shared game/lobby declarations. Asset/prompt provenance: `docs/design/title-screen.md`. |
| *(rest not yet surveyed)* | | | |

## 3 · Gotchas

- **`npm run convert` regenerates TRACKED files.** `web/public/variants/**` (1372 paths)
  is build output that lives in git, produced by `web/scripts/convert-variant.mjs` from
  `Colossus/variants/*.xml`. It looks like source; it is not. Editing it by hand creates
  a change the next `convert` silently reverts.
- **The build the gate makes is NOT the build that gets deployed.** `web/vite.config.ts:33` is
  `base: process.env.COLOSSUS_BASE ?? '/'`. The gate's cheap tier builds with the default `/`,
  but the app is served under the subpath `/ColossusWeb/`, so publishing requires
  `COLOSSUS_BASE=/ColossusWeb/`. A root-absolute base-`/` build served under a subpath renders a
  **BLANK page**, and **the gate would not catch it** — the two artifacts differ only in this env
  var. Always verify with `grep -o '/ColossusWeb/assets/[^"]*' web/dist/index.html` before
  publishing.
- **`GameState.turnNumber` is the ROUND, not one player's turn.** `GameEngine.ts:1137`
  (`advanceToNextLivingPlayer`) increments it only when the active seat wraps past the
  last, so in a 3-player game `activePlayerIndex` runs 0 → 1 → 2 while `turnNumber`
  stays 1 (measured with a probe, 2026-09-28). Anything that orders or timestamps
  per-player turns must NOT use `turnNumber` alone — online play orders moves by
  the room's own `rev` counter (`net/room.ts`) for exactly this reason.
- **The rules test suite is organised by rule family, not by module.**
  `web/src/engine/__tests__/rules-*.test.ts` and `docs/rules/COMPLIANCE.md` are the
  project's own coverage map — check it before writing a new rules test, so a second
  fixture set is not born.

## 4 · Known debt

- **This index is not surveyed** (section 2 empty). Cost: briefs cannot name a seam from
  the index and must name `file:line` directly. A fix is a read-only probe over
  `web/src/**` producing rows.
- **The Java reference has no compile check on this host.** Cost: a "port matches Java"
  claim rests on reading source, not on execution. See `AGENTS.md §Host facts`.
- **No pin covers the deployed subpath build.** Cost: a change that breaks
  `COLOSSUS_BASE=/ColossusWeb/` (or a base regression) passes the gate and ships a blank page;
  only the pre-publish `grep` above catches it. A fix would run the subpath build in the gate.
- **`deploy-sync.ps1` / `deploy-clean.ps1` are dead and misleading.** They still FTP to the
  retired `www.futuremagic.de` host (Migration README retirement item 6), and `BUILD.md` / `README.md`
  still describe `ant` builds that cannot run here. Cost: a new contributor follows them into a
  dead target.
