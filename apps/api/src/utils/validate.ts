import type { Context } from 'hono'
import type { z } from 'zod'
import { AppError, badRequest } from './errors.ts'

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    throw new AppError(422, 'Some fields are invalid.', issues)
  }
  return result.data
}

/** application/json, with or without a charset. */
const isJson = (type: string | undefined) => /^application\/json\s*(;|$)/i.test(type ?? '')

/**
 * Validates the JSON body. An empty body counts as an empty object, so a route whose fields are all optional can be
 * called without one (the web app sends no body, and no Content-Type, for a bare POST).
 *
 * A body must be sent as application/json. Other types are refused (415): a form or text/plain request is one any
 * website can make a browser send without asking first, so accepting it would let other sites act as the signed-in person.
 * A body that is not valid JSON is a 400, never silently treated as empty.
 */
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const text = await c.req.text()
  if (text.trim() === '') return parse(schema, {})
  if (!isJson(c.req.header('Content-Type'))) throw new AppError(415, 'Send the request body as JSON (Content-Type: application/json).')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw badRequest('The request body is not valid JSON.')
  }
  return parse(schema, body)
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parse(schema, c.req.query())
}

export function parseParams<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parse(schema, c.req.param())
}
