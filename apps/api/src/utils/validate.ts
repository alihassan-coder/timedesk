import type { Context } from 'hono'
import type { z } from 'zod'
import { AppError } from './errors.ts'

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    throw new AppError(422, 'Some fields are invalid.', issues)
  }
  return result.data
}

/** Validates the JSON body. An empty or malformed body counts as an empty object. */
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => ({}))
  return parse(schema, body)
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parse(schema, c.req.query())
}

export function parseParams<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parse(schema, c.req.param())
}
