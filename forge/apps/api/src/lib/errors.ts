/**
 * A single error shape for the whole API.
 *
 * Every failure the client can act on carries a stable machine-readable
 * `code`; `message` is for a human reading a log or a toast. Clients branch on
 * the code, never on the prose, so copy can be rewritten without breaking them.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);
export const unauthorized = (message = 'Sign in to continue.') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this.') =>
  new ApiError(403, 'forbidden', message);
export const notFound = (what = 'Resource') =>
  new ApiError(404, 'not_found', `${what} not found.`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
