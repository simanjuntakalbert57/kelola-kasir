import { Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { VoidRequest } from '@kelola-kasir/contracts';
import {
  Bell,
  CircleX,
  CupSoda,
  Ellipsis,
  House,
  LogOut,
  Receipt,
  Smartphone,
  Store,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { api, qs } from '../lib/api';
import { ThemeToggle } from '../components/ThemeToggle';
import { PushBridge } from '../components/PushBridge';

export const NAV: readonly {
  to: string;
  label: string;
  short: string | null;
  icon: LucideIcon;
}[] = [
  { to: '/', label: 'Ringkasan', short: 'Ringkasan', icon: House },
  { to: '/transaksi', label: 'Transaksi', short: 'Transaksi', icon: Receipt },
  { to: '/produk', label: 'Produk & Kategori', short: 'Produk', icon: CupSoda },
  { to: '/pegawai', label: 'Pegawai', short: null, icon: Users },
  { to: '/perangkat', label: 'Perangkat', short: null, icon: Smartphone },
  { to: '/shift', label: 'Shift & Kas', short: 'Shift', icon: Wallet },
  { to: '/void', label: 'Persetujuan batal', short: null, icon: CircleX },
  { to: '/pengaturan', label: 'Pengaturan', short: null, icon: Store },
  { to: '/pengaturan/notifikasi', label: 'Notifikasi', short: null, icon: Bell },
];

const tabs = NAV.filter((n) => n.short !== null);

/** Number of void requests waiting for the owner; shared with the Void page via the query cache. */
export function usePendingVoidCount(): number {
  const { data } = useQuery({
    queryKey: ['void-requests', 'pending-count'],
    queryFn: () =>
      api<{ data: VoidRequest[] }>(`/void-requests${qs({ status: 'pending', limit: 10 })}`).then(
        (r) => r.data.length,
      ),
    retry: false,
    refetchInterval: 60_000,
  });
  return data ?? 0;
}

export function CountBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} permintaan batal menunggu`}
      className={`rounded-full bg-danger px-2.5 text-[12.5px] font-extrabold text-on-danger ${className}`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

const sideLink =
  'flex min-h-[46px] items-center gap-2.5 rounded-2xl px-3 text-[15px] font-extrabold text-ink hover:bg-bg';
const sideActive = '!bg-tint !text-tint-ink';
const tabLink =
  'relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-extrabold text-muted';
const tabActive = 'bg-tint text-tint-ink';

export function AppShell() {
  const { user, logout } = useAuth();
  const outlet = user?.outlets[0];
  const pending = usePendingVoidCount();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <PushBridge />
      <aside className="hidden w-62 shrink-0 flex-col gap-1 border-r border-line bg-side px-2.5 py-5 md:flex">
        <div className="flex items-center gap-3 px-2 pb-4">
          <div
            aria-hidden="true"
            className="grid size-11 place-items-center rounded-2xl bg-tint text-2xl"
          >
            🍹
          </div>
          <div className="min-w-0 leading-tight">
            <b className="block truncate text-base font-extrabold">
              {outlet?.name ?? 'Kelola Kasir'}
            </b>
            <small className="text-[13px] font-bold text-muted">Dashboard Pemilik</small>
          </div>
        </div>
        <nav aria-label="Menu utama" className="flex flex-col gap-1">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === '/' || n.to === '/pengaturan' }}
              className={sideLink}
              activeProps={{ className: `${sideLink} ${sideActive}`, 'aria-current': 'page' }}
            >
              <n.icon size={20} aria-hidden="true" />
              {n.label}
              {n.to === '/void' ? <CountBadge count={pending} className="ml-auto" /> : null}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 px-2 pt-4">
          <div
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-full bg-tint font-extrabold text-tint-ink"
          >
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <b className="block truncate text-sm font-extrabold">{user?.name}</b>
            <small className="text-xs font-bold text-muted">Pemilik</small>
          </div>
          <button
            type="button"
            aria-label="Keluar"
            onClick={() => void logout()}
            className="grid size-11 place-items-center rounded-2xl text-muted hover:bg-bg"
          >
            <LogOut size={20} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-[1264px] min-w-0 flex-1 p-4 pb-28 md:px-8 md:py-6 md:pb-6">
        <div className="-mb-1 flex justify-end">
          <ThemeToggle />
        </div>
        <Outlet />
      </main>

      <nav
        aria-label="Menu utama"
        className="fixed inset-x-0 bottom-0 z-10 flex gap-1 border-t border-line bg-surface px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-up md:hidden"
      >
        {tabs.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === '/' }}
            className={tabLink}
            activeProps={{ className: `${tabLink} ${tabActive}`, 'aria-current': 'page' }}
          >
            <n.icon size={24} aria-hidden="true" />
            {n.short}
          </Link>
        ))}
        <Link
          to="/lainnya"
          className={tabLink}
          activeProps={{ className: `${tabLink} ${tabActive}`, 'aria-current': 'page' }}
        >
          <Ellipsis size={24} aria-hidden="true" />
          Lainnya
          <CountBadge
            count={pending}
            className="absolute top-0.5 right-[calc(50%-26px)] px-1.5 !text-[11.5px]"
          />
        </Link>
      </nav>
    </div>
  );
}
