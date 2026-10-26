import { Link, Outlet } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthProvider';

export const NAV = [
  { to: '/', label: 'Dashboard', short: 'Ringkasan' },
  { to: '/transaksi', label: 'Transaksi', short: 'Transaksi' },
  { to: '/produk', label: 'Produk', short: 'Produk' },
  { to: '/pegawai', label: 'Pegawai', short: null },
  { to: '/perangkat', label: 'Perangkat', short: null },
  { to: '/shift', label: 'Shift & Kas', short: 'Shift' },
  { to: '/void', label: 'Void', short: null },
  { to: '/pengaturan', label: 'Pengaturan', short: null },
] as const;

const tabs = NAV.filter((n) => n.short !== null);

const sideLink =
  'rounded-[12px] px-3.5 py-2.5 text-sm font-semibold text-[#bfd8cb] hover:bg-white/5';
const sideActive = 'bg-white/12 !text-white shadow-[inset_3px_0_0_var(--color-gold)]';

export function AppShell() {
  const { user, logout } = useAuth();
  const outlet = user?.outlets[0];
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="hidden w-56 shrink-0 flex-col gap-1 bg-side px-3 py-5 md:flex">
        <div className="px-3.5 pb-3.5 text-lg font-extrabold text-white">
          🍹 {outlet?.name ?? 'Kelola Kasir'}
        </div>
        <nav aria-label="Menu utama" className="flex flex-col gap-1">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === '/' }}
              className={sideLink}
              activeProps={{ className: `${sideLink} ${sideActive}`, 'aria-current': 'page' }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-3.5 pt-4 text-xs text-[#bfd8cb]">
          <p className="truncate">{user?.name}</p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-1 min-h-9 font-bold underline"
          >
            Keluar
          </button>
        </div>
      </aside>

      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 md:hidden">
        <b className="text-brand-text">{outlet?.name ?? 'Kelola Kasir'}</b>
      </header>

      <main className="min-w-0 flex-1 p-4 pb-24 md:px-6 md:py-5 md:pb-5">
        <Outlet />
      </main>

      <nav
        aria-label="Menu utama"
        className="fixed inset-x-0 bottom-0 z-10 flex bg-surface shadow-[0_-4px_20px_rgb(0_0_0/0.4)] md:hidden"
      >
        {tabs.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === '/' }}
            className="flex min-h-14 flex-1 items-center justify-center border-b-[3px] border-transparent px-1 text-xs font-bold text-muted"
            activeProps={{ className: 'border-gold text-brand-text', 'aria-current': 'page' }}
          >
            {n.short}
          </Link>
        ))}
        <Link
          to="/lainnya"
          className="flex min-h-14 flex-1 items-center justify-center border-b-[3px] border-transparent px-1 text-xs font-bold text-muted"
          activeProps={{ className: 'border-gold text-brand-text', 'aria-current': 'page' }}
        >
          Lainnya
        </Link>
      </nav>
    </div>
  );
}
