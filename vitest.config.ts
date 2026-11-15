import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20_000,
    // One file at a time: these suites all talk to the same remote Supabase instance, and running
    // them in parallel opens enough connections to exhaust the pool — every basic insert then
    // fails with "Failed query", which reads like a dozen real regressions but is just saturation.
    fileParallelism: false,
    hookTimeout: 60_000,
  },
})
