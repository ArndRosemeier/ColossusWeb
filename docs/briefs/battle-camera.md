# Row26 — main-board / battle camera

Owner request recorded by dispatcher: “one more animation. The moment a battle starts ... main board zoom and turn into that hex, then becoming the battle land. And a zoom out at the end again.” Dispatcher promised a brief Animated camera move into the contested hex, reveal the actual battleland and reverse on exit; reduced motion uses a simple fade.

COPIES: 1 — checked, no duplication (grepped: App.putState, local/remote commit setters and visible battle branches); one useBattleCamera observer carries every visible boundary.

Sole camera writer worktree `C:\Users\windo\Documents\ChatGPT\ColossusWeb\source\worktrees\battle-camera`, branch `codex/battle-camera`, initially based on `6a6fe7407a9e0481fab89e1a12fe22091b074496`. Rebase before landing onto verified row25/dispatcher base `d11f23a0bf4be91e3fdfa2bb7ff090a1ea481b5f`; preserve rows24/25 by mechanical docs union only. No further agents, push or deploy. Non-docs conflict or a demonstrably wrong brief means stop and report BLOCKED with evidence and a better route. Read AGENTS, architecture and board first. Ledger row26; append to the same unpublished1.03 release, not1.04.

## Intent and seam

App currently renders one MasterBoardView or BattleBoardView according to `battle && !battle.done`. App.putState is the single game-state writer shared by local commits and remote adoptions. Observe that setter before DOM replacement to capture only the outgoing rendered SVG and contested-hex bounds; consume after the actual incoming board mounts. Keep the actual engine state, board, commands, save and network commit immediate. The animation is an inert visual overlay, not another rules state or distributed busy guard.

Animate a short spatial zoom/turn focused on the actual encounter hex, crossfade into the actual new battle SVG, reverse into the updated main board at the same hex on completion. Resolve location from battle participant legion IDs in old/new states, including an eliminated losing legion and final winner state. Ordinary moves/strikes/turns/duplicate adoptions do not replay. Direct active-battle loads have no invented source. Explicit new/load/online replacement and null reset cancel; fast coalesced boundaries that never paint skip cleanly. Classic has no overlay; live uncheck cancels. Reduced motion uses about150ms opacity only and a live preference change cancels motion. Resize, scroll, supersession and teardown must release all native animations/DOM/listeners; no RAF/timeouts or delayed engine commit.

Use sanitized clones of already-revealed native SVG/foreignObject art with unique IDs, inert/aria-hidden/pointer-transparent wrappers and no copied control targets. Preserve rendered canvas pixels for unsupported creature tokens without HTML rasterization. No external/new assets. Unexpected capture/animation failures must reach App's existing notice surface. Missing source geometry for direct load/hidden source is a legitimate skip. Avoid annotations growing over the landscape during zoom; a single quiet main-scene copy can dissolve native metadata early and restore it near the end of the reverse camera.

## Scope and verification

Only App integration and new camera hook/overlay/math/CSS/tests/docs/changelog. No BattleBoardView/ModernBattleHex, maps, engine, networking, persistence or asset edits. Row25's independent battle author remains disjoint and is integrated before landing.

Focused tests must use real engine encounter/battle/concede fixtures and pin boundary detection, exact spatial focus after rotation, immediate state/board commit, eliminated/final-game exit, mode/reduced motion, direct load/replacement, cancellation and safe snapshot references/errors. Writer runs locked npmci if needed, focused gate0 with GATE_CHEAP_CMD=true and chosen Vitest maxWorkers1, NODE_OPTIONS1024, then cheap gate2. No npmdev/build/convert/full suite. Keep logs in worktree.gate-logs; close every process. Dispatcher owns integrated full suite, independent negative pin and actual Chrome local/remote/start/end/geometry/save comparisons and final video/responsive/production-base checks.

Update design/battle-camera, current animated design, architecture, TESTING, BOARD and ledger26 with evidence in the same local commit; final report LANDING or BLOCKED only.
