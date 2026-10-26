import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db/testDb';
import { getMeta, META, setMeta } from '../db/meta';
import { enqueueMutation } from '../sync/outbox';
import { createCatalogRepository } from './repository';
import { resetCatalog } from './reset';

describe('resetCatalog (re-pairing)', () => {
  it('drops catalog, settings and cursor but keeps unsent outbox work', async () => {
    const db = await createTestDb();
    const catalog = createCatalogRepository(db);
    await catalog.applyChanges({
      categories: [{ id: 'c1', name: 'Jus', sort_order: 0 }],
      products: [
        {
          id: 'p1',
          category_id: 'c1',
          name: 'Jeruk',
          price: 12000,
          is_active: true,
          is_sold_out: false,
          sort_order: 0,
        } as never,
      ],
    });
    await setMeta(db, META.cursor, 'abc');
    await setMeta(db, META.settings, '{}');
    await db.transaction((tx) =>
      enqueueMutation(tx, {
        id: 'm1',
        type: 'shift.close',
        employeeId: 'e1',
        clientCreatedAt: new Date().toISOString(),
        payload: {},
      }),
    );

    await resetCatalog(db);

    expect(await catalog.productCount()).toBe(0);
    expect(await getMeta(db, META.cursor)).toBeNull();
    expect(await getMeta(db, META.settings)).toBeNull();
    expect((await db.all('SELECT id FROM outbox')).length).toBe(1);
  });
});
