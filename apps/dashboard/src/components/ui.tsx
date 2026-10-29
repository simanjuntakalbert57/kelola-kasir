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
  primary: 'bg-brand text-white shadow-card hover:bg-brand-600',
  secondary: 'bg-surface text-brand-text ring-1 ring-line hover:bg-brand-50',
  danger: 'bg-surface text-danger ring-1 ring-danger/40 hover:bg-danger-bg',
};

export function Button({
  variant = 'secondary',
  small = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  const size = small ? 'min-h-9 px-3 text-sm' : 'min-h-12 px-4 text-base';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-[14px] font-bold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${size} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] bg-surface p-4 shadow-card ${className}`}>{children}</div>;
}

export function Badge({ tone, children }: { tone: 'ok' | 'off' | 'warn'; children: ReactNode }) {
  const tones = {
    ok: 'bg-brand-tint text-brand-text',
    off: 'bg-danger-bg text-danger',
    warn: 'bg-warn-bg text-warn',
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="mb-3.5">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-12 w-full rounded-[12px] bg-surface px-3 py-2.5 text-base text-ink ring-1 ring-inset placeholder:text-muted ${error ? 'ring-2 ring-danger' : 'ring-line'}`}
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

const controlCls = (error?: string) =>
  `min-h-12 w-full rounded-[12px] bg-surface px-3 py-2.5 text-base text-ink ring-1 ring-inset placeholder:text-muted ${error ? 'ring-2 ring-danger' : 'ring-line'}`;

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string | undefined;
  ref?: Ref<HTMLSelectElement>;
};

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
  ...props
}: SelectFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const options = readOptions(children);
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
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
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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
    setOpen(true);
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
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="mb-3.5">
      <span id={labelId} className="mb-1 block text-sm font-semibold">
        {label}
      </span>
      <div ref={rootRef} className="relative">
        <button
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
          className={`${controlCls(error)} flex items-center justify-between gap-2 text-left`}
        >
          <span className="truncate">{selected?.label ?? ''}</span>
          <span aria-hidden="true" className="text-muted">
            ▾
          </span>
        </button>
        {open ? (
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-[12px] bg-surface py-1 shadow-card ring-1 ring-line"
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
                className={`min-h-11 cursor-pointer px-3 py-2.5 text-base ${i === active ? 'bg-brand-tint' : ''} ${o.value === current ? 'font-semibold text-brand-text' : 'text-ink'} ${o.disabled ? 'opacity-50' : ''}`}
              >
                {o.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <select
        aria-hidden="true"
        tabIndex={-1}
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
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
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
      <input id={id} type="checkbox" className="size-5 accent-brand-600" {...props} />
      <label htmlFor={id} className="text-sm font-semibold">
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
  const cls = tone === 'error' ? 'bg-danger-bg text-danger' : 'bg-warn-bg text-warn';
  return (
    <div role="alert" className={`mb-3 rounded-[12px] px-3.5 py-2 text-sm font-semibold ${cls}`}>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 p-8 text-center text-muted">
      <div className="text-5xl" aria-hidden="true">
        {icon}
      </div>
      <p className="font-bold text-ink">{title}</p>
      {children}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Memuat" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-[16px] bg-brand-50" />
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
      className="m-auto w-[min(92vw,26rem)] rounded-[24px] bg-surface p-5 text-ink shadow-card backdrop:bg-black/60 max-sm:mb-0 max-sm:max-w-none max-sm:w-full max-sm:rounded-b-none"
    >
      <h2 id={titleId} className="mb-3 text-xl">
        {title}
      </h2>
      {children}
    </dialog>
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl">{title}</h1>
      {action}
    </div>
  );
}
