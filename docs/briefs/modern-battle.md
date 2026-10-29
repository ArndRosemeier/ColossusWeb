# Animated tactical battlelands — writer row25

Owner: “The battle lands could also use an overhaul in the animated version.”
Intent: modern tactical materials and readable terrain/height/hexside cues that fit
the new main board, with the original Classic experience and combat preserved.

Sole battle writer worktree:
`C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\modern-battle`,
branch `codex/modern-battle`, originally `d002136`, rebased onto dispatcher-verified
local base `6a6fe7407a9e0481fab89e1a12fe22091b074496`. Ledger row25. No push/deploy.
Mainboard sources, engine, networking, persistence, maps and creature events are
outside scope. A source conflict is BLOCKED; docs conflicts are mechanical union.

COPIES: 2→1 — battleEdgeGeometry owns side endpoints/tangents/inward normals for
Classic and Modern glyph styles; ModernBattleHex carries the sole modern cell path.

Use the eight supplied imagegen PNGs byte-for-byte in public/board-art/hazards-v1.
Draw Plains as ground and Tower as paving; Tower is not a turret. Abyss retains its
20 Tower rim cells at2, six Drift cells at1 and D4 Drift at0, plus both wall and river
on24 shared boundaries. Keep exact27-cell geometry, click handlers, highlighted/
entry cells, unit centers, staging, arrows and creature animations. Render obstacles
inside fixed clips; labels and hexside cues remain native and stationary. Include
readable coordinates/elevation, material labels and precise title text. A required
image failure reaches existing App.notify and marks the local cell. BASE_URL paths.

Writer owns focused pins and cheap gate, memory1024/maxWorkers1, raw logs and cleanup.
Dispatcher independently owns full suite, Classic pixels, real combat and responsive
Chrome. Existing1.03 entry receives one additional player line. Read AGENTS and
architecture; if any brief choice proves wrong, report BLOCKED with evidence rather
than implementing it. Land a coherent commit; cadence is LANDING or BLOCKED only.
