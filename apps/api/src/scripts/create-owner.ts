import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { outletSettings, outlets } from '../db/schema.js';
import { TokenService } from '../lib/jwt.js';
import { OwnerAuthService } from '../modules/auth/owner-service.js';
import { ChangeTracker, DeviceTokenCache } from '../lib/memory-cache.js';

/**
 * Bootstrap the first owner and outlet. Credentials come from the environment, never from the repo:
 *   OWNER_EMAIL, OWNER_PASSWORD (min 12 chars), OWNER_NAME, OUTLET_CODE (e.g. JUS1), OUTLET_NAME
 */
async function main(): Promise<void> {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const email = required('OWNER_EMAIL');
  const password = required('OWNER_PASSWORD');
  if (password.length < 12) throw new Error('OWNER_PASSWORD must be at least 12 characters');
  const name = process.env['OWNER_NAME'] ?? 'Owner';
  const outletCode = required('OUTLET_CODE').toUpperCase();
  const outletName = process.env['OUTLET_NAME'] ?? outletCode;

  const config = loadConfig();
  const handle = createDb(config.databaseUrl);
  try {
    let [outlet] = await handle.db
      .select()
      .from(outlets)
      .where(eq(outlets.code, outletCode))
      .limit(1);
    if (!outlet) {
      [outlet] = await handle.db
        .insert(outlets)
        .values({ code: outletCode, name: outletName })
        .returning();
      if (outlet)
        await handle.db
          .insert(outletSettings)
          .values({ outletId: outlet.id, displayName: outletName });
    }
    if (!outlet) throw new Error('failed to create outlet');
    const service = new OwnerAuthService({
      config,
      db: handle.db,
      tokens: new TokenService(config.jwtPrivateKeyPem),
      now: () => new Date(),
      changes: new ChangeTracker(),
      deviceCache: new DeviceTokenCache(),
    });
    const userId = await service.createOwner({ email, password, name, outletId: outlet.id });
    console.error(`Created owner ${email} (${userId}) for outlet ${outlet.code}`);
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
