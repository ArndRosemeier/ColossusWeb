/**
 * The S8 browser check's OWN vitest config — see `gen-fixture-s8.test.ts`.
 *
 * Same rule as S6's: `vite.config.ts` includes only `src/**\/*.test.ts`, so the
 * gate never runs a file that writes to disk. Run it on purpose:
 *
 *     cd web && npx vitest run --config scripts/browser-check/vitest.config.s8.ts
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/browser-check/gen-fixture-s8.test.ts'],
    disableConsoleIntercept: true,
  },
})
