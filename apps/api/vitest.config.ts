import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each test file builds a fresh in-memory Postgres and registers users, which takes a few seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
