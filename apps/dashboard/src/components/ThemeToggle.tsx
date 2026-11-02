import { Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from './ui';
import { useTheme } from '../lib/theme';
import type { ThemePref } from '../lib/theme';

const OPTIONS: readonly { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Terang', icon: Sun },
  { value: 'dark', label: 'Gelap', icon: Moon },
  { value: 'system', label: 'Ikuti perangkat', icon: Monitor },
];

/** One-tap shortcut that flips between light and dark. */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const toDark = resolved === 'light';
  const Icon = toDark ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={toDark ? 'Ganti ke mode gelap' : 'Ganti ke mode terang'}
      className="grid size-11 place-items-center rounded-full text-muted transition-colors duration-150 hover:bg-tint hover:text-tint-ink"
    >
      <Icon size={22} aria-hidden="true" />
    </button>
  );
}

/** Settings card with the 3-way theme choice (stored per device in localStorage). */
export function ThemeCard() {
  const { pref, setPref } = useTheme();
  return (
    <Card>
      <h2 className="mb-1 text-lg">Tampilan</h2>
      <p className="mb-3 text-sm text-muted">Pilihan hanya berlaku di perangkat ini.</p>
      <div
        role="radiogroup"
        aria-label="Tema tampilan"
        className="inline-flex max-w-full flex-wrap gap-1 rounded-full border-2 border-line-strong bg-surface p-1"
      >
        {OPTIONS.map((o) => {
          const on = pref === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPref(o.value)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-extrabold transition-colors duration-150 ${on ? 'bg-tint text-tint-ink' : 'text-muted hover:bg-bg'}`}
            >
              <o.icon size={18} aria-hidden="true" />
              {o.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
