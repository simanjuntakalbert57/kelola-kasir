import QRCode from 'qrcode';
import { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';

/** Renders an EMVCo/QRIS payload as one SVG path (dark modules on white, with quiet zone). */
export function QrCode({ value, size }: { value: string; size: number }) {
  const { path, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.modules.get(x, y)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
    return { path: d, count: n + 8 };
  }, [value]);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      accessibilityLabel="Kode QRIS"
    >
      <Path d={`M0 0h${count}v${count}h-${count}z`} fill="#fff" />
      <Path d={path} fill="#000" />
    </Svg>
  );
}
