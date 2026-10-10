import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { LoginPage } from '@/features/auth/LoginPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/login', element: <LoginPage /> }, { path: '/app', element: <p>App home</p> }], { initialEntries: ['/login'] });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('LoginPage', () => {
  it('validates before calling the server', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { error: { code: 'unauthorized', message: 'no' } }));
    renderLogin();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/auth/login'))).toBe(true);
  });

  it('shows the server’s message for wrong credentials', async () => {
    document.cookie = 'ss_csrf=t';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('/auth/login') ? json(401, { error: { code: 'invalid_credentials', message: 'Email or password is incorrect' } }) : json(401, { error: { code: 'unauthorized', message: 'no' } }),
    );
    renderLogin();
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.in');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-pass-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect')).toBeInTheDocument();
  });

  it('enters the app after a successful sign-in', async () => {
    document.cookie = 'ss_csrf=t';
    const session = { user: { id: 'u', name: 'N', email: 'a@b.in', phone: null, isPlatformAdmin: false }, membership: null, memberships: [], permissions: [], notificationPrefs: { emailEnabled: false, mutedTypes: [] } };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (String(url).includes('/auth/login') ? json(200, session) : json(401, { error: { code: 'unauthorized', message: 'no' } })));
    renderLogin();
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.in');
    await userEvent.type(screen.getByLabelText('Password'), 'right-pass-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByText('App home')).toBeInTheDocument());
  });
});
