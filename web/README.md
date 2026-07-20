# Colossus Web

TypeScript browser port of Colossus (Titan). Local hotseat + AI, Default variant.

## Setup

```bash
npm install
npm run convert   # XML → JSON from ../Colossus/variants/Default
npm run dev
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run convert` | Build variant JSON into `public/variants/Default` |
| `npm run dev` | Dev server (runs convert first) |
| `npm test` | Engine / board unit tests |
| `npm run build` | Production build |

## Layout

- `src/variant` — board construction (ported from Java `MasterBoard`)
- `src/engine` — game phases, movement, recruit, battle
- `src/ai` — random-legal + SimpleAI heuristics
- `src/components` — React UI (master board SVG, battle, controls)
- `../Colossus` — original Java sources (reference only)
