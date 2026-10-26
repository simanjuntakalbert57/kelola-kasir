import { formatRupiah } from '@kelola-kasir/money';

export interface ReceiptPreviewProps {
  name: string;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  header?: string | null | undefined;
  footer?: string | null | undefined;
}

const SAMPLE = [
  { name: 'Jus Alpukat', qty: 2, price: 15000 },
  { name: 'Jus Jeruk', qty: 1, price: 12000 },
];

/** Monospace 58mm (32 column) approximation of the thermal receipt, driven by the settings form. */
export function ReceiptPreview({ name, address, phone, header, footer }: ReceiptPreviewProps) {
  const total = SAMPLE.reduce((n, i) => n + i.qty * i.price, 0);
  return (
    <figure
      aria-label="Pratinjau struk"
      className="mx-auto w-[17rem] rounded-[8px] bg-white p-4 font-mono text-[12px] leading-snug text-black shadow-card"
    >
      <div className="text-center">
        <p className="text-[14px] font-bold">{name || 'Nama toko'}</p>
        {address ? <p>{address}</p> : null}
        {phone ? <p>{phone}</p> : null}
        {header ? <p className="whitespace-pre-line">{header}</p> : null}
      </div>
      <hr className="my-2 border-dashed border-black/60" />
      <p>#0001 · 26 Okt 2026 10:30</p>
      <ul className="mt-1">
        {SAMPLE.map((i) => (
          <li key={i.name} className="flex justify-between gap-2">
            <span>
              {i.qty}× {i.name}
            </span>
            <span>{formatRupiah(i.qty * i.price)}</span>
          </li>
        ))}
      </ul>
      <hr className="my-2 border-dashed border-black/60" />
      <p className="flex justify-between font-bold">
        <span>TOTAL</span>
        <span>{formatRupiah(total)}</span>
      </p>
      {footer ? <p className="mt-3 whitespace-pre-line text-center">{footer}</p> : null}
    </figure>
  );
}
