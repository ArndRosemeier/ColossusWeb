# Additional variant creature studies

Owner: “in parallel you can start animating the remaining pieces for the other game modes.” Created in parallel with the full-width title-screen work; this deliverable changes no production registry/assets or game code.

The14 additional types are AirElemental, Balrog, Chimera, Druid, EarthElemental, Ent, FireElemental, Jabberwok, Knight, Mammoth, Manticore, Salamander, WaterElemental and Wraith. All14 occur in Abyssal3/6/9; ExtTitan reuses10. Standard24 were not regenerated.

Workspace deliverables (relative to repository root):

- `../output/variant-creature-collection/preview.html`: self-contained offline review gallery, three states and48px counter views.
- `../output/variant-creature-collection/index.html`: local-file gallery.
- `../output/variant-creature-collection/collection-overview.png`: roster overview.
- `../output/variant-titan-creatures-full-color.zip`:65.4MiB review package.
- `../output/variant-creature-collection/{QA.md,README.txt,manifest.json,atlas-provenance.json}`: inventory, decisions and source metadata.
- `../output/variant-creature-collection/{generation-prompts.json,generation-provenance.json}`: complete initial/revision prompts and built-in image_gen provenance. No CLI fallback used.

Output contains42 PNG atlases (1024×512, eight256px slots/state),84 state GIFs at full/counter sizes and comparison previews. Resting3.6s, moving1.8s, attacking3.6s including ready hold; attacking is intended as an event one-shot when integrated.

Original whole-frame illustrations were cut at measured white gutters, retaining complete figure pixels with a common scale. This fixes nominal-grid crossings such as Wraith tails. Metadata records sourceBoxes/contentBoxes and explicit held/reordered phases. Knight and Salamander revisions and omitted touching source poses remain documented. Shipped Abyssal Knight glyph is blank; the checked-in Java Unified Knight provided a clear standing armored reference, preserving an on-foot identity rather than inventing a mounted figure.

Independent dispatcher audit derived the exact inventory from shipped variant metadata and checked all336 final cells for nonblank/changing art, safe margins (minimum24px), correct GIF durations and all72 standard runtime atlas hashes. Independent actual Chrome rendered every timeline slot at full/counter sizes (672 canvas views), with no external requests, page errors or mobile overflow.

These are review artifacts, not yet integrated. The production importer deliberately validates exactly24 names today. Integrating later should broaden it and its provenance/coverage to the union38 while preserving approved bytes; the shared renderer already supports arbitrary registered names. Source format and genuine unsupported fallback should remain explicit.

COPIES: 1 — output-only creation reuses the approved full-frame collection method; no competing runtime renderer or animation store.
