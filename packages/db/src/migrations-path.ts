import { fileURLToPath } from 'node:url'

/** Absolute path of the generated SQL migrations folder (works on Windows and Linux). */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))
