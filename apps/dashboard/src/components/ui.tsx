import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

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
