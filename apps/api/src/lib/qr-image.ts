import jpeg from 'jpeg-js';
import * as jsqrModule from 'jsqr';
import { PNG } from 'pngjs';

type JsQr = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' },
) => { data: string } | null;

// jsqr is CommonJS: depending on the loader the function is the module itself or its `default`.
const jsqrExports = jsqrModule as unknown as JsQr & { default?: JsQr };
const jsQR: JsQr = jsqrExports.default ?? jsqrExports;

export type QrImageType = 'image/png' | 'image/jpeg';

/** Detect PNG/JPEG from magic bytes (the declared content type is not trusted). */
export function sniffImageType(bytes: Buffer): QrImageType | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

const MAX_PIXELS = 16_000_000;

/** Decode the first QR code found in a PNG or JPEG. Returns null when no code can be read. */
export function decodeQrFromImage(bytes: Buffer): string | null {
  const type = sniffImageType(bytes);
  if (!type) return null;
  let width: number;
  let height: number;
  let data: Uint8ClampedArray;
  if (type === 'image/png') {
    const png = PNG.sync.read(bytes);
    width = png.width;
    height = png.height;
    data = new Uint8ClampedArray(png.data);
  } else {
    const image = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 256 });
    width = image.width;
    height = image.height;
    data = new Uint8ClampedArray(image.data);
  }
  if (width * height > MAX_PIXELS) return null;
  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return result?.data ?? null;
}
