import { cookies, headers } from 'next/headers';

/**
 * Server-side API client.
 *
 * Pages fetch through the same `/api` path the browser uses, forwarding the
 * member's session cookie. There is no second data-access path into the
 * database from the web app: if an endpoint does not exist, the page cannot
 * render it, which keeps the API honest about what it actually serves.
 */

const API_ORIGIN = process.env.FORGE_API_ORIGIN ?? 'http://localhost:4000';

export interface ApiFailure {
  error: { code: string; message: string; details?: unknown };
}

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function forwardedCookie(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Server components default to no caching: this data is per-member. */
  revalidate?: number | false;
  tags?: string[];
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const cookie = await forwardedCookie();
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    cache: options.revalidate === false || options.revalidate === undefined ? 'no-store' : 'force-cache',
    ...(typeof options.revalidate === 'number'
      ? { next: { revalidate: options.revalidate, tags: options.tags ?? [] } }
      : {}),
  });

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const failure = payload as ApiFailure | null;
    throw new ApiRequestError(
      response.status,
      failure?.error?.code ?? 'unknown',
      failure?.error?.message ?? 'The request failed.',
    );
  }
  return payload as T;
}

/**
 * Fetch for pages whose layout may be redirecting the caller away.
 *
 * Next renders a layout and its page in parallel, so a page query can be in
 * flight while the layout is still deciding the visitor does not belong here.
 * Mapping "not signed in", "not allowed" and "not found" to null lets those
 * pages render nothing and let the redirect win, instead of logging an error
 * for a perfectly ordinary mis-navigation.
 */
export async function apiFetchOptional<T>(path: string, options?: RequestOptions): Promise<T | null> {
  try {
    return await apiFetch<T>(path, options);
  } catch (error) {
    if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) return null;
    throw error;
  }
}

/** Public catalogue reads are identical for everyone, so they may be cached. */
export async function apiPublic<T>(path: string, revalidate = 300): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    headers: { 'content-type': 'application/json' },
    next: { revalidate },
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, 'catalog_error', `Catalogue request failed: ${path}`);
  }
  return (await response.json()) as T;
}

export async function currentPathname(): Promise<string> {
  const store = await headers();
  return store.get('x-forge-pathname') ?? '/';
}
