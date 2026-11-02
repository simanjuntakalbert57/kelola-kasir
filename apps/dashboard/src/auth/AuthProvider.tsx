import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  type OwnerSession,
  outletBody,
  post,
  refreshSession,
  setAccessToken,
  setStoredOutletId,
  setUnauthorizedHandler,
} from '../lib/api';

type User = OwnerSession['user'];
type OutletRef = User['outlets'][number];
type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: User | null;
  /** Branch the access token is bound to (ADR-0020). */
  activeOutletId: string | null;
  activeOutlet: OutletRef | undefined;
  /** Role in the active branch; the dashboard only hides UI with it, the API enforces. */
  role: OutletRef['role'] | null;
  /** True while `switch-outlet` runs; the page shows a skeleton because the cache was dropped. */
  switching: boolean;
  /** Branch being switched to, for the "Mengganti ke …" label. */
  switchingTo: OutletRef | undefined;
  switchError: string | null;
  /** "Semua cabang" (read-only report scope), only for owners of ≥2 branches. */
  viewAll: boolean;
  setViewAll: (on: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchOutlet: (id: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Branches where the user is owner; "Semua cabang" needs at least two (ADR-0020 §2). */
export function ownedOutlets(user: User | null): OutletRef[] {
  return user?.outlets.filter((o) => o.role === 'owner') ?? [];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [activeOutletId, setActiveOutletId] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [viewAll, setViewAll] = useState(false);

  const apply = useCallback((session: OwnerSession) => {
    setUser(session.user);
    setActiveOutletId(session.active_outlet_id);
    setStoredOutletId(session.active_outlet_id);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setActiveOutletId(null);
    setViewAll(false);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    let active = true;
    void refreshSession().then((session) => {
      if (!active) return;
      if (session) apply(session);
      else setStatus('anonymous');
    });
    return () => {
      active = false;
      setUnauthorizedHandler(null);
    };
  }, [clear, apply]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await post<OwnerSession>('/auth/login', {
        email,
        password,
        ...outletBody(),
      });
      setAccessToken(session.access_token);
      queryClient.clear();
      apply(session);
    },
    [apply, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      clear();
    }
  }, [clear]);

  /** New token for another branch, then drop the whole cache: one missed key would show the old branch's data. */
  const switchOutlet = useCallback(
    async (id: string) => {
      if (id === activeOutletId) return true;
      setSwitchError(null);
      setSwitchingId(id);
      try {
        const session = await post<OwnerSession>('/auth/switch-outlet', { outlet_id: id });
        setAccessToken(session.access_token);
        queryClient.clear();
        apply(session);
        return true;
      } catch {
        setSwitchError('Gagal ganti cabang. Cabang tetap tidak berubah. Coba lagi.');
        return false;
      } finally {
        setSwitchingId(null);
      }
    },
    [activeOutletId, apply, queryClient],
  );

  const activeOutlet = user?.outlets.find((o) => o.id === activeOutletId);
  const switchingTo = user?.outlets.find((o) => o.id === switchingId);
  const canViewAll = ownedOutlets(user).length >= 2 && activeOutlet?.role === 'owner';

  const value = useMemo(
    () => ({
      status,
      user,
      activeOutletId,
      activeOutlet,
      role: activeOutlet?.role ?? null,
      switching: switchingId !== null,
      switchingTo,
      switchError,
      viewAll: viewAll && canViewAll,
      setViewAll,
      login,
      logout,
      switchOutlet,
    }),
    [
      status,
      user,
      activeOutletId,
      activeOutlet,
      switchingId,
      switchingTo,
      switchError,
      viewAll,
      canViewAll,
      login,
      logout,
      switchOutlet,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
