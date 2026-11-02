import { Check, ChevronDown, Layers, Loader2, Lock } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ownedOutlets, useAuth } from '../auth/AuthProvider';

/** Stripe/pill colour per branch code: identity is the code + name, colour only backs it up. */
export function branchTone(code: string | undefined): string {
  if (code === 'RGN') return 'bg-warm-ink';
  if (code === 'PLM') return 'bg-info-ink';
  return 'bg-line-strong';
}

const ALL = 'all';

/**
 * Branch switcher (ADR-0020 §5). Owners of several branches get a listbox; a manager or a single-branch owner
 * sees a fixed label. "Semua cabang" is offered only where it works (`allowAll`: Pengeluaran and Rekap).
 */
export function BranchPicker({ allowAll }: { allowAll: boolean }) {
  const {
    user,
    activeOutlet,
    role,
    switching,
    switchingTo,
    switchError,
    viewAll,
    setViewAll,
    switchOutlet,
  } = useAuth();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const outlets = user?.outlets ?? [];
  const canAll = allowAll && ownedOutlets(user).length >= 2 && role === 'owner';
  const options = [
    ...outlets.map((o) => ({ value: o.id, code: o.code, name: o.name, sub: undefined })),
    ...(canAll
      ? [{ value: ALL, code: 'ALL', name: 'Semua cabang', sub: 'Hanya untuk melihat laporan' }]
      : []),
  ];
  const current = viewAll ? ALL : (activeOutlet?.id ?? '');

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!activeOutlet) return null;

  if (outlets.length < 2 || role === 'manager') {
    return (
      <div
        role="group"
        aria-label={`Cabang Anda: ${activeOutlet.name}. Tidak bisa diganti.`}
        className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-surface px-3 text-sm ring-1 ring-line"
      >
        <span className="rounded-lg bg-tint px-1.5 py-0.5 text-xs font-extrabold text-tint-ink">
          {activeOutlet.code}
        </span>
        <span className="text-left leading-tight">
          <small className="block text-[11px] font-bold text-muted">Cabang Anda</small>
          <b className="font-extrabold">{activeOutlet.name}</b>
        </span>
        {role === 'manager' ? <Lock size={16} aria-hidden="true" className="text-muted" /> : null}
      </div>
    );
  }

  async function choose(value: string) {
    setOpen(false);
    buttonRef.current?.focus();
    if (value === ALL) {
      setViewAll(true);
      return;
    }
    setViewAll(false);
    await switchOutlet(value);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(
          Math.max(
            0,
            options.findIndex((o) => o.value === current),
          ),
        );
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      const o = options[active];
      if (o) void choose(o.value);
    }
  }

  const shown = viewAll
    ? { code: 'ALL', name: 'Semua cabang' }
    : { code: activeOutlet.code, name: activeOutlet.name };

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKey}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={
          switching
            ? `Mengganti ke ${switchingTo?.name ?? ''}…`
            : `Cabang aktif: ${shown.name}. Ganti cabang`
        }
        disabled={switching}
        onClick={() => {
          setOpen((o) => !o);
          setActive(
            Math.max(
              0,
              options.findIndex((o) => o.value === current),
            ),
          );
        }}
        className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-surface px-3 text-sm ring-1 ring-line-strong disabled:cursor-wait"
      >
        <span className="rounded-lg bg-tint px-1.5 py-0.5 text-xs font-extrabold text-tint-ink">
          {shown.code}
        </span>
        <span className="text-left leading-tight">
          <small className="block text-[11px] font-bold text-muted">
            {switching ? `Mengganti ke ${switchingTo?.name ?? ''}…` : 'Cabang aktif'}
          </small>
          <b className="font-extrabold">{shown.name}</b>
        </span>
        {switching ? (
          <Loader2 size={18} aria-hidden="true" className="animate-spin" />
        ) : (
          <ChevronDown size={18} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Pilih cabang"
          className="absolute left-0 z-30 mt-1 w-72 max-w-[85vw] rounded-2xl bg-surface p-1.5 shadow-modal ring-1 ring-line"
        >
          <li role="presentation" className="px-3 py-1 text-xs text-muted">
            Data di halaman ini mengikuti cabang yang dipilih.
          </li>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === current}
              onClick={() => void choose(o.value)}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl px-3 ${i === active ? 'bg-tint' : ''}`}
            >
              <span className="grid size-8 place-items-center rounded-lg bg-bg text-xs font-extrabold">
                {o.code === 'ALL' ? <Layers size={16} aria-hidden="true" /> : o.code}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <b className="block text-sm font-extrabold">{o.name}</b>
                {o.sub ? <small className="text-xs text-muted">{o.sub}</small> : null}
              </span>
              {o.value === current ? <Check size={18} aria-hidden="true" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {switchError ? (
        <p
          role="alert"
          className="mt-1 rounded-xl border-2 border-danger bg-surface px-3 py-1.5 text-[13px] font-bold text-danger"
        >
          {switchError}
        </p>
      ) : null}
    </div>
  );
}
