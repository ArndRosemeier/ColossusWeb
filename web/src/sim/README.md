# AI game simulator

Runs all-AI games through the real engine to catch stuck states, thrown errors, and invariant violations.

```bash
cd web
npm run simulate
```

Environment variables:

| Variable | Default | Meaning |
|----------|---------|---------|
| `SIM_GAMES` | 50 | Number of games in the batch |
| `SIM_PLAYERS` | 2 | AI players per game (2–6) |
| `SIM_SEED` | 1000 | Base seed (game *i* uses `seed + i*9973`) |
| `SIM_MAX_TURNS` | 400 | Abort as `max_turns` if no winner |

PowerShell example:

```powershell
$env:SIM_GAMES='200'; $env:SIM_PLAYERS='4'; npm run simulate
```

Outcomes: `winner`, `draw`, `stuck`, `error`, `invariant`, `max_turns`, `max_steps`.  
Hard failures (`stuck` / `error` / `invariant` / `max_steps`) fail the test.  
`draw` (mutual Titan death) counts as a completed game. Soft `max_turns` timeouts should be rare (≤5%).

`npm test` does not run this batch (see `vitest.sim.config.ts`).
