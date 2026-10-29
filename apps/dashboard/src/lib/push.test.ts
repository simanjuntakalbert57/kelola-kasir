import { describe, expect, it } from 'vitest';
import { deviceLabel, isSafePath } from './push';

describe('deviceLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
      'Chrome di Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0',
      'Edge di Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/17 Safari/605',
      'Safari di macOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox di Linux'],
    ['', 'Browser'],
  ])('%s → %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});

describe('isSafePath', () => {
  it('accepts same-origin paths only', () => {
    expect(isSafePath('/transaksi?date_from=2026-10-30')).toBe(true);
    expect(isSafePath('//evil.example')).toBe(false);
    expect(isSafePath('https://evil.example')).toBe(false);
    expect(isSafePath(undefined)).toBe(false);
  });
});
