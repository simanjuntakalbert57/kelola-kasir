import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { buildQris } from '../../test/helpers.js';
import { decodeQrFromImage, sniffImageType } from './qr-image.js';

const payload = buildQris('WARUNG JUS');

async function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: 'png', margin: 4, scale: 6, errorCorrectionLevel: 'M' });
}

describe('decodeQrFromImage', () => {
  it('reads the QRIS payload from a PNG', async () => {
    expect(decodeQrFromImage(await qrPng(payload))).toBe(payload);
  });

  it('reads the QRIS payload from a JPEG', async () => {
    const png = PNG.sync.read(await qrPng(payload));
    const encoded = jpeg.encode({ data: png.data, width: png.width, height: png.height }, 90);
    expect(sniffImageType(encoded.data)).toBe('image/jpeg');
    expect(decodeQrFromImage(encoded.data)).toBe(payload);
  });

  it('returns null for an image without a QR code', () => {
    const blank = new PNG({ width: 64, height: 64 });
    blank.data.fill(255);
    expect(decodeQrFromImage(PNG.sync.write(blank))).toBeNull();
  });

  it('returns null for data that is not an image', () => {
    expect(sniffImageType(Buffer.from('<html></html>'))).toBeNull();
    expect(decodeQrFromImage(Buffer.from('<html></html>'))).toBeNull();
  });
});
