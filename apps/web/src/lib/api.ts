import type { ApiErrorBody } from '@smart-society/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '/api';
const CSRF_COOKIES = ['__Host-ss_csrf', 'ss_csrf'];

function readCsrfCookie(): string | null {
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name && CSRF_COOKIES.includes(name)) return decodeURIComponent(rest.join('='));
  }
  return null;
}

let csrfPromise: Promise<string> | null = null;

async function ensureCsrf(force = false): Promise<string> {
  const existing = readCsrfCookie();
  if (existing && !force) return existing;
  csrfPromise ??= fetch(`${BASE}/auth/csrf`, { credentials: 'include' })
    .then((r) => r.json() as Promise<{ csrfToken: string }>)
    .then((b) => b.csrfToken)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // Non-JSON error (proxy, network appliance): fall through to a status-based message.
  }
  const fallback =
    res.status === 0 || res.status >= 500
      ? 'The server could not complete the request. Try again in a moment.'
      : `Request failed (${res.status})`;
  return new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? fallback, body.error?.fields);
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, retried = false): Promise<T> {
  if (import.meta.env.VITE_STATIC_PREVIEW === '1') {
    throw new ApiError(0, 'preview', 'This is a static preview without the API server, so signing in is turned off. Run the project locally to use the app.');
  }
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf();
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    const err = await parseError(res);
    // A stale CSRF cookie (e.g. after the session expired) is refreshed once automatically.
    if (err.code === 'csrf_failed' && !retried) {
      await ensureCsrf(true);
      return request<T>(method, path, body, true);
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? await res.json() : await res.text()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
