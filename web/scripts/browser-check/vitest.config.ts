/**
 * The browser check's OWN vitest config — see `gen-fixture.test.ts`.
 *
 * The app's config includes only `src/**​/*.test.ts`; this one exists so the
 * fixture generator can be run on purpose without the gate ever depending on a
 * file that writes to disk:
 *
 *     cd web && npx vitest run --config scripts/browser-check/vitest.config.ts
 *
 * The `root` is deliberately left as the config's own directory's package — the
 * web package — so the generator's relative imports resolve and the gate's own
 * `include` (`src/**​/*.test.ts`) is never touched.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/browser-check/gen-fixture.test.ts'],
    disableConsoleIntercept: true,
  },
})
