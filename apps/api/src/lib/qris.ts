/**
 * Minimal EMVCo merchant-presented QR (QRIS) codec: parse, validate (CRC16/CCITT-FALSE) and turn a
 * static payload into one that carries the amount (tag 54), TDD §5.3.
 */

export interface TlvField {
  tag: string;
  value: string;
}

export class QrisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrisError';
  }
}

export function crc16(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Split a TLV string (2-char tag, 2-digit length, value) into fields. Throws on malformed input. */
export function parseTlv(payload: string): TlvField[] {
  const fields: TlvField[] = [];
  let pos = 0;
  while (pos < payload.length) {
    if (pos + 4 > payload.length) throw new QrisError('Truncated TLV header');
    const tag = payload.slice(pos, pos + 2);
    const lengthText = payload.slice(pos + 2, pos + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) {
      throw new QrisError('Malformed TLV field');
    }
    const length = Number(lengthText);
    const value = payload.slice(pos + 4, pos + 4 + length);
    if (value.length !== length) throw new QrisError('Truncated TLV value');
    fields.push({ tag, value });
    pos += 4 + length;
  }
  return fields;
}

const tlv = (tag: string, value: string): string =>
  `${tag}${String(value.length).padStart(2, '0')}${value}`;

export interface ParsedQris {
  /** `11` = static, `12` = dynamic (tag 01). */
  initiationMethod: string;
  merchantName: string | null;
  merchantCity: string | null;
  currency: string | null;
  amount: string | null;
  fields: TlvField[];
}

/**
 * Validate a QRIS payload: top-level TLV structure, mandatory tags, trailing CRC (tag 63) and
 * IDR currency (360). Throws `QrisError` with a human-readable reason.
 */
export function parseQris(raw: string): ParsedQris {
  const payload = raw.trim();
  if (payload.length < 30 || payload.length > 600) throw new QrisError('Unexpected payload length');
  const fields = parseTlv(payload);
  const get = (tag: string) => fields.find((f) => f.tag === tag)?.value ?? null;

  const last = fields[fields.length - 1];
  if (!last || last.tag !== '63' || last.value.length !== 4) {
    throw new QrisError('CRC (tag 63) must be the last field');
  }
  if (fields[0]?.tag !== '00' || fields[0].value !== '01') {
    throw new QrisError('Payload format indicator (tag 00) must be 01');
  }
  const expected = crc16(payload.slice(0, -4));
  if (expected !== last.value.toUpperCase()) throw new QrisError('CRC mismatch');

  const initiationMethod = get('01');
  if (initiationMethod !== '11' && initiationMethod !== '12') {
    throw new QrisError('Point of initiation (tag 01) must be 11 or 12');
  }
  if (get('53') !== '360') throw new QrisError('Currency (tag 53) must be IDR (360)');
  if (get('58') !== 'ID') throw new QrisError('Country (tag 58) must be ID');
  // Merchant account information lives in tags 26..51; QRIS requires at least one.
  if (!fields.some((f) => Number(f.tag) >= 26 && Number(f.tag) <= 51)) {
    throw new QrisError('Merchant account information (tags 26-51) is missing');
  }
  const merchantName = get('59');
  if (!merchantName) throw new QrisError('Merchant name (tag 59) is missing');

  return {
    initiationMethod,
    merchantName,
    merchantCity: get('60'),
    currency: get('53'),
    amount: get('54'),
    fields,
  };
}

/**
 * Turn a static QRIS payload into one that carries `amount` (whole Rupiah): tag 01 becomes `12`,
 * tag 54 is inserted (or replaced) right after tag 53, and the CRC is recomputed.
 */
export function embedAmount(staticPayload: string, amount: number): string {
  if (!Number.isInteger(amount) || amount <= 0) throw new QrisError('Amount must be positive');
  const parsed = parseQris(staticPayload);
  const out: string[] = [];
  for (const field of parsed.fields) {
    if (field.tag === '63' || field.tag === '54') continue;
    const value = field.tag === '01' ? '12' : field.value;
    out.push(tlv(field.tag, value));
    if (field.tag === '53') out.push(tlv('54', String(amount)));
  }
  const body = `${out.join('')}6304`;
  return body + crc16(body);
}
