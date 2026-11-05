// Vercel function entry. All the real code is in the bundle that `pnpm build` writes to dist/server.mjs.
import { handle } from 'hono/vercel'
import app from '../dist/server.mjs'

const handler = handle(app)

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
export const HEAD = handler
