/**
 * In-process state that keeps an idle API from querying the database (ADR-0011: Neon Free compute
 * hours). Valid for a single API instance; a restart empties everything and the first request
 * refills it.
 */

/** Longest a cached answer may be reused, as a safety net for writes made outside the API. */
export const CACHE_MAX_AGE_MS = 15 * 60_000;

/** A cashier that was active this recently proves the database is awake anyway. */
const RECENT_ACTIVITY_MS = 2 * 60_000;

/**
 * Data version of the API instance. Every mutating request (and background state change such as a
 * QRIS expiry) bumps it, which invalidates every cached read model at once. Cached answers store the
 * epoch they were computed at and are only served while it is unchanged.
 */
export class ChangeTracker {
  private current = 0;
  private lastBumpAt = 0;
  private pendingListeners: ((expiresAt: Date) => void)[] = [];

  constructor(private readonly clock: () => number = Date.now) {}

  epoch(): number {
    return this.current;
  }

  bump(): void {
    this.current += 1;
    this.lastBumpAt = this.clock();
  }

  /** True when a write went through shortly ago, so one more tiny write costs no extra compute. */
  recentlyActive(): boolean {
    return this.clock() - this.lastBumpAt < RECENT_ACTIVITY_MS;
  }

  /** A QRIS payment that expires at `expiresAt` was created: the expiry timer must cover it. */
  pendingPayment(expiresAt: Date): void {
    for (const listener of this.pendingListeners) listener(expiresAt);
  }

  onPendingPayment(listener: (expiresAt: Date) => void): void {
    this.pendingListeners.push(listener);
  }
}

export interface CachedDevice {
  id: string;
  outletId: string;
  code: string;
  name: string;
}

interface DeviceEntry {
  device: CachedDevice;
  loadedAt: number;
  /** Last time `last_seen_at` was written to the database for this device. */
  seenWrittenAt: number;
}

/** `X-Device-Token` hash → paired, non-revoked device. Revoking a device evicts it immediately. */
export class DeviceTokenCache {
  private readonly entries = new Map<string, DeviceEntry>();

  constructor(private readonly ttlMs = CACHE_MAX_AGE_MS) {}

  get(tokenHash: string, nowMs: number): DeviceEntry | undefined {
    const entry = this.entries.get(tokenHash);
    if (!entry) return undefined;
    if (nowMs - entry.loadedAt >= this.ttlMs) {
      this.entries.delete(tokenHash);
      return undefined;
    }
    return entry;
  }

  set(tokenHash: string, device: CachedDevice, nowMs: number, seenWrittenAt: number): void {
    this.entries.set(tokenHash, { device, loadedAt: nowMs, seenWrittenAt });
  }

  invalidateDevice(deviceId: string): void {
    for (const [hash, entry] of this.entries) {
      if (entry.device.id === deviceId) this.entries.delete(hash);
    }
  }
}

/** The last `sync/pull` answer per device, served again while nothing changed. */
export class PullCache<T> {
  private readonly entries = new Map<string, { epoch: number; key: string; at: number; body: T }>();

  get(deviceId: string, key: string, epoch: number, nowMs: number): T | undefined {
    const entry = this.entries.get(deviceId);
    if (!entry || entry.epoch !== epoch || entry.key !== key) return undefined;
    if (nowMs - entry.at >= CACHE_MAX_AGE_MS) return undefined;
    return entry.body;
  }

  set(deviceId: string, key: string, epoch: number, nowMs: number, body: T): void {
    this.entries.set(deviceId, { epoch, key, at: nowMs, body });
  }

  invalidateDevice(deviceId: string): void {
    this.entries.delete(deviceId);
  }
}
