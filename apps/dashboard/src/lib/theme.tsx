import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'kk-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const META_COLOR: Record<ResolvedTheme, string> = { light: '#fff7ea', dark: '#1a130d' };

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

// Without `matchMedia` (tests) the device counts as light.
const hasMatchMedia = () => typeof window.matchMedia === 'function';
const systemDark = () => hasMatchMedia() && window.matchMedia(DARK_QUERY).matches;

function apply(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', META_COLOR[theme]);
}

interface ThemeValue {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [dark, setDark] = useState(systemDark);

  // "Ikuti perangkat" follows OS changes live.
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const mq = window.matchMedia(DARK_QUERY);
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const resolved: ResolvedTheme = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
  useEffect(() => apply(resolved), [resolved]);

  const setPref = useCallback((p: ThemePref) => {
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      // Storage blocked: the choice still applies for this session.
    }
    setPrefState(p);
  }, []);
  const toggle = useCallback(
    () => setPref(resolved === 'dark' ? 'light' : 'dark'),
    [resolved, setPref],
  );

  const value = useMemo(
    () => ({ pref, resolved, setPref, toggle }),
    [pref, resolved, setPref, toggle],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
