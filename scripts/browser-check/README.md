# `scripts/browser-check/` — driving the REAL app in a REAL browser

**Why this exists.** Twice now, a fully green gate has hidden a defect that only a
browser could see: `fetch` held on an instance and called as a method (every browser
refuses with `Illegal invocation`, while every stub in the suite is
receiver-insensitive), and a lobby that subscribed to a no-op external store so every
poll tick's data was dropped. A DOM-free suite cannot see either. The rule this
encodes: **a UI behaviour is not proven until it has been observed in a browser.**

**Provenance.** These files are salvaged from the S4 writer's own scratch
(`worktrees/liveness/.browser-check/`, untracked) because they worked and are worth
keeping. They are an **unreviewed starting point**, not a finished tool: paths and
seeds are hard-coded to that slice's scenario, and nothing here is wired into the
gate. Treat it as a recipe to copy, not a command to trust.

- `cdp.py` — a small DevTools-Protocol driver (its own WebSocket; no library). The
  page gets WALL-CLOCK time, which `--dump-dom` does not: that dumps when the first
  paint settles, before the app's first fetch returns, so the lobby looks empty.
- `harness.py` / `run.sh` — render the built app against a seeded fake store.
- The Chrome tree is killed in `finally`, so it dies on the failure path too.

**The method that worked, and it is the point of the directory:** build the app with
`VITE_SERVERSTORE_URL` pointed at a fake store you control, drive the real UI over
CDP, and then **change the store from OUTSIDE the app** and observe the UI react with
no click, no refresh and no reload. That is how a two-browser scenario becomes one
browser plus one `PUT`.

**S5's check, and the second method (`s5-busy-wording.py`).** S4 answered the store
with a fake HTTP server on the same origin. S5 answers it with the DevTools Protocol's
`Fetch` domain instead: `Fetch.enable` on `https://store.futuremagic.de/*` and
`Fetch.fulfillRequest` for every paused request, so the app's own transport, poll loop
and React render are the code under test while the "store" is whatever this script
says it is. Run it after a build: `python3 scripts/browser-check/s5-busy-wording.py`
(it serves `web/dist` itself and exits non-zero, naming each failed statement). Exit 0
means the real DOM said `the store is busy — slowing down, retrying in 60s` after a
`429` that carried `Retry-After`, and that the FIRST listing on the wire was
`?prefix=game.` with the key in `Authorization` and nowhere else. Two traps cost a run
each and are already handled here: the store's CORS **preflight** must be answered by
the script (it is a request to the same origin, it carries no key, and a real store
never rate-limits one), and `Fetch.enable` must be armed BEFORE the first navigation
(the app validates a stored key the moment it mounts).
