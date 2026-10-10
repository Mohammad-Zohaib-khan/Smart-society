import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, qs } from '@/lib/api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'ss_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('api client', () => {
  it('echoes the CSRF cookie on unsafe requests and sends credentials', async () => {
    document.cookie = 'ss_csrf=token-abc-123';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ok: true }));
    await api.post('/complaints', { a: 1 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('token-abc-123');
    expect(init?.credentials).toBe('include');
  });

  it('maps API errors, including field errors', async () => {
    document.cookie = 'ss_csrf=t';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(400, { error: { code: 'bad_request', message: 'Check fields', fields: { title: 'Too short' } } }));
    const err = await api.post('/x', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fields).toEqual({ title: 'Too short' });
    expect((err as ApiError).status).toBe(400);
  });

  it('refreshes a stale CSRF token once and retries', async () => {
    document.cookie = 'ss_csrf=stale';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(403, { error: { code: 'csrf_failed', message: 'stale' } }))
      .mockResolvedValueOnce(json(200, { csrfToken: 'fresh' }))
      .mockResolvedValueOnce(json(200, { done: true }));
    await expect(api.post('/x')).resolves.toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports network failures in plain language', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'network' });
  });

  it('builds query strings without empty values', () => {
    expect(qs({ a: 1, b: '', c: undefined, d: 'x y' })).toBe('?a=1&d=x+y');
    expect(qs({})).toBe('');
  });
});
