import { AlertTriangle, Check, ChevronDown, Clock, Info, X } from 'lucide-react';
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  CSSProperties,
  KeyboardEvent,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-pri text-white hover:bg-pri-hover active:bg-pri-press',
  secondary: 'bg-surface text-ink ring-2 ring-line-strong ring-inset hover:bg-bg',
  danger: 'bg-surface text-danger ring-2 ring-danger ring-inset hover:bg-need-bg',
};

export function Button({
  variant = 'secondary',
  small = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  const size = small ? 'min-h-11 px-4 text-sm' : 'min-h-12 px-5 text-[15px]';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-full font-extrabold whitespace-nowrap transition duration-150 ease-out disabled:cursor-not-allowed disabled:bg-dis-bg disabled:text-dis-ink disabled:ring-0 ${size} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl bg-surface p-4 shadow-card ${className}`}>{children}</div>;
}

type BadgeTone = 'ok' | 'off' | 'warn' | 'info';

const badgeTones: Record<BadgeTone, { cls: string; Icon: typeof Check }> = {
  ok: { cls: 'bg-ok-bg text-ok-ink', Icon: Check },
  off: { cls: 'bg-need-bg text-need-ink', Icon: X },
  warn: { cls: 'bg-warm-bg text-warm-ink', Icon: AlertTriangle },
  info: { cls: 'bg-info-bg text-info-ink', Icon: Clock },
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  const { cls, Icon } = badgeTones[tone];
  return (
    <span
      className={`inline-flex min-h-[26px] items-center gap-1 rounded-full px-2.5 text-xs font-extrabold ${cls}`}
    >
      <Icon size={14} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Info card (warm, calm) vs action-needed card (red tint, solid icon, one call to action). */
export function NoticeCard({
  kind = 'info',
  title,
  children,
}: {
  kind?: 'info' | 'action';
  title?: string;
  children?: ReactNode;
}) {
  const action = kind === 'action';
  return (
    <div
      className={`mb-3 flex items-start gap-3 rounded-2xl border p-3.5 ${action ? 'border-need-line bg-need-bg text-need-ink' : 'border-warm-line bg-warm-bg text-warm-ink'}`}
    >
      <span
        aria-hidden="true"
        className={`grid size-9 shrink-0 place-items-center rounded-xl ${action ? 'bg-need-ink text-white' : 'bg-white/70'}`}
      >
        {action ? <AlertTriangle size={20} /> : <Info size={20} />}
      </span>
      <div className="min-w-0 text-sm font-semibold">
        {title ? <p className="font-extrabold">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  trailing,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: string;
  /** Control placed inside the input's right edge, e.g. a show/hide password button. */
  trailing?: ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="mb-3.5">
      <label htmlFor={id} className="mb-1 block text-sm font-extrabold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-h-12 w-full rounded-2xl bg-surface px-3.5 py-2.5 text-base text-ink ring-inset placeholder:text-muted ${trailing ? 'pr-12' : ''} ${error ? 'ring-2 ring-danger' : 'ring-1 ring-line-strong'}`}
          {...props}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-1 grid place-items-center">{trailing}</div>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlCls = (error?: string) =>
  `min-h-12 w-full rounded-2xl bg-surface px-3.5 py-2.5 text-base text-ink ring-inset placeholder:text-muted ${error ? 'ring-2 ring-danger' : 'ring-1 ring-line-strong'}`;

type SelectOption = { value: string; label: string; disabled: boolean };

function readOptions(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (
      !isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)
    )
      return;
    const label = Children.toArray(child.props.children).join('');
    out.push({
      value: String(child.props.value ?? label),
      label,
      disabled: Boolean(child.props.disabled),
    });
  });
  return out;
}

export type SelectChange = { target: { name: string; value: string } };

const LIST_MAX = 288;
const LIST_GAP = 6;

/**
 * Custom listbox dropdown (replaces the native select, whose OS popup cannot be styled).
 * Options are declared as <option> children; onChange receives an event-like { target }.
 */
export function SelectField({
  label,
  error,
  value,
  name = '',
  onChange,
  disabled,
  children,
}: {
  label: string;
  error?: string | undefined;
  value: string;
  name?: string;
  onChange: (e: SelectChange) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const options = readOptions(children);
  const selectedIdx = options.findIndex((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };
  const openList = () => {
    if (disabled) return;
    setActive(selectedIdx >= 0 ? selectedIdx : options.findIndex((o) => !o.disabled));
    setOpen(true);
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange({ target: { name, value: o.value } });
    close(true);
  };

  // Place the list below the button, or above when there is no room; never off-screen.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const want = Math.min(LIST_MAX, options.length * 44 + 12);
    const below = vh - r.bottom - LIST_GAP - 8;
    const above = r.top - LIST_GAP - 8;
    const up = below < want && above > below;
    const maxHeight = Math.max(120, Math.min(LIST_MAX, up ? above : below));
    const width = Math.min(Math.max(r.width, 180), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(
      up
        ? { left, width, maxHeight, bottom: vh - r.top + LIST_GAP }
        : { left, width, maxHeight, top: r.bottom + LIST_GAP },
    );
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
      // The click's default action moves focus after pointerdown; only reclaim it when it lands nowhere.
      setTimeout(() => {
        if (document.activeElement === document.body) btnRef.current?.focus();
      }, 0);
    };
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) {
      document.getElementById(`${id}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [open, active, id]);

  const move = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < options.length; i += step) {
      if (!options[i]?.disabled) return i;
    }
    return from;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (k === 'ArrowDown') setActive(move(active, 1));
    else if (k === 'ArrowUp') setActive(move(active, -1));
    else if (k === 'Home') setActive(move(-1, 1));
    else if (k === 'End') setActive(move(options.length, -1));
    else if (k === 'Enter' || k === ' ') choose(active);
    else if (k === 'Escape') close(true);
    else if (k === 'Tab') setOpen(false);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const t = typed.current;
      t.text = now - t.at > 700 ? k.toLowerCase() : t.text + k.toLowerCase();
      t.at = now;
      const idx = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(t.text));
      if (idx >= 0) setActive(idx);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="mb-3.5">
      <span
        id={`${id}-label`}
        onClick={() => btnRef.current?.focus()}
        className="mb-1 block text-sm font-extrabold"
      >
        {label}
      </span>
      <button
        ref={btnRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${id}-label`}
        aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
        className={`${controlCls(error)} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:bg-dis-bg disabled:text-dis-ink`}
      >
        <span className="min-w-0 flex-1 truncate">{options[selectedIdx]?.label ?? ''}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-5 shrink-0 text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={`${id}-label`}
          style={pos}
          className="fixed z-50 overflow-y-auto rounded-[14px] bg-surface p-1.5 text-ink shadow-card ring-1 ring-line-strong"
        >
          {options.map((o, i) => {
            const selected = i === selectedIdx;
            return (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={selected}
                aria-disabled={o.disabled || undefined}
                onPointerMove={() => !o.disabled && setActive(i)}
                onClick={() => choose(i)}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-[15px] ${selected ? 'font-extrabold text-pri' : ''} ${i === active ? 'bg-tint outline-2 -outline-offset-2 outline-focus' : ''} ${o.disabled ? 'cursor-not-allowed text-dis-ink' : ''}`}
              >
                <span className="min-w-0 flex-1">{o.label}</span>
                {selected ? (
                  <Check aria-hidden="true" className="size-5 shrink-0 text-pri" />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextareaField({
  label,
  error,
  hint,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string | undefined;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="mb-3.5">
      <label htmlFor={id} className="mb-1 block text-sm font-extrabold">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={controlCls(error)}
        {...props}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function CheckboxField({
  label,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }) {
  const id = useId();
  return (
    <div className="mb-3.5 flex min-h-12 items-center gap-3">
      <input id={id} type="checkbox" className="size-5 accent-pri" {...props} />
      <label htmlFor={id} className="text-sm font-extrabold">
        {label}
      </label>
    </div>
  );
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'warn';
  children: ReactNode;
}) {
  const cls =
    tone === 'error'
      ? 'border-2 border-danger bg-surface text-danger'
      : 'border border-warm-line bg-warm-bg text-warm-ink';
  return (
    <div role="alert" className={`mb-3 rounded-2xl px-3.5 py-2.5 text-sm font-bold ${cls}`}>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 p-8 text-center text-muted">
      <div className="text-5xl" aria-hidden="true">
        {icon}
      </div>
      <p className="text-lg font-extrabold text-ink">{title}</p>
      {children}
    </div>
  );
}

export function ErrorState({
  title = 'Ada yang tidak beres',
  onRetry,
  children,
}: {
  title?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2.5 rounded-3xl border-2 border-danger bg-surface p-6 text-center"
    >
      <AlertTriangle size={44} className="text-danger" aria-hidden="true" />
      <p className="text-lg font-extrabold text-ink">{title}</p>
      {children ? <p className="text-muted">{children}</p> : null}
      {onRetry ? (
        <Button variant="primary" onClick={onRetry}>
          Coba lagi
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Memuat" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-2xl bg-tint" />
      ))}
    </div>
  );
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(92vw,26rem)] rounded-3xl bg-surface p-5 text-ink shadow-modal backdrop:bg-ink/40 max-sm:mb-0 max-sm:max-w-none max-sm:w-full max-sm:rounded-b-none max-sm:rounded-t-[28px]"
    >
      <h2 id={titleId} className="mb-3 text-xl">
        {title}
      </h2>
      {children}
    </dialog>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl">{title}</h1>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Confirmation dialog for destructive or irreversible actions (sheet on phones). */
export function ConfirmDialog({
  title,
  confirmLabel,
  tone = 'danger',
  pending = false,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      {error ? <Alert>{error}</Alert> : null}
      {children ? <div className="text-sm text-muted">{children}</div> : null}
      <div className="mt-4 flex gap-2">
        <Button variant={tone} disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button onClick={onClose}>Batal</Button>
      </div>
    </Dialog>
  );
}
