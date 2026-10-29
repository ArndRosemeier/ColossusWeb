# Row24 — modern Animated main board

Owner intent: “Any idea how to glow up the actual board in animated mode? Should not be too distracting, but i think it could get an update to make it look more modern. Only in animated though, purists should still get the old experience.” Follow-ups: “gates and arrows look pretty basic right now, less good than even in the original game. And i think we can do better. With everything.” And: “Oh yea, we did not touch legion markers yet. They are a remnant. They need to stay clearly coloured though.”

COPIES: 3→1 — MarkerArtwork carries Animated HTML/standing/moving legion art; MasterHexGates retains one shared alternating-edge mark enumeration and canonical geometry.

Sole writer: `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\modern-board`, branch `codex/modern-board`, base `d6a3a5b5f12cf0ea218c5e84e78333d4e6a4bed2`. Dispatcher is independent verifier. Local commit only; no push/deploy. This is the same unpublished1.03 entry; add a player change line, not another version. Ledger row24 assigned. Read AGENTS, architecture, gate row5 pins and docs/rules/README first. Report BLOCKED with evidence rather than implementing a provably wrong design.

## Scope and boundaries

Build a cohesive Animated main-board visual system: muted familiar terrain face colors with shared material gradients, all12 transparent landscape scenes, stationary readable native names/numbers, clearer selection/preview feedback and crafted metal/stone gate/arrow forms. Preserve all polygon points, coordinates, gate counts/directions, entrance/exit rules, marker footprint/stacking, original interaction authority and callbacks. Keep Classic exact original rendering. Reduced motion retains modern visuals but freezes ambient art; use existing preference and live reduced-motion seam. No timers, animation store, global motion, per-tile filters or noisy arrow marching.

Extend MasterHexGates with mode/defaultClassic rather than duplicating mark placement. Reuse gateLen, archGeometry, blockOutline and arrowTriple anchors; ARCH is rounded, BLOCK square, single arrow is1 head and triple is3. Animated paints gates once after all faces/highlights so later hexes cannot cover the neighbor-side half. Classic painter order stays per-hex. Decorations are pointerEvents none. Gate hook groups use data-gate-hex, data-gate-type, data-edge and data-direction; no duplicate interactive data-hex groups.

Fold MarkerChit and standing/moving board art through one pure vector renderer only in Animated. Exact PLAYER_COLORS ownership must dominate the face, including Black/Gold/Silver. Explicit owner color overrides the marker-ID prefix after capture. Print the full ID and derive any heraldry from the full ID, so same-owner Rd01 and captured Bu01 remain distinguishable. Keep legion-height count readable at28px with a separate contrasting badge and accessible full identity/count. Classic private canvas and original SVG leaves stay unchanged. Shared markers may naturally update setup/panels/battle sidebar; no battle-board or creature-event redesign.

The owner's later battle-land request is acknowledged but explicitly deferred to sequential row25 after this coherent slice; engine/net/save/variant integration and approved combat-animation events stay untouched.

## Assets and errors

Parent generated/visually approved the original sheet with built-in imagegen. Copy exact12PNG deliveries from `C:\Users\windo\Documents\ChatGPT\ColossusWeb\output\modern-board\terrain-v1` to `web/public/board-art/terrain-v1`: Abyss, Brush, Desert, Hills, Jungle, Marsh, Mountains, Plains, Swamp, Tower, Tundra, Woods. All256×256RGBA, total894571bytes, true alpha, no embedded text. Source sheet1448×1086; parent packaging uses measured transparent gutter crops/uniform scaling only. Preserve prompt/provenance/recipe under docs/design. URLs use BASE_URL, metadata registry has no external fetch. Known registered artwork failures must reach existing App.notify, using its scoped callback context, not disappear silently. Unknown/custom terrain has explicit Classic capability fallback.

## Verification and records

Writer runs cheap gate2 plus focused meaningful Vitest via gate (GATE_CHEAP_CMD=true, GATE_FULL_CMD selected relevant files, maxWorkers1, NODE_OPTIONS1024). Locked npmci allowed; no npmdev/build/convert. Raw logs stay in worktree.gate-logs. Check Classic roundtrip, original gate pins, actual arrow anchors/direction/count, all nine owner colors/captured fullIDs, stationary labels, registry/source hashes, live mode/reduced motion and required error delivery. Preserve original engine command pins. Parent owns integrated full suite, independent negative pin, real Chrome Classic pixel parity, layouts/marker palette and gameplay Move/Muster comparisons. Writer closes all browser/server processes before landing.

Update ARCHITECTURE, design/current presentation docs, TESTING, BOARD and ledger row24 plus1.03 player line in the same code/asset commit. No blanket replacement of old Classic assertions; explicit Classic remains required now Animated is the default.

Row24 follow-up: the independent full gate found an unseeded movement-die input in the existing destination-preview fixture. Writer fixed only that fixture, preserving real engine dispatch and strengthening equality against all engine-derived recruit destinations; see TESTING's follow-up record. Focused11 passed/gate0 and cheap2; integrated rerun remains owed.
