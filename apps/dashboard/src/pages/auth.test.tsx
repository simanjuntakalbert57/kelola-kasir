import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

afterEach(() => vi.unstubAllGlobals());

describe('auth guard & login', () => {
  it('redirects anonymous users to the login page', async () => {
    mockApi({ 'POST /auth/refresh': () => problem(401, 'UNAUTHORIZED') });
    renderApp('/pegawai');
    expect(await screen.findByRole('heading', { name: 'Masuk Owner' })).toBeInTheDocument();
  });

  it('restores the session from the refresh cookie', async () => {
    mockApi({ 'POST /auth/refresh': () => json(session) });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getAllByText(/Jus Albert/).length).toBeGreaterThan(0);
  });

  it('validates the form before calling the API', async () => {
    mockApi({ 'POST /auth/refresh': () => problem(401, 'UNAUTHORIZED') });
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Masuk' }));
    expect(await screen.findByText('Email tidak valid.')).toBeInTheDocument();
    expect(screen.getByText('Kata sandi minimal 8 karakter.')).toBeInTheDocument();
  });

  it('shows an error on wrong credentials', async () => {
    mockApi({
      'POST /auth/refresh': () => problem(401, 'UNAUTHORIZED'),
      'POST /auth/login': () => problem(401, 'INVALID_CREDENTIALS'),
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'albert@contoh.com');
    await userEvent.type(screen.getByLabelText('Kata sandi'), 'salahsalah');
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }));
    expect(await screen.findByText('Email atau kata sandi salah.')).toBeInTheDocument();
  });

  it('logs in and lands on the dashboard', async () => {
    const calls = mockApi({
      'POST /auth/refresh': () => problem(401, 'UNAUTHORIZED'),
      'POST /auth/login': () => json(session),
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'albert@contoh.com');
    await userEvent.type(screen.getByLabelText('Kata sandi'), 'rahasia123');
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /auth/login')?.body).toEqual({
      email: 'albert@contoh.com',
      password: 'rahasia123',
    });
  });

  it('logs out back to the login page', async () => {
    mockApi({
      'POST /auth/refresh': () => json(session),
      'POST /auth/logout': () => new Response(null, { status: 204 }),
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Keluar' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Masuk Owner' })).toBeInTheDocument(),
    );
  });
});

describe('logout with an expired access token', () => {
  it('refreshes and retries so the server revokes the cookie', async () => {
    let logoutCalls = 0;
    const calls = mockApi({
      'POST /auth/refresh': () => json(session),
      'POST /auth/logout': () => (++logoutCalls === 1 ? problem(401, 'UNAUTHORIZED') : new Response(null, { status: 204 })),
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Keluar' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Masuk Owner' })).toBeInTheDocument());
    expect(logoutCalls).toBe(2);
    expect(calls.filter((c) => c.key === 'POST /auth/refresh')).toHaveLength(2);
  });
});

describe('redirect after login', () => {
  it('returns the owner to the page they asked for', async () => {
    let authed = false;
    mockApi({
      'POST /auth/refresh': () => (authed ? json(session) : problem(401, 'UNAUTHORIZED')),
      'POST /auth/login': () => {
        authed = true;
        return json(session);
      },
      'GET /devices': () => json({ data: [] }),
    });
    renderApp('/perangkat');
    await userEvent.type(await screen.findByLabelText('Email'), 'albert@contoh.com');
    await userEvent.type(screen.getByLabelText('Kata sandi'), 'rahasia123');
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }));
    expect(await screen.findByRole('heading', { name: 'Perangkat' })).toBeInTheDocument();
  });
});
