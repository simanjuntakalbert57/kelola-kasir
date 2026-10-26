import {
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { useAuth } from './auth/AuthProvider';
import { Skeleton } from './components/ui';
import { AppShell } from './layout/AppShell';
import { DevicesPage } from './pages/DevicesPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { LoginPage } from './pages/LoginPage';
import { ComingSoon, MorePage } from './pages/StubPages';

function Guard() {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="p-6">
        <Skeleton />
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/login" />;
  return <AppShell />;
}

function LoginRoute() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/" />;
  return <LoginPage />;
}

const root = createRootRoute({ component: Outlet });
const login = createRoute({ getParentRoute: () => root, path: '/login', component: LoginRoute });
const app = createRoute({ getParentRoute: () => root, id: 'app', component: Guard });

const page = <P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => app, path, component });

const routeTree = root.addChildren([
  login,
  app.addChildren([
    page('/', () => <ComingSoon title="Dashboard" />),
    page('/transaksi', () => <ComingSoon title="Transaksi" />),
    page('/produk', () => <ComingSoon title="Produk" />),
    page('/pegawai', EmployeesPage),
    page('/perangkat', DevicesPage),
    page('/shift', () => <ComingSoon title="Shift & Kas" />),
    page('/void', () => <ComingSoon title="Void" />),
    page('/pengaturan', () => <ComingSoon title="Pengaturan" />),
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
