import { PIN_LOCK_MS, PIN_MAX_ATTEMPTS } from '../config';

/** Per-employee wrong-PIN state kept on this device (TDD §2.3: 5 wrong PINs lock for 5 minutes). */
export interface LockoutEntry {
  failures: number;
  lockedUntil: number | null;
}

export type LockoutState = Record<string, LockoutEntry>;

export function isLocked(state: LockoutState, employeeId: string, now: number): boolean {
  const until = state[employeeId]?.lockedUntil;
  return until != null && until > now;
}

export function remainingLockMs(state: LockoutState, employeeId: string, now: number): number {
  const until = state[employeeId]?.lockedUntil;
  return until != null && until > now ? until - now : 0;
}

export function attemptsLeft(state: LockoutState, employeeId: string): number {
  return Math.max(0, PIN_MAX_ATTEMPTS - (state[employeeId]?.failures ?? 0));
}

export function recordFailure(state: LockoutState, employeeId: string, now: number): LockoutState {
  const prev = state[employeeId];
  // An expired lock starts a fresh round of attempts.
  const base = prev?.lockedUntil != null && prev.lockedUntil <= now ? 0 : (prev?.failures ?? 0);
  const failures = base + 1;
  const lockedUntil = failures >= PIN_MAX_ATTEMPTS ? now + PIN_LOCK_MS : null;
  return { ...state, [employeeId]: { failures, lockedUntil } };
}

export function recordSuccess(state: LockoutState, employeeId: string): LockoutState {
  return Object.fromEntries(Object.entries(state).filter(([id]) => id !== employeeId));
}

/** Locked for N minutes label, rounded up: "5 menit". */
export function formatLockRemaining(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `${minutes} menit`;
}
