import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 defaults to argon2id. Parameters follow the OWASP minimum (19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (plain: string): Promise<string> => hash(plain, OPTIONS);

export async function verifySecret(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Burn the same time as a real check so unknown accounts are not distinguishable by latency. */
export async function verifyDummy(plain: string): Promise<void> {
  dummyHash ??= hashSecret('dummy-secret-for-timing-equalisation');
  await verifySecret(await dummyHash, plain);
}
