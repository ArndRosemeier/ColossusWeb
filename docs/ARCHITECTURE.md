# Architecture — the seam index

The seam index answers *"how does this codebase work, and where is the ONE place that
does X?"* — the layer map, the seam rows, the gotchas and the known debt. It is what a
brief is scoped against and what a writer reads before touching an area.

The point of it: **duplication is invisible when a copy is BORN.** Nothing fails, and
each copy is correct where it was written. So the index is what makes "there is one way
to do this" a fact you can check rather than a thing everyone remembers.

> **Status: PARTIALLY SURVEYED.** The layer map below is taken from the project's own
> `web/README.md` (authored by the owner, not by an agent). **Section 2 is not yet
> surveyed** — no dispatcher session has walked `web/src` seam by seam. Treat a missing
> row as *unknown*, not as *absent*: do not cite this file as proof that a seam does not
> exist. Filling it in is legitimate work for a read-only probe.

## The rule

- **An index entry is CHECKABLE, never prose.** It names a seam and where it lives.
  "We agreed there is one way to do X" is not an entry; `escapeHtml — src/lib/text.ts:14`
  is.
- **Updated in the same commit as the change.** A landing that adds, moves or deletes a
  seam updates its row in that landing. An unamended seam is treated as missing.
- **A decision is history; a seam is the present.** Superseded decisions go to the
  [decision ledger](DECISION-LEDGER.md) and stay there.
- **The index does not restate behaviour.** Behaviour lives in a test. The row holds the
  pointer.
- **Obligation before the work:** when a change touches more than one site, or the same
  idea is found written twice, the FIRST examination is whether one seam can carry it —
  never how to fix each copy. The answer is written down in the brief and the landing as
  the `COPIES:` line (see [`BRIEF.md`](BRIEF.md)).

## 1 · Layer map

Two trees, one product. **`Colossus/` is not built here** — see `AGENTS.md §Host facts`.

| Path | What it is | May depend on |
| --- | --- | --- |
| `web/src/variant/` | board construction, ported from Java `MasterBoard` | `types` |
| `web/src/engine/` | game phases, movement, recruit, battle — the rules core | `variant`, `types` |
| `web/src/ai/` | random-legal + heuristic AI (move/battle/split evaluation, muster search) | `engine`, `variant` |
| `web/src/ui/` | non-React UI logic (dice physics, animation, path tween, speed) | `engine` |
| `web/src/components/` | React views (master board SVG, battle, controls) | `engine`, `ai`, `ui` |
| `web/src/persistence/` | save/load | `engine`, `types` |
| `web/src/sim/` | headless simulations + tournaments (`npm run simulate`, `tourney`) | `engine`, `ai`, `variant` |
| `web/public/variants/**` | **generated + tracked** variant JSON (see `AGENTS.md` fact 3) | — |
| `Colossus/**` | original Java implementation — **reference only, not buildable here** | — |
| `docs/rules/` | authoritative rules references + the project's own `COMPLIANCE.md` matrix | — |

Dependency direction is asserted from `web/README.md` and directory shape, **not** yet
verified by import analysis. Verify before relying on it.

## 2 · The one way to do X

| Seam | The ONE way | Where | Notes |
| --- | --- | --- | --- |
| Master-hex gate shapes | `archGeometry` / `blockOutline` / `arrowTriple` / `gateLen` / `pts` | `web/src/components/gateGeometry.ts` | Pure maths, **no React**, so it is directly testable and the component file exports components only. Ported from `GUIMasterHex.drawGate()`. **ARCH must stay a rounded cap + stem, never the BLOCK rectangle** — `masterHexGates.test.ts` pins both the geometry and the renderer's dispatch; see decision-ledger row 5. |
| *(rest not yet surveyed)* | | | |

## 3 · Gotchas

- **`npm run convert` regenerates TRACKED files.** `web/public/variants/**` (1372 paths)
  is build output that lives in git, produced by `web/scripts/convert-variant.mjs` from
  `Colossus/variants/*.xml`. It looks like source; it is not. Editing it by hand creates
  a change the next `convert` silently reverts.
- **The build the gate makes is NOT the build that gets deployed.** `web/vite.config.ts:33` is
  `base: process.env.COLOSSUS_BASE ?? '/'`. The gate's cheap tier builds with the default `/`,
  but the app is served under the subpath `/ColossusWeb/`, so publishing requires
  `COLOSSUS_BASE=/ColossusWeb/`. A root-absolute base-`/` build served under a subpath renders a
  **BLANK page**, and **the gate would not catch it** — the two artifacts differ only in this env
  var. Always verify with `grep -o '/ColossusWeb/assets/[^"]*' web/dist/index.html` before
  publishing.
- **The rules test suite is organised by rule family, not by module.**
  `web/src/engine/__tests__/rules-*.test.ts` and `docs/rules/COMPLIANCE.md` are the
  project's own coverage map — check it before writing a new rules test, so a second
  fixture set is not born.

## 4 · Known debt

- **This index is not surveyed** (section 2 empty). Cost: briefs cannot name a seam from
  the index and must name `file:line` directly. A fix is a read-only probe over
  `web/src/**` producing rows.
- **The Java reference has no compile check on this host.** Cost: a "port matches Java"
  claim rests on reading source, not on execution. See `AGENTS.md §Host facts`.
- **No pin covers the deployed subpath build.** Cost: a change that breaks
  `COLOSSUS_BASE=/ColossusWeb/` (or a base regression) passes the gate and ships a blank page;
  only the pre-publish `grep` above catches it. A fix would run the subpath build in the gate.
- **`deploy-sync.ps1` / `deploy-clean.ps1` are dead and misleading.** They still FTP to the
  retired `www.futuremagic.de` host (Migration README retirement item 6), and `BUILD.md` / `README.md`
  still describe `ant` builds that cannot run here. Cost: a new contributor follows them into a
  dead target.
