import { describe, expect, it } from 'vitest';
import { deviceLabel, safePath } from './push';

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

describe('safePath', () => {
  it('accepts same-origin targets only', () => {
    expect(safePath('/transaksi?date_from=2026-10-30#x')).toBe('/transaksi?date_from=2026-10-30#x');
    expect(safePath('//evil.example')).toBeNull();
    expect(safePath('https://evil.example')).toBeNull();
    expect(safePath(undefined)).toBeNull();
  });

  it('rejects backslash and tab/newline tricks browsers read as a foreign host', () => {
    expect(safePath('/\\evil.com')).toBeNull();
    expect(safePath('/\t/evil.com')).toBeNull();
    expect(safePath('/\n/evil.com')).toBeNull();
  });
});
