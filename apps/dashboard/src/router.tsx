import {
  Navigate,
  useLocation,
  useRouter,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuth } from './auth/AuthProvider';
import { Skeleton } from './components/ui';
import { AppShell } from './layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShiftsPage } from './pages/ShiftsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { VoidPage } from './pages/VoidPage';
import { MorePage } from './pages/StubPages';

function Guard() {
  const { status } = useAuth();
  const router = useRouter();
  const { pathname, searchStr } = useLocation();
  const redirect = pathname + searchStr;
  useEffect(() => {
    // While the router is mid-transition Guard still renders with the /login location; do not redirect again.
    if (status === 'anonymous' && pathname !== '/login') {
      void router.navigate({ to: '/login', search: { redirect }, replace: true });
    }
  }, [status, pathname, redirect, router]);
  if (status === 'loading') {
    return (
      <div className="p-6">
        <Skeleton />
      </div>
    );
  }
  if (status === 'anonymous') return null;
  return <AppShell />;
}

/** Only same-origin paths are accepted, so `?redirect=` cannot bounce the owner to another site. */
function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    value !== '/login'
    ? value
    : undefined;
}

function LoginRoute() {
  const { status } = useAuth();
  const router = useRouter();
  const { redirect } = login.useSearch();
  useEffect(() => {
    if (status === 'authenticated' && redirect) router.history.replace(redirect);
  }, [status, redirect, router]);
  if (status === 'authenticated') return redirect ? null : <Navigate to="/" />;
  return <LoginPage />;
}

const root = createRootRoute({ component: Outlet });
const login = createRoute({
  getParentRoute: () => root,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = safeRedirect(search['redirect']);
    return redirect ? { redirect } : {};
  },
  component: LoginRoute,
});
const app = createRoute({ getParentRoute: () => root, id: 'app', component: Guard });

const page = <P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => app, path, component });

const transactions = createRoute({
  getParentRoute: () => app,
  path: '/transaksi',
  validateSearch: (
    search: Record<string, unknown>,
  ): { shift_id?: string; date_from?: string; date_to?: string } => {
    const shiftId = search['shift_id'];
    const dateOk = (v: unknown): v is string =>
      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const from = search['date_from'];
    const to = search['date_to'];
    return {
      ...(typeof shiftId === 'string' && /^[0-9a-f-]{36}$/i.test(shiftId)
        ? { shift_id: shiftId }
        : {}),
      ...(dateOk(from) && dateOk(to) ? { date_from: from, date_to: to } : {}),
    };
  },
  component: TransactionsPage,
});

const routeTree = root.addChildren([
  login,
  app.addChildren([
    page('/', DashboardPage),
    transactions,
    page('/produk', ProductsPage),
    page('/pegawai', EmployeesPage),
    page('/perangkat', DevicesPage),
    page('/shift', ShiftsPage),
    page('/void', VoidPage),
    page('/pengaturan', SettingsPage),
    page('/lainnya', MorePage),
  ]),
]);

export const createAppRouter = (history?: Parameters<typeof createRouter>[0]['history']) =>
  createRouter({ routeTree, ...(history ? { history } : {}) });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
