import { AlertTriangle, Check, ChevronDown, Clock, Info, X } from 'lucide-react';
import { Children, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type {
  KeyboardEvent,
  Ref,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
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

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string | undefined;
  ref?: Ref<HTMLSelectElement>;
};

type ListPos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

const LIST_MAX = 240;
const EDGE = 8;

/** Fixed-position placement for the list: below the field, flipped above when there is no room, clamped to the viewport. */
function placeList(rect: DOMRect): ListPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - rect.bottom - EDGE;
  const spaceAbove = rect.top - EDGE;
  const up = spaceBelow < Math.min(LIST_MAX, 160) && spaceAbove > spaceBelow;
  const width = Math.min(rect.width, vw - EDGE * 2);
  const left = Math.max(EDGE, Math.min(rect.left, vw - EDGE - width));
  const maxHeight = Math.max(80, Math.min(LIST_MAX, up ? spaceAbove : spaceBelow));
  return up
    ? { left, width, bottom: vh - rect.top + 4, maxHeight }
    : { left, width, top: rect.bottom + 4, maxHeight };
}

type SelectOption = { value: string; label: string; disabled: boolean };

function readOptions(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as {
      value?: string | number;
      children?: ReactNode;
      disabled?: boolean;
    };
    const text = Children.toArray(props.children).join('');
    out.push({
      value: String(props.value ?? text),
      label: text,
      disabled: Boolean(props.disabled),
    });
  });
  return out;
}

/**
 * Custom listbox instead of a native <select>: the OS-drawn popup of a native
 * select covers the control itself, so the list always opens below the field here.
 * A hidden native <select> stays in the DOM so react-hook-form `register` and
 * controlled `value`/`onChange` keep working unchanged.
 */
export function SelectField({
  label,
  error,
  children,
  ref,
  value,
  defaultValue,
  disabled,
  onBlur,
  ...props
}: SelectFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const options = readOptions(children);
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const typeahead = useRef({ text: '', timer: 0 });
  const [pos, setPos] = useState<ListPos | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [current, setCurrent] = useState(String(value ?? defaultValue ?? options[0]?.value ?? ''));

  // Uncontrolled (react-hook-form) selects get their value through the ref.
  useEffect(() => {
    const v = nativeRef.current?.value;
    if (v !== undefined && v !== current) setCurrent(v);
  }, [current, value, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      // Browsers move focus after mousedown handlers run; only reclaim it when the
      // click landed on something non-focusable, so clicking another field still works.
      setTimeout(() => {
        const a = document.activeElement;
        if (!a || a === document.body) buttonRef.current?.focus();
      }, 0);
    };
    const reposition = () => {
      if (buttonRef.current) setPos(placeList(buttonRef.current.getBoundingClientRect()));
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const selected = options.find((o) => o.value === current);

  const pick = (opt: SelectOption) => {
    const el = nativeRef.current;
    if (!el || opt.disabled) return;
    el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    setCurrent(opt.value);
    setOpen(false);
  };

  const openList = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === current),
      ),
    );
    if (buttonRef.current) setPos(placeList(buttonRef.current.getBoundingClientRect()));
    setOpen(true);
  };

  const jump = (from: number, dir: 1 | -1) => {
    let i = from;
    while (i >= 0 && i < options.length && options[i]?.disabled) i += dir;
    if (i >= 0 && i < options.length) setActive(i);
  };

  const typeAhead = (key: string) => {
    const t = typeahead.current;
    window.clearTimeout(t.timer);
    t.text += key.toLowerCase();
    t.timer = window.setTimeout(() => (t.text = ''), 600);
    const start = t.text.length > 1 ? active : active + 1;
    for (let n = 0; n < options.length; n++) {
      const i = (start + n) % options.length;
      const o = options[i];
      if (o && !o.disabled && o.label.toLowerCase().startsWith(t.text)) {
        if (!open) openList();
        setActive(i);
        return;
      }
    }
  };

  const move = (dir: 1 | -1) => {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i]?.disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openList();
      else move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) openList();
      else if (options[active]) pick(options[active]);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (!open) openList();
      if (e.key === 'Home') jump(0, 1);
      else jump(options.length - 1, -1);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      typeAhead(e.key);
    }
  };

  return (
    <div className="mb-3.5">
      <span id={labelId} className="mb-1 block text-sm font-extrabold">
        {label}
      </span>
      <div ref={rootRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={labelId}
          aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            if (rootRef.current?.contains(e.relatedTarget as Node | null)) return;
            // The hidden native select never takes focus, so forward blur for
            // react-hook-form's touched / onBlur validation.
            const el = nativeRef.current;
            if (el && onBlur)
              onBlur({ ...e, target: el, currentTarget: el, type: 'blur' } as never);
          }}
          className={`${controlCls(error)} flex items-center justify-between gap-2 text-left`}
        >
          <span className="truncate">{selected?.label ?? ''}</span>
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {open && pos ? (
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            style={{
              position: 'fixed',
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
            className="z-50 overflow-auto rounded-2xl bg-surface py-1 shadow-card ring-1 ring-line"
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={o.value === current}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-base ${i === active ? 'bg-brand-tint' : ''} ${o.value === current ? 'font-semibold text-brand-text' : 'text-ink'} ${o.disabled ? 'opacity-50' : ''}`}
              >
                <span className="truncate">{o.label}</span>
                {o.value === current ? (
                  <Check size={18} aria-hidden="true" className="shrink-0 text-pri" />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <select
        aria-hidden="true"
        tabIndex={-1}
        // react-hook-form focuses the first invalid field's ref: send it to the visible control.
        onFocus={() => buttonRef.current?.focus()}
        className="sr-only"
        disabled={disabled}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        {...props}
        ref={(el) => {
          nativeRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
      >
        {children}
      </select>
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
