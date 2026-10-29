import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeCard, ThemeToggle } from '../components/ThemeToggle';
import { THEME_KEY, ThemeProvider } from './theme';

let osDark = false;
let listeners: (() => void)[] = [];

beforeEach(() => {
  osDark = false;
  listeners = [];
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return osDark;
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      listeners = listeners.filter((l) => l !== cb);
    },
  }));
});
afterEach(() => vi.unstubAllGlobals());

const mount = () =>
  render(
    <ThemeProvider>
      <ThemeToggle />
      <ThemeCard />
    </ThemeProvider>,
  );
const theme = () => document.documentElement.dataset.theme;

describe('theme', () => {
  it('defaults to following the device and reacts to OS changes live', () => {
    mount();
    expect(theme()).toBe('light');
    expect(screen.getByRole('radio', { name: 'Ikuti perangkat' })).toBeChecked();
    act(() => {
      osDark = true;
      listeners.forEach((l) => l());
    });
    expect(theme()).toBe('dark');
  });

  it('applies and persists an explicit choice', async () => {
    const { unmount } = mount();
    await userEvent.click(screen.getByRole('radio', { name: 'Gelap' }));
    expect(theme()).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    unmount();
    mount();
    expect(theme()).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Gelap' })).toBeChecked();
  });

  it('header button flips light and dark in one tap', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Ganti ke mode gelap' }));
    expect(theme()).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Ganti ke mode terang' }));
    expect(theme()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });
});
