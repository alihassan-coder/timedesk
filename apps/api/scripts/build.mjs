// Bundles the API into ONE file (dist/server.mjs) that Vercel can run as-is.
// Why: the API imports workspace packages (@timedesk/db, @timedesk/shared) whose source is TypeScript.
// Bundling turns all of that into plain JavaScript, so nothing depends on how the host resolves a monorepo.
import { build } from 'esbuild'
import { rmSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  // Left out of the bundle and loaded from node_modules at run time: they have optional native add-ons and
  // many optional peers, which do not bundle well. Vercel includes them in the function automatically.
  external: ['mem0ai', 'mem0ai/*', 'pg', 'pg-native', '@google/genai', 'better-sqlite3'],
  // Some bundled packages are CommonJS and call require(): give them one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
})
