# Titan / Colossus rules references

Local copies for implementing and auditing the TypeScript port.

| File | Source |
|------|--------|
| [Titan-hexagonia.pdf](./Titan-hexagonia.pdf) | http://www.hexagonia.com/rules/Titan.pdf |
| [Titan-Law-of-Titan.pdf](./Titan-Law-of-Titan.pdf) | http://manutitan.free.fr/TitanRules.pdf |
| [Titan-UltraBoardGames.html](./Titan-UltraBoardGames.html) | https://www.ultraboardgames.com/titan/game-rules.php |
| [Titan-Engagements.html](./Titan-Engagements.html) | https://www.ultraboardgames.com/titan/engagements.php |

## Authority order for this port

1. **Colossus Java behavior** when it intentionally differs (e.g. one 8-high starting legion with Titan+Angel+6, then split on turn 1).
2. **Official Titan rules** for core mechanics (movement signs, muster only after moving, max 7 after start, angel acquire at 100/500, etc.).
3. MVP simplifications only where noted in code comments.

## Known Colossus vs board-game differences

- **Start:** Board game = two legions of 4 (Titan+3 / Angel+3), no split until turn 2. Colossus = one legion of 8; player splits in the opening Split phase.
- **Phases:** Commencement (Split) → Movement → Engagement → Enlistment (Muster).

## Battle timing (official Titan / Colossus)

- Each engagement lasts at most **7 battle turns** (`Variant.getMaxBattleTurns()` = 7).
- Defender maneuvers first each round (attacker first only in **Tower**).
- If the battle is not decided before turn 8 begins → **time-loss**: attacker’s legion is eliminated, defender survives and receives **no points**.

## Compliance matrix

See **[COMPLIANCE.md](./COMPLIANCE.md)** for the rule-by-rule audit (pass / partial / fail) and links to Vitest coverage under `web/src/engine/__tests__/rules-*.test.ts`.
