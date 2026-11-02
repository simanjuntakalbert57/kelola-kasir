import { useSyncExternalStore } from 'react';

/** Tracks a CSS media query. Without `matchMedia` (tests) it reports `fallback`. */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const m = window.matchMedia(query);
      m.addEventListener('change', notify);
      return () => m.removeEventListener('change', notify);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

/** Tablet and up (Tailwind `md`): sidebar layout, inline filters, detail side panel. */
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');
