# Row27 — enlarge Animated main-board landscapes

Owner: “new board hexes are nice, but just scale graphics inside up so they actually basically fill hex. No big deal if something gets written on them. Right now too small.”

COPIES: 1 — ModernTerrainArt carries the single Animated main-board landscape layout; no per-terrain sizing policy.

Sole writer in `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\landscape-scale`, branch `codex/landscape-scale-writer`, base published master `f542f4d7084450503ce8eecf59374d9020c39f3f`. Ledger row27. Read AGENTS/architecture first; no further agents, push/merge/deploy. If this brief proves wrong, report BLOCKED with evidence rather than shipping a visibly wrong result.

Only product source change is existing ModernTerrainArt in ModernBoardArt.tsx. The48×34 meet viewport currently makes the square artwork only34SVG units wide inside an84×72.75 hex. Enlarge to a96-square viewport at scale14 (`scale * 48 / 7`), centered on actual hex center `(cx+scale, cy+1.5*sqrt(3)*scale)`, fixed96-square viewBox/image and ground pivot48/87. Existing outer hex clip trims overspill. Labels, gates, markers and click authority remain above the art/in their original positions. The owner explicitly permits labels overlapping the enlarged illustration. Keep existing motion/reduced-motion/error handling; no new art bytes, per-terrain policy, battle-cell, marker, gate, camera, engine or other subsystem changes.

Add one next release1.04 entry dated2026-10-29 above published1.03. Update current modern-board design dimensions, ledger27, board and testing evidence. No new tests for this simple presentation resize; writer runs cheap gate only with NODE_OPTIONS1024 and retains raw log. Locked npmci if needed; no npmdev/build/convert. Parent owns existing full suite and real browser assessment/Classic parity. Commit clean locally and report LANDING/BLOCKED only, with COPIES/checks/log path; no continued processes.
