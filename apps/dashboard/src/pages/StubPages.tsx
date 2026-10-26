import { Link } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthProvider';
import { Card, EmptyState, PageHeader } from '../components/ui';
import { NAV } from '../layout/AppShell';

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
  const extra = NAV.filter((n) => n.short === null);
  return (
    <>
      <PageHeader title="Lainnya" />
      <ul className="space-y-2">
        {extra.map((n) => (
          <li key={n.to}>
            <Link
              to={n.to}
              className="block min-h-12 rounded-[16px] bg-surface px-4 py-3 font-bold shadow-card"
            >
              {n.label}
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => void logout()}
            className="block min-h-12 w-full rounded-[16px] bg-surface px-4 py-3 text-left font-bold text-danger shadow-card"
          >
            Keluar
          </button>
        </li>
      </ul>
    </>
  );
}
