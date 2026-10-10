export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'bad_request', message, fields);
export const unauthorized = (message = 'Please sign in to continue') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that') => new AppError(403, 'forbidden', message);
/** Used for records outside the caller's scope too, so existence is not leaked across societies. */
export const notFound = (what = 'Record') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
export const unavailable = (message: string) => new AppError(503, 'unavailable', message);

export function isDuplicateKeyError(e: unknown): e is { code: 11000; keyPattern?: Record<string, unknown> } {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 11000;
}
