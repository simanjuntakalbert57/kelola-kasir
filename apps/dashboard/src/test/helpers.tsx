import { render } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { vi } from 'vitest';
import { App } from '../App';
import { setAccessToken } from '../lib/api';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

export function problem(status: number, code: string, title = 'Error'): Response {
  return json({ type: 'about:blank', title, status, code }, status);
}

export const session = {
  access_token: 'tok',
  expires_in: 900,
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'albert@contoh.com',
    name: 'Albert',
    outlets: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        code: 'JUS1',
        name: 'Jus Albert',
        timezone: 'Asia/Jakarta',
      },
    ],
  },
};

/** Stubs `fetch`; `routes` maps "METHOD /path" to a handler result. Unmatched calls fail the test. */
export function mockApi(routes: Record<string, (body: unknown) => Response>) {
  const calls: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input).replace(/^.*\/v1/, '');
      const key = `${init?.method ?? 'GET'} ${path}`;
      const route = key.split('?', 1)[0] ?? key;
      const body =
        init?.body instanceof FormData
          ? Object.fromEntries(init.body.entries())
          : init?.body
            ? JSON.parse(String(init.body))
            : undefined;
      calls.push({ key, body });
      const handler = routes[key] ?? routes[route];
      if (!handler) throw new Error(`Unmocked request: ${key}`);
      return handler(body);
    }),
  );
  return calls;
}

export function renderApp(path: string) {
  setAccessToken(null);
  return render(<App history={createMemoryHistory({ initialEntries: [path] })} />);
}
