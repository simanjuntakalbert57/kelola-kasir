import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { outletMembers, outlets, users } from '../src/db/schema.js';
import { TokenService } from '../src/lib/jwt.js';
import { OwnerAuthService } from '../src/modules/auth/owner-service.js';
import {
  OWNER_PASSWORD,
  bearer,
  json,
  post,
  seedOutlet,
  type SeededOutlet,
  type TestEnv,
} from './helpers.js';

export const authService = (env: TestEnv) =>
  new OwnerAuthService({
    config: env.config,
    db: env.handle.db,
    tokens: new TokenService(env.config.jwtPrivateKeyPem),
    now: () => new Date(),
  });

export interface Session {
  access_token: string;
  active_outlet_id: string;
  user: {
    id: string;
    outlets: { id: string; role: string; operations_started_on: string | null }[];
  };
}

export async function loginAs(env: TestEnv, email: string, outletId?: string) {
  const res = await post(
    env,
    '/v1/auth/login',
    {},
    { email, password: OWNER_PASSWORD, ...(outletId ? { outlet_id: outletId } : {}) },
  );
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return { session: json<Session>(res), headers: bearer(json<Session>(res).access_token) };
}

export async function userId(env: TestEnv, email: string): Promise<string> {
  const [row] = await env.handle.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!row) throw new Error('user missing');
  return row.id;
}

export async function addMembership(
  env: TestEnv,
  email: string,
  outletId: string,
  role: 'owner' | 'manager',
) {
  await env.handle.db
    .insert(outletMembers)
    .values({ outletId, userId: await userId(env, email), role });
}

/** A user who is only member of `outlet`, with the given role. */
export async function createMember(
  env: TestEnv,
  outlet: SeededOutlet,
  role: 'owner' | 'manager',
  name = role === 'owner' ? 'Owner Lain' : 'Manager Cabang',
) {
  const email = `${role}-${randomUUID().slice(0, 8)}@example.test`;
  await authService(env).createOwner({
    email,
    password: OWNER_PASSWORD,
    name,
    outletId: outlet.outletId,
    role,
  });
  return { email, ...(await loginAs(env, email)) };
}

export const seedCategories = (env: TestEnv, outletId: string) =>
  env.handle.db.execute(sql`select kk_seed_expense_categories(${outletId}::uuid)`);

export async function setOperationsStart(env: TestEnv, outletId: string, date: string | null) {
  await env.handle.db
    .update(outlets)
    .set({ operationsStartedOn: date })
    .where(eq(outlets.id, outletId));
}

export interface Branches {
  a: SeededOutlet;
  b: SeededOutlet;
  /** Owner of A and B; token bound to A. */
  ownerA: { email: string; session: Session; headers: Record<string, string> };
}

/** Two outlets with default expense categories; the owner of A is also owner of B. */
export async function createBranches(env: TestEnv): Promise<Branches> {
  const a = await seedOutlet(env);
  const b = await seedOutlet(env);
  await seedCategories(env, a.outletId);
  await seedCategories(env, b.outletId);
  await addMembership(env, a.ownerEmail, b.outletId, 'owner');
  const ownerA = await loginAs(env, a.ownerEmail, a.outletId);
  return { a, b, ownerA: { email: a.ownerEmail, ...ownerA } };
}

export async function switchTo(env: TestEnv, headers: Record<string, string>, outletId: string) {
  const res = await post(env, '/v1/auth/switch-outlet', headers, { outlet_id: outletId });
  if (res.statusCode !== 200) throw new Error(`switch failed: ${res.statusCode} ${res.body}`);
  return bearer(json<Session>(res).access_token);
}

export async function categoryId(
  env: TestEnv,
  headers: Record<string, string>,
  name = 'Buah',
): Promise<string> {
  const res = await env.app.inject({ method: 'GET', url: '/v1/expense-categories', headers });
  const found = json<{ data: { id: string; name: string }[] }>(res).data.find(
    (c) => c.name === name,
  );
  if (!found) throw new Error(`category ${name} missing`);
  return found.id;
}

export const expenseBody = (categoryId: string, over: object = {}) => ({
  category_id: categoryId,
  spent_on: '2026-03-10',
  description: 'Mangga 10 kg',
  amount: 150_000,
  funding_source: 'owner',
  ...over,
});

export const del = (env: TestEnv, url: string, headers: Record<string, string>, payload?: object) =>
  env.app.inject({ method: 'DELETE', url, headers, ...(payload ? { payload } : {}) });

export const newId = () => uuidv7();
