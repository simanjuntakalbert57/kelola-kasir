import { Link } from '@tanstack/react-router';
import { useExpenseScope } from '../lib/expenses';

const tab =
  'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-extrabold text-muted hover:bg-bg';
const on = '!bg-tint !text-tint-ink';

/** Daftar | Rekap | Kategori (Kategori: owner only, so it is not rendered for a manager). */
export function ExpenseTabs() {
  const { isOwner, viewAll } = useExpenseScope();
  const items = [
    { to: '/pengeluaran', label: 'Daftar', exact: true },
    { to: '/pengeluaran/rekap', label: 'Rekap', exact: true },
    ...(isOwner && !viewAll
      ? [{ to: '/pengeluaran/kategori', label: 'Kelola kategori', exact: true }]
      : []),
  ];
  return (
    <nav aria-label="Bagian Pengeluaran" className="mb-4 flex flex-wrap gap-1.5">
      {items.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: t.exact }}
          className={tab}
          activeProps={{ className: `${tab} ${on}`, 'aria-current': 'page' }}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
