import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'
import { migrationsFolder } from './migrations-path.ts'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Put it in apps/api/.env')
  process.exit(1)
}
await migrate(drizzle(neon(url)), { migrationsFolder })
console.log('Migrations applied.')
