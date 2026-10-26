import { describe, expect, it } from 'vitest';
import { buildQris } from '../../test/helpers.js';
import { crc16, embedAmount, parseQris, parseTlv, QrisError } from './qris.js';

describe('crc16', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('parseQris', () => {
  it('reads a valid static payload', () => {
    const parsed = parseQris(buildQris('WARUNG JUS'));
    expect(parsed).toMatchObject({
      initiationMethod: '11',
      merchantName: 'WARUNG JUS',
      merchantCity: 'JAKARTA',
      currency: '360',
      amount: null,
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseQris(`  ${buildQris()}\n`).merchantName).toBe('JUS KELOLA');
  });

  it.each([
    ['too short', '000201'],
    ['bad CRC', buildQris().slice(0, -4) + '0000'],
    ['CRC not last', buildQris() + '5802ID'],
    ['not TLV', 'x'.repeat(80)],
    ['truncated value', buildQris().slice(0, 40) + '99'],
  ])('rejects %s', (_name, payload) => {
    expect(() => parseQris(payload)).toThrow(QrisError);
  });

  it('rejects a payload that is not in IDR', () => {
    const body = buildQris().slice(0, -8).replace('5303360', '5303840') + '6304';
    expect(() => parseQris(body + crc16(body))).toThrow(/IDR/);
  });
});

describe('embedAmount', () => {
  it('turns the payload dynamic, inserts tag 54 after the currency and fixes the CRC', () => {
    const embedded = embedAmount(buildQris(), 37_500);
    const parsed = parseQris(embedded); // CRC is valid again
    expect(parsed.initiationMethod).toBe('12');
    expect(parsed.amount).toBe('37500');
    const tags = parseTlv(embedded).map((f) => f.tag);
    expect(tags.indexOf('54')).toBe(tags.indexOf('53') + 1);
    expect(parsed.merchantName).toBe('JUS KELOLA');
  });

  it('replaces an amount that is already there', () => {
    const once = embedAmount(buildQris(), 1_000);
    expect(parseQris(embedAmount(once, 2_000)).amount).toBe('2000');
  });

  it('rejects non-positive and fractional amounts', () => {
    expect(() => embedAmount(buildQris(), 0)).toThrow(QrisError);
    expect(() => embedAmount(buildQris(), 10.5)).toThrow(QrisError);
  });
});
