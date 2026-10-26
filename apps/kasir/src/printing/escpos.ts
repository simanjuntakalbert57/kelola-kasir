import { COLS, buildReceiptLines, toPrintable, type ReceiptData, type ReceiptLine } from './layout';

const ESC = 0x1b;
const LF = 0x0a;

/** Blank lines after the receipt: the RPP02N has no auto-cutter, so the paper is torn by hand. */
export const FEED_LINES = 4;

export const INIT = [ESC, 0x40];
const align = (n: 0 | 1) => [ESC, 0x61, n];
const bold = (on: boolean) => [ESC, 0x45, on ? 1 : 0];
/** `ESC t 0`: CP437, plain ASCII is identical in every code page. */
const CODE_PAGE = [ESC, 0x74, 0];
const FEED = (n: number) => [ESC, 0x64, n];

/** Text → bytes. Input is reduced to printable ASCII so no stray multi-byte garbage reaches the printer. */
function ascii(text: string): number[] {
  return Array.from(toPrintable(text), (c) => c.charCodeAt(0));
}

export function encodeLines(lines: readonly ReceiptLine[], feed = FEED_LINES): Uint8Array {
  const bytes: number[] = [...INIT, ...CODE_PAGE];
  let isBold = false;
  let isCenter = false;
  for (const line of lines) {
    const wantBold = !!line.bold;
    const wantCenter = line.align === 'center';
    if (wantBold !== isBold) bytes.push(...bold(wantBold));
    if (wantCenter !== isCenter) bytes.push(...align(wantCenter ? 1 : 0));
    isBold = wantBold;
    isCenter = wantCenter;
    bytes.push(...ascii(line.text.slice(0, COLS)), LF);
  }
  bytes.push(...bold(false), ...align(0), ...FEED(feed));
  return Uint8Array.from(bytes);
}

export function encodeReceipt(receipt: ReceiptData): Uint8Array {
  return encodeLines(buildReceiptLines(receipt));
}
