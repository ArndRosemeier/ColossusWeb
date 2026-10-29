# Fresh winner celebration

Owner: “Also make a win celebration. Right now just a message.” Current scope is Animated; Classic keeps the existing header/message ending. Names identify the winner consistently for AI, remote and multiple local human seats.

COPIES: 1 — useVictoryCelebration is the one fresh-winner observer reached from App.putState's presentation fanout; the existing camera reports its actual lifetime instead of duplicating timing.

## Event and ordering

App.putState still commits game state immediately. Its existing presentation observer ref now fans out to camera and victory observers before the setter, with one shared GamePresentationObserver type. All local/remote paths and existing explicit replacement flags remain. useVictoryCelebration consumes only the first non-draw null→winner transition in a game. It consumes that event even in Classic, so later enabling Animated cannot replay it. Initial/finished loads and replacement/null clear pending UI and mark an already-ended game consumed. Dismissal clears only the pending presentation event; notices/duplicate adoption/rerenders cannot reopen it. Winner fields are read from current authoritative players, not an invented outcome copy. Missing winner references report through existing App.notify.

useBattleCamera now exposes active from outgoing capture through native finish/cancel/error/skip cleanup. A winning battle queues its event while active and mounts the dialog only after the actual overlay is removed. Resignation without a camera presents immediately. No second820ms timer, command delay or busy rule exists. Reduced-motion camera fade uses that same lifetime. UI state never enters saves/network snapshots or changes gameplay, outcome, score or AI.

## Presentation and access

VictoryCelebration uses local native SVG crown/medal/laurel/ribbon shapes, exact player color on its dominant face and name banner, and existing markerInk contrast selection for all nine hues including Black/Gold/Silver. Name and final score use real player metadata. Copper/obsidian styling fits the app's existing fonts and title palette; no new images, libraries or dependencies.

The native dialog has heading/score references, initial View final board focus and modal background isolation. Explicit Tab/Shift+Tab edge wrapping keeps focus cycling between its two native buttons (Chrome's default modal traversal briefly reached the document in the writer's initial browser check). Escape's native cancel, close and View final board all dismiss. Cleanup closes the native dialog and restores a still-connected enabled prior control, otherwise the existing header New game/Leave game button. No new-game callback/command is copied. The final board and normal header remain available after dismiss.

32 deterministic owner-color/gold/cream confetti pieces animate once with1450ms motion plus at most210ms stagger. One1800ms parent animation ends the burst and removes its DOM; individual piece-end events cannot remove it early. There are no JS animation timers/RAFs or repeated will-change. Live reduced motion removes particles immediately and preserves the card; initially reduced users see no particles and toggling back does not start a late burst. A native CSS reduced-motion safeguard also hides particles. Unchecking Animated, replacement/null and teardown remove the dialog and particles. The card itself stays still.

Native dialog failures dismiss and reach the same local App notice surface. Native platform focus/Tab/Escape behavior is exercised in Chrome, not inferred solely from a jsdom mock. No style changes affect Classic/in-game boards outside the scoped victory classes.

## Verification hooks and limits

`.victory-celebration[open][data-winner-id][data-owner-color][data-reduced-motion]`, `.victory-owner-face`, `.victory-winner-banner`, `.victory-score`, `.victory-confetti i`, `.victory-view-board`, `.victory-close`. Use native `:modal` for actual modal state; CSS confetti can be inspected through getAnimations while present. Camera hooks remain unchanged; its new active flag is the ordering seam.

Writer's 25 new tests cover actual engine resignation/battle wins, nine exact winner colors, immediate state bytes, no replay/load/draw/replacement, native camera finish/cancel, Classic/reduced/live mode, bounded particles, all dismiss routes, keyboard/focus and visible failure handling. Existing camera/combat animation tests run alongside them. jsdom stubs native dialog/animation APIs, flushes its zero-delay dialog-toggle bookkeeping during cleanup and declares standard AnimationEvent capability before React's vendor-prefix detection; it does not fake a second game or rule implementation.

Bounded writer Chrome checked fresh resignation, finished reload skip, Classic skip, native modal/focus/Tab/Escape, actual confetti ending,390px reduced layout and battle victory only after actual camera exit. Saved states exactly match unchanged engine dispatch; zero page errors. Screens/report/harness live in writer .gate-logs/victory-* and use blocked WebSockets/finally cleanup. Initial fixture/event-support failures and the browser Tab finding are preserved in TESTING/raw logs. Parent owns complete suite, own negative, independent remote/responsive/video and publication checks.

Focus cleanup captures the existing header fallback element at modal effect setup, rather than reading a potentially changed ref during cleanup. This removes the new exhaustive-deps cleanup warning while retaining the browser-verified previous-control-or-header focus semantics.
