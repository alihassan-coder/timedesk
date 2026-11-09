/** Errors services throw on purpose. The app's error handler turns them into JSON responses. */
export class AppError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 415 | 422 | 502 | 503 | 504,
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
export const conflict = (message: string, details?: unknown) => new AppError(409, message, details)
/** The request is well formed but cannot be carried out (for example it names a project that does not exist). */
export const unprocessable = (message: string, details?: unknown) => new AppError(422, message, details)
/** Another service (for example Google) failed or did not answer. */
export const badGateway = (message: string) => new AppError(502, message)
/** Another service is busy or limiting us: worth trying again later. */
export const unavailable = (message: string) => new AppError(503, message)
/** Another service took too long to answer. */
export const gatewayTimeout = (message: string) => new AppError(504, message)
