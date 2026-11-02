import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, expenseHistory } from '../src/db/schema.js';
import { createShop, createTestEnv, get, json, patch, post, type TestEnv } from './helpers.js';
import {
  categoryId,
  createBranches,
  createMember,
  del,
  expenseBody,
  loginAs,
  newId,
  seedCategories,
  switchTo,
  addMembership,
} from './branch-helpers.js';

const storage = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'media',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret-example',
  region: 'auto',
  apiPublicBaseUrl: 'https://api.example',
};

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv({ storage });
});
afterAll(async () => {
  await env.close();
});

interface Expense {
  id: string;
  outlet: { id: string };
  category: { id: string; name: string };
  amount: number;
  description: string;
  receipt_url: string | null;
  deleted: { reason: string } | null;
  updated_by: { name: string };
}
interface Detail extends Expense {
  history: {
    action: string;
    changes: Record<string, { from: unknown; to: unknown }> | null;
    reason: string | null;
  }[];
}
interface Listed {
  data: Expense[];
  next_cursor: string | null;
  summary: { count: number; total_amount: number };
}

async function fixture() {
  const branches = await createBranches(env);
  const cat = await categoryId(env, branches.ownerA.headers);
  return { ...branches, cat };
}
const createExpense = async (headers: Record<string, string>, body: object, status = 201) => {
  const res = await post(env, '/v1/expenses', headers, body);
  expect(res.statusCode, res.body).toBe(status);
  return json<Expense>(res);
};

describe('expense categories', () => {
  it('lists the seeded defaults ordered by group, and lets only the owner write', async () => {
    const f = await fixture();
    const list = json<{ data: { name: string; group: string; archived: boolean }[] }>(
      await get(env, '/v1/expense-categories', f.ownerA.headers),
    ).data;
    expect(list).toHaveLength(12);
    expect(list.map((c) => c.group)).toEqual([
      ...Array<string>(4).fill('hpp'),
      ...Array<string>(4).fill('operasional'),
      ...Array<string>(2).fill('tetap'),
      ...Array<string>(2).fill('lainnya'),
    ]);
    expect(list[0]?.name).toBe('Buah');

    const manager = await createMember(env, f.a, 'manager');
    expect(
      json<{ data: unknown[] }>(await get(env, '/v1/expense-categories', manager.headers)).data,
    ).toHaveLength(12);
    const denied = await post(env, '/v1/expense-categories', manager.headers, {
      group: 'hpp',
      name: 'Susu',
    });
    expect(denied.statusCode).toBe(403);
  });

  it('creates, renames, regroups and archives; names are unique among active categories', async () => {
    const f = await fixture();
    const created = await post(env, '/v1/expense-categories', f.ownerA.headers, {
      group: 'operasional',
      name: '  Parkir  ',
    });
    expect(created.statusCode).toBe(201);
    const cat = json<{ id: string; name: string; sort_order: number }>(created);
    expect(cat.name).toBe('Parkir');
    expect(cat.sort_order).toBe(150); // after the last of the group (140)

    const clash = await post(env, '/v1/expense-categories', f.ownerA.headers, {
      group: 'tetap',
      name: 'parkir',
    });
    expect(clash.statusCode).toBe(409);
    expect(json<{ code: string }>(clash).code).toBe('EXPENSE_CATEGORY_NAME_TAKEN');
    // Another outlet may use the same name.
    const other = await post(
      env,
      '/v1/expense-categories',
      await switchTo(env, f.ownerA.headers, f.b.outletId),
      {
        group: 'tetap',
        name: 'Parkir',
      },
    );
    expect(other.statusCode).toBe(201);

    const renamed = await patch(env, `/v1/expense-categories/${cat.id}`, f.ownerA.headers, {
      name: 'Parkir motor',
      group: 'lainnya',
    });
    expect(renamed.statusCode).toBe(200);
    expect(json(renamed)).toMatchObject({
      name: 'Parkir motor',
      group: 'lainnya',
      archived: false,
    });

    const archived = await patch(env, `/v1/expense-categories/${cat.id}`, f.ownerA.headers, {
      archived: true,
    });
    expect(json(archived)).toMatchObject({ archived: true });
    const visible = json<{ data: { id: string }[] }>(
      await get(env, '/v1/expense-categories', f.ownerA.headers),
    ).data;
    expect(visible.some((c) => c.id === cat.id)).toBe(false);
    const all = json<{ data: { id: string }[] }>(
      await get(env, '/v1/expense-categories?include_archived=true', f.ownerA.headers),
    ).data;
    expect(all.some((c) => c.id === cat.id)).toBe(true);
    // The name is free again while archived, and unarchiving a clash is refused.
    expect(
      (
        await post(env, '/v1/expense-categories', f.ownerA.headers, {
          group: 'tetap',
          name: 'Parkir motor',
        })
      ).statusCode,
    ).toBe(201);
    const back = await patch(env, `/v1/expense-categories/${cat.id}`, f.ownerA.headers, {
      archived: false,
    });
    expect(back.statusCode).toBe(409);

    const audits = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, cat.id));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'expense_category.created',
      'expense_category.updated',
      'expense_category.updated',
    ]);
    expect(
      (await patch(env, `/v1/expense-categories/${cat.id}`, f.ownerA.headers, {})).statusCode,
    ).toBe(400);
  });

  it('does not reach a category of another outlet', async () => {
    const f = await fixture();
    const bCat = await categoryId(env, await switchTo(env, f.ownerA.headers, f.b.outletId));
    const res = await patch(env, `/v1/expense-categories/${bCat}`, f.ownerA.headers, { name: 'X' });
    expect(res.statusCode).toBe(404);
  });
});

describe('expenses CRUD', () => {
  it('creates idempotently and writes history and audit in one go', async () => {
    const f = await fixture();
    const id = newId();
    const body = expenseBody(f.cat, { id, description: '  Mangga 10 kg ' });
    const created = await createExpense(f.ownerA.headers, body);
    expect(created).toMatchObject({
      id,
      amount: 150_000,
      description: 'Mangga 10 kg',
      receipt_url: null,
    });
    expect(created.outlet.id).toBe(f.a.outletId);

    const replay = await createExpense(f.ownerA.headers, body, 200);
    expect(replay.id).toBe(id);
    const reused = await post(env, '/v1/expenses', f.ownerA.headers, { ...body, amount: 1 });
    expect(reused.statusCode).toBe(409);
    expect(json<{ code: string }>(reused).code).toBe('ID_REUSED');

    expect(
      await env.handle.db.select().from(expenseHistory).where(eq(expenseHistory.expenseId, id)),
    ).toHaveLength(1);
    const audits = await env.handle.db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(audits.map((a) => a.action)).toEqual(['expense.created']);
    // The same id from another outlet is also refused, not overwritten.
    const bHeaders = await switchTo(env, f.ownerA.headers, f.b.outletId);
    const bCat = await categoryId(env, bHeaders);
    const foreign = await post(env, '/v1/expenses', bHeaders, expenseBody(bCat, { id }));
    expect(foreign.statusCode).toBe(409);
  });

  it('validates input', async () => {
    const f = await fixture();
    const bad = async (over: object, status: number, code?: string) => {
      const res = await post(env, '/v1/expenses', f.ownerA.headers, expenseBody(f.cat, over));
      expect(res.statusCode, JSON.stringify(over)).toBe(status);
      if (code) expect(json<{ code: string }>(res).code).toBe(code);
    };
    await bad({ amount: 0 }, 400);
    await bad({ amount: 1_000_000_001 }, 400);
    await bad({ amount: 1.5 }, 400);
    await bad({ description: '   ' }, 400);
    await bad({ spent_on: '2019-12-31' }, 400);
    await bad({ spent_on: '2999-01-01' }, 400);
    await bad({ funding_source: 'bank' }, 400);
    await bad({ category_id: newId() }, 400, 'VALIDATION_ERROR');
    await bad({ receipt_url: 'https://evil.example/x.jpg' }, 422, 'INVALID_RECEIPT_URL');

    const bCat = await categoryId(env, await switchTo(env, f.ownerA.headers, f.b.outletId));
    await bad({ category_id: bCat }, 400, 'VALIDATION_ERROR');

    const archived = json<{ id: string }>(
      await post(env, '/v1/expense-categories', f.ownerA.headers, {
        group: 'lainnya',
        name: 'Lama',
      }),
    );
    await patch(env, `/v1/expense-categories/${archived.id}`, f.ownerA.headers, { archived: true });
    await bad({ category_id: archived.id }, 422, 'EXPENSE_CATEGORY_ARCHIVED');
  });

  it('keeps the receipt as an object key of the same outlet and rebuilds the URL', async () => {
    const f = await fixture();
    const url = `https://api.example/v1/media/${f.a.outletId}/expense_receipt/${newId()}.jpg`;
    const created = await createExpense(f.ownerA.headers, expenseBody(f.cat, { receipt_url: url }));
    expect(created.receipt_url).toBe(url);
    const other = `https://api.example/v1/media/${f.b.outletId}/expense_receipt/${newId()}.jpg`;
    const res = await post(
      env,
      '/v1/expenses',
      f.ownerA.headers,
      expenseBody(f.cat, { receipt_url: other }),
    );
    expect(res.statusCode).toBe(422);
    const wrongPurpose = `https://api.example/v1/media/${f.a.outletId}/logo/${newId()}.png`;
    expect(
      (
        await post(
          env,
          '/v1/expenses',
          f.ownerA.headers,
          expenseBody(f.cat, { receipt_url: wrongPurpose }),
        )
      ).statusCode,
    ).toBe(422);

    const removed = await patch(env, `/v1/expenses/${created.id}`, f.ownerA.headers, {
      receipt_url: null,
    });
    expect(json<Expense>(removed).receipt_url).toBeNull();
    // The media endpoint serves the new purpose.
    const media = await get(env, `/v1/media/${f.a.outletId}/expense_receipt/${newId()}.jpg`, {});
    expect(media.statusCode).toBe(302);
  });

  it('corrects an expense with history; a no-op writes nothing; deleted rows are frozen', async () => {
    const f = await fixture();
    const created = await createExpense(f.ownerA.headers, expenseBody(f.cat));
    const manager = await createMember(env, f.a, 'manager', 'Manager A');
    const es = await categoryId(env, f.ownerA.headers, 'Es batu');

    const updated = await patch(env, `/v1/expenses/${created.id}`, manager.headers, {
      amount: 175_000,
      category_id: es,
      description: 'Mangga 12 kg',
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(json<Expense>(updated)).toMatchObject({
      amount: 175_000,
      updated_by: { name: 'Manager A' },
    });

    const noop = await patch(env, `/v1/expenses/${created.id}`, f.ownerA.headers, {
      amount: 175_000,
    });
    expect(noop.statusCode).toBe(200);
    const detail = json<Detail>(await get(env, `/v1/expenses/${created.id}`, f.ownerA.headers));
    expect(detail.history.map((h) => h.action)).toEqual(['create', 'update']);
    expect(detail.history[1]?.changes).toMatchObject({
      amount: { from: 150_000, to: 175_000 },
      description: { from: 'Mangga 10 kg', to: 'Mangga 12 kg' },
      category_id: { from: { name: 'Buah' }, to: { name: 'Es batu' } },
    });
    const audits = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.id));
    expect(audits.map((a) => a.action).sort()).toEqual(['expense.created', 'expense.updated']);

    expect(
      (await del(env, `/v1/expenses/${created.id}`, f.ownerA.headers, { reason: 'Salah catat' }))
        .statusCode,
    ).toBe(200);
    const frozen = await patch(env, `/v1/expenses/${created.id}`, f.ownerA.headers, { amount: 1 });
    expect(frozen.statusCode).toBe(409);
    expect(json<{ code: string }>(frozen).code).toBe('EXPENSE_DELETED');
    expect((await patch(env, `/v1/expenses/${created.id}`, f.ownerA.headers, {})).statusCode).toBe(
      400,
    );
  });

  it('soft-deletes (owner only, idempotent) and restores with history', async () => {
    const f = await fixture();
    const created = await createExpense(f.ownerA.headers, expenseBody(f.cat));
    const manager = await createMember(env, f.a, 'manager');
    const url = `/v1/expenses/${created.id}`;

    expect((await del(env, url, manager.headers, { reason: 'Salah catat' })).statusCode).toBe(403);
    expect((await del(env, url, f.ownerA.headers, { reason: 'x' })).statusCode).toBe(400);
    const deleted = await del(env, url, f.ownerA.headers, { reason: '  Salah catat  ' });
    expect(json<Expense>(deleted).deleted).toMatchObject({ reason: 'Salah catat' });
    const again = await del(env, url, f.ownerA.headers, { reason: 'Alasan lain' });
    expect(again.statusCode).toBe(200);
    expect(json<Expense>(again).deleted?.reason).toBe('Salah catat');

    // Hidden from the active list and from managers, visible in Riwayat Hapus for the owner.
    expect(json<Listed>(await get(env, '/v1/expenses', f.ownerA.headers)).data).toHaveLength(0);
    expect(
      json<Listed>(await get(env, '/v1/expenses?status=deleted', f.ownerA.headers)).data,
    ).toHaveLength(1);
    expect((await get(env, '/v1/expenses?status=deleted', manager.headers)).statusCode).toBe(403);
    expect((await get(env, url, manager.headers)).statusCode).toBe(404);

    expect((await post(env, `${url}/restore`, manager.headers, undefined)).statusCode).toBe(403);
    const restored = await post(env, `${url}/restore`, f.ownerA.headers, {
      note: 'Ternyata benar',
    });
    expect(json<Expense>(restored).deleted).toBeNull();
    expect((await post(env, `${url}/restore`, f.ownerA.headers, undefined)).statusCode).toBe(200);

    const detail = json<Detail>(await get(env, url, f.ownerA.headers));
    expect(detail.history.map((h) => [h.action, h.reason])).toEqual([
      ['create', null],
      ['delete', 'Salah catat'],
      ['restore', 'Ternyata benar'],
    ]);
    const audits = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.id));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'expense.created',
      'expense.deleted',
      'expense.restored',
    ]);
  });

  it('lists with filters, summary over all matches, and cursor paging', async () => {
    const f = await fixture();
    const es = await categoryId(env, f.ownerA.headers, 'Es batu');
    const gas = await categoryId(env, f.ownerA.headers, 'Gas');
    await createExpense(
      f.ownerA.headers,
      expenseBody(f.cat, { spent_on: '2026-03-01', amount: 100 }),
    );
    await createExpense(
      f.ownerA.headers,
      expenseBody(es, {
        spent_on: '2026-03-05',
        amount: 200,
        funding_source: 'drawer',
        description: 'Es batu kristal',
      }),
    );
    await createExpense(
      f.ownerA.headers,
      expenseBody(gas, { spent_on: '2026-03-05', amount: 300 }),
    );
    const dropped = await createExpense(
      f.ownerA.headers,
      expenseBody(gas, { spent_on: '2026-03-06', amount: 400 }),
    );
    await del(env, `/v1/expenses/${dropped.id}`, f.ownerA.headers, { reason: 'Dobel catat' });

    const all = json<Listed>(await get(env, '/v1/expenses', f.ownerA.headers));
    expect(all.summary).toEqual({ count: 3, total_amount: 600 });
    expect(all.data.map((e) => e.amount)).toEqual([300, 200, 100]);

    const page1 = json<Listed>(await get(env, '/v1/expenses?limit=2', f.ownerA.headers));
    expect(page1.data.map((e) => e.amount)).toEqual([300, 200]);
    expect(page1.summary.count).toBe(3);
    const page2 = json<Listed>(
      await get(env, `/v1/expenses?limit=2&cursor=${page1.next_cursor}`, f.ownerA.headers),
    );
    expect(page2.data.map((e) => e.amount)).toEqual([100]);
    expect(page2.next_cursor).toBeNull();

    const filtered = async (query: string) =>
      json<Listed>(await get(env, `/v1/expenses?${query}`, f.ownerA.headers));
    expect((await filtered('date_from=2026-03-05&date_to=2026-03-05')).summary.count).toBe(2);
    expect((await filtered(`category_id=${es}`)).summary).toEqual({ count: 1, total_amount: 200 });
    expect((await filtered('group=hpp')).summary.count).toBe(2);
    expect((await filtered('funding_source=drawer')).summary.count).toBe(1);
    expect((await filtered('q=kristal')).data).toHaveLength(1);
    expect((await filtered('q=%25')).data).toHaveLength(0); // LIKE wildcards are escaped
    expect((await get(env, '/v1/expenses?cursor=nope', f.ownerA.headers)).statusCode).toBe(400);
    expect(
      (await get(env, '/v1/expenses?date_from=2026-03-09&date_to=2026-03-01', f.ownerA.headers))
        .statusCode,
    ).toBe(400);
  });
});

describe('branch isolation', () => {
  it('never mixes expenses of two outlets in one list, and `all` covers only owner outlets', async () => {
    const f = await fixture();
    const bHeaders = await switchTo(env, f.ownerA.headers, f.b.outletId);
    const bCat = await categoryId(env, bHeaders);
    await createExpense(f.ownerA.headers, expenseBody(f.cat, { amount: 1_000 }));
    const inB = await createExpense(bHeaders, expenseBody(bCat, { amount: 20_000 }));

    const onlyA = json<Listed>(await get(env, '/v1/expenses', f.ownerA.headers));
    expect(onlyA.data.map((e) => e.amount)).toEqual([1_000]);
    expect(json<Listed>(await get(env, '/v1/expenses', bHeaders)).data.map((e) => e.id)).toEqual([
      inB.id,
    ]);

    const all = json<Listed>(await get(env, '/v1/expenses?outlet_scope=all', f.ownerA.headers));
    expect(all.summary).toEqual({ count: 2, total_amount: 21_000 });
    expect(new Set(all.data.map((e) => e.outlet.id))).toEqual(
      new Set([f.a.outletId, f.b.outletId]),
    );
    expect(
      (await get(env, `/v1/expenses?outlet_scope=all&category_id=${f.cat}`, f.ownerA.headers))
        .statusCode,
    ).toBe(400);

    // Where this user is only a manager, `all` leaves that outlet out (role is read per outlet).
    const c = await createBranches(env);
    await addMembership(env, f.a.ownerEmail, c.a.outletId, 'manager');
    const scoped = json<Listed>(await get(env, '/v1/expenses?outlet_scope=all', f.ownerA.headers));
    expect(scoped.data.every((e) => e.outlet.id !== c.a.outletId)).toBe(true);
  });

  it('hides the data of another owner entirely', async () => {
    const f = await fixture();
    const created = await createExpense(f.ownerA.headers, expenseBody(f.cat));
    const stranger = await createShop(env);
    const headers = { authorization: `Bearer ${stranger.ownerToken}` };
    await seedCategories(env, stranger.seeded.outletId);
    const url = `/v1/expenses/${created.id}`;

    expect((await get(env, url, headers)).statusCode).toBe(404);
    expect((await patch(env, url, headers, { amount: 5 })).statusCode).toBe(404);
    expect((await del(env, url, headers, { reason: 'Coba hapus' })).statusCode).toBe(404);
    expect((await post(env, `${url}/restore`, headers, undefined)).statusCode).toBe(404);
    expect(
      json<Listed>(await get(env, '/v1/expenses?outlet_scope=all', headers)).data,
    ).toHaveLength(0);
    expect(json<Listed>(await get(env, '/v1/expenses', headers)).summary.count).toBe(0);
    // Their category list shows only their own categories; ours cannot be used.
    const res = await post(env, '/v1/expenses', headers, expenseBody(f.cat));
    expect(res.statusCode).toBe(400);
    expect(
      (await patch(env, `/v1/expense-categories/${f.cat}`, headers, { name: 'X' })).statusCode,
    ).toBe(404);
    // Untouched.
    expect(
      json<Expense>(await del(env, url, f.ownerA.headers, { reason: 'Cek setelahnya' })).deleted,
    ).not.toBeNull();
  });

  it('answers 404 for a manager of A on an expense of B and 403 for scope=all or switching', async () => {
    const f = await fixture();
    const bHeaders = await switchTo(env, f.ownerA.headers, f.b.outletId);
    const inB = await createExpense(bHeaders, expenseBody(await categoryId(env, bHeaders)));
    const manager = await createMember(env, f.a, 'manager');
    const url = `/v1/expenses/${inB.id}`;

    expect((await get(env, url, manager.headers)).statusCode).toBe(404);
    expect((await patch(env, url, manager.headers, { amount: 5 })).statusCode).toBe(404);
    expect((await del(env, url, manager.headers, { reason: 'Coba hapus' })).statusCode).toBe(404);
    expect((await get(env, '/v1/expenses?outlet_scope=all', manager.headers)).statusCode).toBe(403);
    expect(
      (await get(env, '/v1/reports/expenses?outlet_scope=all', manager.headers)).statusCode,
    ).toBe(403);
    expect(
      (await get(env, '/v1/expenses/export?format=csv&outlet_scope=all', manager.headers))
        .statusCode,
    ).toBe(403);
    const switched = await post(env, '/v1/auth/switch-outlet', manager.headers, {
      outlet_id: f.b.outletId,
    });
    expect(switched.statusCode).toBe(403);
    expect(json<Listed>(await get(env, '/v1/expenses', manager.headers)).summary.count).toBe(0);
  });

  it('uses the role of the expense outlet: owner of A, manager of B', async () => {
    const f = await fixture();
    const other = await createBranches(env);
    // The owner of `other.a` becomes manager of B, where an expense exists.
    const bHeaders = await switchTo(env, f.ownerA.headers, f.b.outletId);
    const inB = await createExpense(bHeaders, expenseBody(await categoryId(env, bHeaders)));
    await addMembership(env, other.a.ownerEmail, f.b.outletId, 'manager');
    const mixed = await loginAs(env, other.a.ownerEmail, other.a.outletId);
    const url = `/v1/expenses/${inB.id}`;
    expect((await get(env, url, mixed.headers)).statusCode).toBe(200); // a manager may read
    expect((await patch(env, url, mixed.headers, { amount: 10 })).statusCode).toBe(200);
    expect((await del(env, url, mixed.headers, { reason: 'Coba hapus' })).statusCode).toBe(403);
    // After switching to B the token carries the manager role.
    const asManager = await switchTo(env, mixed.headers, f.b.outletId);
    expect(
      (await post(env, '/v1/expense-categories', asManager, { group: 'hpp', name: 'Baru' }))
        .statusCode,
    ).toBe(403);
  });

  it('refuses cashiers, devices and anonymous callers', async () => {
    const shop = await createShop(env);
    const anon = await get(env, '/v1/expenses', {});
    expect(anon.statusCode).toBe(401);
    for (const url of [
      '/v1/expenses',
      '/v1/expense-categories',
      '/v1/reports/expenses',
      '/v1/expenses/export?format=csv',
    ]) {
      expect((await get(env, url, shop.cashier.headers)).statusCode, url).toBe(403);
      expect((await get(env, url, { 'x-device-token': shop.device.token })).statusCode, url).toBe(
        401,
      );
    }
    const res = await post(env, '/v1/expenses', shop.cashier.headers, expenseBody(newId()));
    expect(res.statusCode).toBe(403);
  });
});
