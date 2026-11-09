import { useId } from 'react';
import { formatMoney } from '../lib/logic.mjs';

/* Area + line chart, responsive via viewBox. */
export function TrendChart({ series, height = 180, valueKey = 'collected', secondaryKey = 'billed', format = (v) => formatMoney(v, { compact: true }), palette = ['#0f766e', '#a5d9d0'] }) {
  const gid = useId().replace(/:/g, '');
  const w = 560;
  const pad = { top: 14, right: 8, bottom: 22, left: 8 };
  const max = Math.max(1, ...series.map((d) => Math.max(Number(d[valueKey] ?? 0), Number(d[secondaryKey] ?? 0))));
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const stepX = series.length > 1 ? innerW / (series.length - 1) : innerW;
  const x = (i) => pad.left + i * stepX;
  const y = (v) => pad.top + innerH - (Number(v ?? 0) / max) * innerH;

  const line = (key) => series.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const area = (key) => `${line(key)} L${x(series.length - 1).toFixed(1)},${pad.top + innerH} L${x(0).toFixed(1)},${pad.top + innerH} Z`;

  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label="Trend chart" style={{ height }}>
      <defs>
        <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette[0]} stopOpacity="0.28" />
          <stop offset="100%" stopColor={palette[0]} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} className="grid-line" x1={pad.left} x2={w - pad.right} y1={pad.top + innerH * (1 - f)} y2={pad.top + innerH * (1 - f)} />
      ))}
      {secondaryKey ? <path d={line(secondaryKey)} fill="none" stroke={palette[1]} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" /> : null}
      <path d={area(valueKey)} fill={`url(#g-${gid})`} />
      <path d={line(valueKey)} fill="none" stroke={palette[0]} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {series.map((d, i) => (
        <g key={d.month ?? i}>
          <circle cx={x(i)} cy={y(d[valueKey])} r="3.6" fill="var(--surface)" stroke={palette[0]} strokeWidth="2.4" />
          <text className="axis-label" x={x(i)} y={height - 6} textAnchor="middle">{d.label}</text>
        </g>
      ))}
      <title>{`Latest: ${format(series.at(-1)?.[valueKey] ?? 0)}`}</title>
    </svg>
  );
}

/* Horizontal bars */
export function BarList({ items, format = (v) => formatMoney(v, { compact: true }), color = 'var(--brand-500)' }) {
  const max = Math.max(1, ...items.map((i) => Number(i.value ?? 0)));
  if (!items.length) return <p className="small muted">No data for this period.</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'grid', gap: 5 }}>
          <div className="row small">
            <span className="truncate strong" style={{ fontWeight: 600 }}>{item.label}</span>
            <span className="spacer" />
            <span className="mono muted">{format(item.value)}</span>
          </div>
          <div className="progress" style={{ height: 6 }}>
            <span style={{ width: `${(Number(item.value ?? 0) / max) * 100}%`, background: item.color ?? color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* Donut for category / payer mix */
export function Donut({ items, size = 150, thickness = 18, centerLabel, centerValue }) {
  const total = items.reduce((t, i) => t + Number(i.value ?? 0), 0);
  const radius = (size - thickness) / 2;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  const colors = ['#0f766e', '#7c5cd6', '#c2872b', '#3d7fb8', '#c0455a', '#6fbfb3'];

  return (
    <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
          {items.map((item, i) => {
            const frac = total ? Number(item.value ?? 0) / total : 0;
            const dash = `${frac * circ} ${circ}`;
            const el = (
              <circle
                key={item.label} cx={size / 2} cy={size / 2} r={radius} fill="none"
                stroke={item.color ?? colors[i % colors.length]} strokeWidth={thickness}
                strokeDasharray={dash} strokeDashoffset={-offset} strokeLinecap="butt"
              />
            );
            offset += frac * circ;
            return el;
          })}
        </g>
        {centerValue ? <text x={size / 2} y={size / 2 - 2} textAnchor="middle" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, fill: 'var(--text)' }}>{centerValue}</text> : null}
        {centerLabel ? <text x={size / 2} y={size / 2 + 14} textAnchor="middle" style={{ fontSize: 9.5, fill: 'var(--faint)', fontWeight: 600 }}>{centerLabel}</text> : null}
      </svg>
      <div className="stack" style={{ gap: 7, flex: 1, minWidth: 130 }}>
        {items.map((item, i) => (
          <div key={item.label} className="row small" style={{ gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: item.color ?? colors[i % colors.length], flex: 'none' }} />
            <span className="truncate">{item.label}</span>
            <span className="spacer" />
            <span className="mono muted tiny">{total ? `${Math.round((Number(item.value ?? 0) / total) * 100)}%` : '0%'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Footfall columns */
export function Columns({ series, height = 120, valueKey = 'visits' }) {
  const max = Math.max(1, ...series.map((d) => Number(d[valueKey] ?? 0)));
  return (
    <div style={{ display: 'grid', gridAutoFlow: 'column', gap: 8, alignItems: 'end', height }}>
      {series.map((d) => (
        <div key={d.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
          <span className="tiny mono muted">{Number(d[valueKey] ?? 0)}</span>
          <div style={{
            width: '100%', borderRadius: '7px 7px 4px 4px', minHeight: 4,
            height: `${(Number(d[valueKey] ?? 0) / max) * 100}%`,
            background: 'linear-gradient(180deg, var(--brand-500), color-mix(in srgb, var(--brand-500) 55%, transparent))',
          }} />
          <span className="tiny faint">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* 7-day schedule heat strip */
export function WeekStrip({ days }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div style={{ display: 'grid', gridAutoFlow: 'column', gap: 6 }}>
      {days.map((d, i) => {
        const intensity = d.value / max;
        return (
          <div key={`${d.label}-${i}`} style={{ textAlign: 'center' }}>
            <div
              title={`${d.label}: ${d.value}`}
              style={{
                height: 42, borderRadius: 9, display: 'grid', placeItems: 'center',
                fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-display)',
                background: d.value ? `color-mix(in srgb, var(--brand-500) ${Math.max(12, intensity * 82)}%, transparent)` : 'var(--surface-2)',
                color: intensity > 0.55 ? '#eafaf6' : d.value ? 'var(--brand-600)' : 'var(--faint)',
                border: d.today ? '1.5px solid var(--brand-500)' : '1px solid var(--border)',
              }}
            >
              {d.value || '·'}
            </div>
            <div className="tiny faint" style={{ marginTop: 4 }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}
