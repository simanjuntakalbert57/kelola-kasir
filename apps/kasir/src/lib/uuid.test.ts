import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillRandom, uuidv7 } from './uuid';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces a valid v7 id', () => {
    expect(uuidv7()).toMatch(UUID_V7);
  });

  it('uses the injected random source and embeds the timestamp', () => {
    const id = uuidv7(1_700_000_000_000, (b) => b.fill(0xab));
    expect(id).toMatch(UUID_V7);
    expect(id.startsWith('018bcfe5-6800')).toBe(true);
  });
});

describe('random source without global crypto (Hermes)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the native source when globalThis.crypto is missing', () => {
    vi.stubGlobal('crypto', undefined);
    expect(globalThis.crypto).toBeUndefined();
    const native = vi.fn((b: Uint8Array) => b.fill(0xab));
    const bytes = new Uint8Array(16);
    fillRandom(bytes, native);
    expect(native).toHaveBeenCalledOnce();
    expect(bytes.every((x) => x === 0xab)).toBe(true);
  });

  it('uses the global crypto when available', () => {
    const native = vi.fn();
    fillRandom(new Uint8Array(16), native);
    expect(native).not.toHaveBeenCalled();
  });
});
