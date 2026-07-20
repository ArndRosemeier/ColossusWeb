import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

/** Prevent SPA HTML fallback for missing variant assets (avoids "broken" HTML-as-image). */
function noSpaFallbackForVariants(): Plugin {
  return {
    name: 'no-spa-fallback-variants',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith('/variants/')) {
          next()
          return
        }
        const filePath = path.join(server.config.root, 'public', decodeURIComponent(url))
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain')
          res.end('Not found')
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), noSpaFallbackForVariants()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Heavy AI batch lives under src/sim — run via `npm run simulate`
    exclude: ['src/sim/**'],
    disableConsoleIntercept: true,
  },
})
