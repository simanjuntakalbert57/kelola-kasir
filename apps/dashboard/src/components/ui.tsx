import { AlertTriangle, Check, Clock, Info, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import type {
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
      <label htmlFor={id} className="mb-1 block text-sm font-extrabold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-12 w-full rounded-2xl bg-surface px-3.5 py-2.5 text-base text-ink ring-inset placeholder:text-muted ${error ? 'ring-2 ring-danger' : 'ring-1 ring-line-strong'}`}
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
  `min-h-12 w-full rounded-2xl bg-surface px-3.5 py-2.5 text-base text-ink ring-inset placeholder:text-muted ${error ? 'ring-2 ring-danger' : 'ring-1 ring-line-strong'}`;

export function SelectField({
  label,
  error,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string | undefined }) {
  const id = useId();
  return (
    <div className="mb-3.5">
      <label htmlFor={id} className="mb-1 block text-sm font-extrabold">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={controlCls(error)}
        {...props}
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

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl">{title}</h1>
      {action}
    </div>
  );
}
