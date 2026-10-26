import type { OutletSettings, Shift } from '@kelola-kasir/contracts';
import type { ApiClient } from '../api/client';
import { getMeta, META, setMeta } from '../db/meta';
import type { Db } from '../db/types';
import type { CatalogRepository } from './repository';

export interface PullResult {
  deviceRevoked: boolean;
  /** `undefined` when nothing was pulled; `null` when the outlet has no open shift. */
  currentShift?: Shift | null;
  changed: boolean;
}

/** Pulls every page since the stored cursor into SQLite (catalog + settings). Throws NetworkError offline. */
export async function pullCatalog(
  api: Pick<ApiClient, 'syncPull'>,
  db: Db,
  catalog: CatalogRepository,
): Promise<PullResult> {
  let cursor = (await getMeta(db, META.cursor)) ?? undefined;
  let result: PullResult = { deviceRevoked: false, changed: false };
  for (let page = 0; page < 100; page++) {
    const res = await api.syncPull(cursor);
    if (res.device_revoked) return { ...result, deviceRevoked: true };
    const ch = res.changes;
    await catalog.applyChanges(ch);
    if (ch.settings) await setMeta(db, META.settings, JSON.stringify(ch.settings));
    cursor = res.next_cursor;
    await setMeta(db, META.cursor, cursor);
    result = {
      deviceRevoked: false,
      currentShift: res.current_shift,
      changed:
        result.changed ||
        !!(ch.categories?.length || ch.products?.length || ch.deleted?.length || ch.settings),
    };
    if (!res.has_more) break;
  }
  return result;
}

export async function loadSettings(db: Db): Promise<OutletSettings | null> {
  const raw = await getMeta(db, META.settings);
  return raw ? (JSON.parse(raw) as OutletSettings) : null;
}
