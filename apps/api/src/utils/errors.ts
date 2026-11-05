/** Errors services throw on purpose. The app's error handler turns them into JSON responses. */
export class AppError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, message, details)
export const unauthorized = (message = 'Sign in required.') => new AppError(401, message)
export const forbidden = (message = 'You are not allowed to do that.') => new AppError(403, message)
export const notFound = (what: string) => new AppError(404, `${what} not found.`)
export const conflict = (message: string) => new AppError(409, message)
