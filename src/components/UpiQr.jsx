import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * A UPI QR code rendered as inline SVG.
 *
 * SVG (not a canvas or an <img>) because the same element has to stay sharp when
 * printed at 300 dpi on an A4 invoice, and because it inherits no external asset
 * that could fail to load on clinic wifi.
 *
 * `quiet` is the mandatory white margin, in modules, around the code. Scanners
 * need it — without it the QR reads as part of whatever surrounds it.
 */
export default function UpiQr({ value, size = 148, quiet = 2, label = 'UPI payment QR code', className = '' }) {
  const { path, total } = useMemo(() => {
    if (!value) return { path: '', total: 0 };
    try {
      // Type 0 = pick the smallest version that fits; 'M' tolerates ~15% damage,
      // which is what survives a slightly creased printout.
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      const count = qr.getModuleCount();
      let d = '';
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
        }
      }
      return { path: d, total: count + quiet * 2 };
    } catch {
      return { path: '', total: 0 };
    }
  }, [value, quiet]);

  if (!path) return null;

  return (
    <svg
      className={`upi-qr ${className}`.trim()}
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#101a17" />
    </svg>
  );
}
