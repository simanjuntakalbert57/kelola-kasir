import type { SyncMutation } from '@kelola-kasir/contracts';
import type { ApiClient } from '../api/client';
import { get, type Db } from '../db/types';

export const PUSH_BATCH = 50;
export const PUSH_INTERVAL_MS = 30_000;

interface OutboxRow {
  id: string;
  type: SyncMutation['type'];
  employee_id: string | null;
  client_created_at: string;
  payload: string;
}

/** Mutations still waiting for the server (banner "N transaksi belum tersinkron"). */
export async function pendingCount(db: Db): Promise<number> {
  const row = await get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM outbox WHERE state = 'pending'",
  );
  return row?.n ?? 0;
}

export async function rejectedCount(db: Db): Promise<number> {
  const row = await get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM outbox WHERE state = 'rejected'",
  );
  return row?.n ?? 0;
}

/** Queues a mutation for `sync push` (call inside the same transaction as the local change). */
export async function enqueueMutation(
  db: Db,
  m: {
    id: string;
    type: SyncMutation['type'];
    employeeId: string | null;
    clientCreatedAt: string;
    payload: unknown;
  },
): Promise<void> {
  const seq =
    (await get<{ n: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM outbox'))?.n ?? 1;
  await db.run(
    `INSERT INTO outbox (id, seq, type, employee_id, client_created_at, payload, state)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [m.id, seq, m.type, m.employeeId, m.clientCreatedAt, JSON.stringify(m.payload)],
  );
}

/**
 * The server answers `UNSUPPORTED_MUTATION` while a feature (void requests) is not deployed. Such a
 * mutation stays `pending` (it is real work) but is skipped until the next app start.
 */
export const DEFERRED_CODE = 'UNSUPPORTED_MUTATION';

export async function resetDeferred(db: Db): Promise<void> {
  await db.run('UPDATE outbox SET error_code = NULL WHERE error_code = ?', [DEFERRED_CODE]);
}

export interface PushResult {
  sent: number;
  applied: number;
  rejected: number;
  remaining: number;
}

/**
 * Sends queued mutations in order, one batch (≤50) per call. `applied`/`duplicate` leave the outbox;
 * `rejected` is parked (state `rejected`, kept for support) so it cannot block the queue. Network
 * errors propagate untouched: nothing is lost, the next tick retries the same mutations.
 */
export async function pushOutbox(api: Pick<ApiClient, 'syncPush'>, db: Db): Promise<PushResult> {
  const rows = await db.all<OutboxRow>(
    `SELECT id, type, employee_id, client_created_at, payload FROM outbox
     WHERE state = 'pending' AND COALESCE(error_code, '') <> '${DEFERRED_CODE}'
     ORDER BY seq LIMIT ${PUSH_BATCH}`,
  );
  if (rows.length === 0) return { sent: 0, applied: 0, rejected: 0, remaining: 0 };
  const mutations: SyncMutation[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    client_created_at: r.client_created_at,
    ...(r.employee_id ? { employee_id: r.employee_id } : {}),
    payload: JSON.parse(r.payload) as Record<string, unknown>,
  }));
  const { results } = await api.syncPush(mutations);
  let applied = 0;
  let rejected = 0;
  await db.transaction(async (tx) => {
    for (const r of results) {
      if (r.status === 'rejected' && r.code === DEFERRED_CODE) {
        await tx.run('UPDATE outbox SET error_code = ?, attempts = attempts + 1 WHERE id = ?', [
          DEFERRED_CODE,
          r.id,
        ]);
      } else if (r.status === 'rejected') {
        rejected++;
        await tx.run(
          "UPDATE outbox SET state = 'rejected', error_code = ?, attempts = attempts + 1 WHERE id = ?",
          [r.code ?? 'REJECTED', r.id],
        );
        await tx.run("UPDATE transactions SET sync_state = 'rejected' WHERE id = ?", [r.id]);
      } else {
        applied++;
        await tx.run('DELETE FROM outbox WHERE id = ?', [r.id]);
        await tx.run("UPDATE transactions SET sync_state = 'synced' WHERE id = ?", [r.id]);
      }
    }
  });
  return { sent: rows.length, applied, rejected, remaining: await pendingCount(db) };
}
