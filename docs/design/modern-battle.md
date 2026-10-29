# Animated tactical battleland presentation

Owner: “The battle lands could also use an overhaul in the animated version.”

COPIES: 2→1 — battleEdgeGeometry owns side endpoints/tangents/inward normals for
Classic and Modern glyph styles; ModernBattleHex carries the sole modern cell path.

The renderer consumes `battleLand(state,battle)` as before. Its built cells, not the
masterboard theme, determine each tactical material. There are27 flat-top cells,
scale14, width56 and height28√3. Their centers, polygon vertices, click groups, entry
lists, highlighted labels, unit/staging foreignObjects, attack arrows and positional
move overlay are unchanged. No command, rule, map, serializer or network code changes.

`BattleBoardView` retains the original Classic paint fragment and its direct legacy
SafeSvgImage leaves. Modern mode uses `ModernBattleHex`, `ModernBattleDefs` and scoped
modernBattle.css. Both hexside styles use the same pure owner-side edge geometry;
Classic marks retain the original expressions and paint. Modern uses triangular
cliff teeth, rectangular wall blocks, dune curves, slope hatches and blue river
strokes. All retain their owning side/inward normal. Rivers offset2.4 units into
their owning cell so a wall on the opposite side remains visible. No physical edge
deduplication discards a second hazard.

Material gradients retain terrain hue while elevation adds restrained light. Ground
grain and Tower paving are native vectors. Plains and Tower need no image. Eight
bounded illustrations cover Brambles, Bog, Sand, Drift, Volcano, Lake, Tree and the
supported future/test Stone hazard. Nothing repeats the masterboard tower/chasm/
mountain vignettes as tactical obstacles. The cells keep the actual terrain name,
coordinate pill, numbered elevation circle and precise title; the key explains the
circle. Native entry/legal rims repaint above art. Images, labels, vectors and rims
are decorative/pointer-transparent; the original filled polygon remains hittable.

The registered PNGs are original built-in imagegen art supplied by the dispatcher,
256px RGBA,593328 bytes total. They are copied unchanged outside generated variants.
SHA/content boxes and source-sheet provenance are in
`public/board-art/hazards-v1/provenance.json`; exact prompt is generation-prompt.txt.
The source sheet/packaging script remain in the workspace output/modern-battle study.
Tests pin all eight supplied hashes/dimensions. Asset URLs use import.meta.env.BASE_URL.
A supported SVG image failure reports its precise path through the existing
BattleBoardView.onAssetError→App.notify path and marks that cell with “!”. It never
swaps a failed tactical hazard for Unknown creature art. Unregistered future terrain
uses a neutral vector material and its exact source name, without inventing an image.

No new CSS animation or frame timer is introduced. Reduced motion retains the same
modern terrain, labels and side marks, while the existing creature motion hook still
governs creature playback. This is an Animated presentation enhancement, not changed
terrain rules. Tower/Abyss differences remain especially important:

- Tower has six Tower cells at1 and its center at2; defender predeployment and first
  mover remain engine-owned.
- Abyss has20 Tower rim cells at2, six Drift pit cells at1, and D4 Drift at0. Its seven
  startlist cells and24 wall+river boundary pairs remain distinct and inspectable.

Hooks: `.battle-wrap[data-presentation]`, `[data-battle-hex][data-terrain][data-elevation]`,
`.modern-battle-coordinate`, `.modern-battle-elevation`, `.modern-battle-terrain-name`,
`[data-hazard][data-side]`, `.modern-battle-rim`, `[data-battle-art-error]`. Existing
`foreignObject[data-unit-id]`, `.bhex.lit` and move/strike hooks remain intact. Modern
clip/gradient IDs use a scoped React ID; Classic clip IDs/markup remain unchanged.

Writer test and preview evidence is in TESTING. Dispatcher full suite, independent
Classic pixel comparison and actual movement/strike checks remain required before
claiming independent verification or deployment.
