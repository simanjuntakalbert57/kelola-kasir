import { Link } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthProvider';
import { Card, EmptyState, PageHeader } from '../components/ui';
import { CountBadge, NAV, usePendingVoidCount } from '../layout/AppShell';

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState icon="🚧" title="Segera hadir">
          <p>Halaman ini dikerjakan di tugas berikutnya.</p>
        </EmptyState>
      </Card>
    </>
  );
}

/** Mobile "Lainnya" tab: items that do not fit in the 5-item bottom bar. */
export function MorePage() {
  const { logout } = useAuth();
  const pending = usePendingVoidCount();
  const extra = NAV.filter((n) => n.short === null);
  return (
    <>
      <PageHeader title="Lainnya" />
      <ul className="space-y-2">
        {extra.map((n) => (
          <li key={n.to}>
            <Link
              to={n.to}
              className="flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-4 py-3 font-extrabold shadow-card"
            >
              <n.icon size={22} aria-hidden="true" className="text-tint-ink" />
              {n.label}
              {n.to === '/void' ? <CountBadge count={pending} className="ml-auto" /> : null}
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => void logout()}
            className="block min-h-12 w-full rounded-2xl bg-surface px-4 py-3 text-left font-extrabold text-danger shadow-card"
          >
            Keluar
          </button>
        </li>
      </ul>
    </>
  );
}
