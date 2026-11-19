import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { DiscountRule } from '@kelola-kasir/money';
import { NetworkError } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import {
  createCatalogRepository,
  type CatalogProduct,
  type CatalogRepository,
} from '../catalog/repository';
import { resetCatalog } from '../catalog/reset';
import { pullCatalog } from '../catalog/sync';
import { openDatabase } from '../db/expoDb';
import { getMeta, META, setMeta } from '../db/meta';
import type { Db } from '../db/types';
import { pendingCount, pushOutbox, PUSH_INTERVAL_MS, resetDeferred } from '../sync/outbox';
import { cartAfterPayment, emptyCart, type Cart } from './cart';
import type { CashSale, SaleContext } from './checkout';
import { priceCart, quoteProduct } from './pricing';
import type { QrisSession } from './qris';
import type { DiscountQuote } from '@kelola-kasir/money';

/** Catalog refresh: the owner's product edits reach the cashier within a minute (design DEAR-5). */
export const PULL_INTERVAL_MS = 60_000;
/** Prices are re-evaluated every minute so a happy hour starts and ends on the cart without a tap (ADR-0023 §2). */
export const PRICING_TICK_MS = 60_000;

export interface CompletedSale {
  id: string;
  number: string;
  total: number;
  method: 'cash' | 'qris';
  cashTendered?: number;
  change?: number;
}

export interface SalesValue {
  db: Db | null;
  catalog: CatalogRepository | null;
  /** Bumped after every catalog pull so the grid reloads. */
  catalogVersion: number;
  /** The cart priced with the synced discount rules at `pricingAt`. */
  cart: Cart;
  /** Instant the cart is priced at: the live clock, or the moment of **Bayar** once `lockPricing` ran. */
  pricingAt: Date;
  /** Best discount of a catalog product right now (card price, strikethrough, ribbon). */
  quote: (product: CatalogProduct) => DiscountQuote | null;
  /** Freezes prices at this instant when the cashier presses Bayar; the sale is created at the same instant. */
  lockPricing: () => Date;
  unlockPricing: () => void;
  /** After `DISCOUNT_STALE`: pull the catalog, reload the rules and re-price the cart at a new locked instant. Throws offline. */
  refreshPricing: () => Promise<void>;
  setCart: (update: (cart: Cart) => Cart) => void;
  /** Last network outcome: false after a network failure, true after any success. */
  online: boolean;
  pending: number;
  printReceipt: boolean;
  setPrintReceipt: (on: boolean) => void;
  saleContext: SaleContext | null;
  lastSale: CompletedSale | null;
  completeSale: (sale: CompletedSale) => void;
  qris: QrisSession | null;
  setQris: (session: QrisSession | null) => void;
  newOrder: () => void;
  refreshPending: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const Ctx = createContext<SalesValue | null>(null);

export function useSales(): SalesValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSales must be used inside SalesProvider');
  return value;
}

export function toCompleted(sale: CashSale): CompletedSale {
  return {
    id: sale.id,
    number: sale.number,
    total: sale.total,
    method: 'cash',
    cashTendered: sale.cashTendered,
    change: sale.change,
  };
}

export function SalesProvider({ children }: { children: ReactNode }) {
  const { boot, api, paired, session, shift, resetDevice } = useSession();
  const [db, setDb] = useState<Db | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [rawCart, setCartState] = useState<Cart>(emptyCart);
  const [rules, setRules] = useState<readonly DiscountRule[]>([]);
  const [clock, setClock] = useState(() => new Date());
  const [lockedAt, setLockedAt] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [printReceipt, setPrintReceiptState] = useState(true);
  const [lastSale, setLastSale] = useState<CompletedSale | null>(null);
  const [qris, setQris] = useState<QrisSession | null>(null);
  const busy = useRef({ pull: false, push: false });

  useEffect(() => {
    void openDatabase().then(async (opened) => {
      await resetDeferred(opened);
      setDb(opened);
      setPrintReceiptState((await getMeta(opened, META.printReceipt)) !== '0');
      setPending(await pendingCount(opened));
    });
  }, []);

  const catalog = useMemo(() => (db ? createCatalogRepository(db) : null), [db]);
  const paired_ = !!paired;

  // Unpaired (revoked or reset): drop catalog + cursor so the next pairing starts clean. The outbox stays.
  useEffect(() => {
    if (db && boot === 'ready' && !paired_) {
      void resetCatalog(db).then(() => setCatalogVersion((v) => v + 1));
    }
  }, [db, boot, paired_]);

  const loadRules = useCallback(async () => {
    if (catalog) setRules(await catalog.listDiscountRules());
  }, [catalog]);

  useEffect(() => {
    void loadRules();
  }, [loadRules, catalogVersion]);

  // Re-price every minute (happy hour start/end) unless the price is locked for payment.
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), PRICING_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const pricingAt = lockedAt ?? clock;
  const cart = useMemo(() => priceCart(rawCart, rules, pricingAt), [rawCart, rules, pricingAt]);
  const quote = useCallback(
    (product: CatalogProduct) =>
      quoteProduct(
        rules,
        { id: product.id, categoryId: product.categoryId, price: product.price },
        pricingAt,
      ),
    [rules, pricingAt],
  );
  const lockPricing = useCallback(() => {
    const at = new Date();
    setLockedAt(at);
    return at;
  }, []);
  const unlockPricing = useCallback(() => {
    setLockedAt(null);
    setClock(new Date());
  }, []);
  const refreshPricing = useCallback(async () => {
    if (!db || !catalog) return;
    await pullCatalog(api, db, catalog);
    await loadRules();
    setCatalogVersion((v) => v + 1);
    setLockedAt(new Date());
  }, [api, db, catalog, loadRules]);

  const refreshPending = useCallback(async () => {
    if (db) setPending(await pendingCount(db));
  }, [db]);

  const pull = useCallback(async () => {
    if (!db || !catalog || !paired_ || busy.current.pull) return;
    busy.current.pull = true;
    try {
      const res = await pullCatalog(api, db, catalog);
      setOnline(true);
      if (res.deviceRevoked) await resetDevice();
      else if (res.changed) setCatalogVersion((v) => v + 1);
    } catch (error) {
      if (error instanceof NetworkError) setOnline(false);
    } finally {
      busy.current.pull = false;
    }
  }, [api, db, catalog, paired_, resetDevice]);

  const push = useCallback(async () => {
    if (!db || !paired_ || busy.current.push) return;
    busy.current.push = true;
    try {
      let result = await pushOutbox(api, db);
      // An empty outbox makes no request, so it proves nothing about connectivity: only a real round trip
      // may flip the indicator back to online (otherwise the idle push tick masks a failed pull/push).
      const reached = result.sent > 0;
      while (result.remaining > 0 && result.sent > 0) result = await pushOutbox(api, db);
      if (reached) setOnline(true);
    } catch (error) {
      if (error instanceof NetworkError) setOnline(false);
    } finally {
      busy.current.push = false;
      setPending(await pendingCount(db));
    }
  }, [api, db, paired_]);

  const signedIn = !!session;
  useEffect(() => {
    if (!db || !paired_ || !signedIn) return;
    void pull();
    void push();
    const a = setInterval(() => void pull(), PULL_INTERVAL_MS);
    const b = setInterval(() => void push(), PUSH_INTERVAL_MS);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [db, paired_, signedIn, pull, push]);

  const saleContext = useMemo<SaleContext | null>(
    () =>
      paired && session && shift
        ? {
            outletCode: paired.outlet.code,
            deviceCode: paired.device.code,
            timeZone: paired.outlet.timezone,
            shiftId: shift.id,
            employee: { id: session.employeeId, name: session.employeeName },
          }
        : null,
    [paired, session, shift],
  );

  const value = useMemo<SalesValue>(
    () => ({
      db,
      catalog,
      catalogVersion,
      cart,
      pricingAt,
      quote,
      lockPricing,
      unlockPricing,
      refreshPricing,
      setCart: (update) => {
        setClock(new Date());
        setCartState(update);
      },
      online,
      pending,
      printReceipt,
      setPrintReceipt: (on) => {
        setPrintReceiptState(on);
        if (db) void setMeta(db, META.printReceipt, on ? '1' : '0');
      },
      saleContext,
      lastSale,
      completeSale: (sale) => {
        setLastSale(sale);
        setCartState((c) => cartAfterPayment(c, true));
        setLockedAt(null);
        setQris(null);
        void refreshPending();
        void push();
      },
      qris,
      setQris,
      newOrder: () => {
        setLastSale(null);
        setLockedAt(null);
        setCartState(emptyCart);
      },
      refreshPending,
      syncNow: async () => {
        await push();
        await pull();
      },
    }),
    [
      db,
      catalog,
      catalogVersion,
      cart,
      pricingAt,
      quote,
      lockPricing,
      unlockPricing,
      refreshPricing,
      online,
      pending,
      printReceipt,
      saleContext,
      lastSale,
      qris,
      refreshPending,
      push,
      pull,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
