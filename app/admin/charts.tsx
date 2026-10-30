"use client";

export type Series = { label: string; color: string; values: number[] };

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 36 };

export function GroupedBars({ labels, series }: { labels: string[]; series: Series[] }) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const groupW = plotW / Math.max(1, labels.length);
  const barW = Math.max(2, (groupW * 0.7) / Math.max(1, series.length));
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label="Bar chart">
        {ticks.map((t) => {
          const y = PAD.top + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#e4e4e7" />
              <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#71717a">{t}</text>
            </g>
          );
        })}
        {labels.map((label, i) => {
          const x0 = PAD.left + i * groupW + (groupW - barW * series.length) / 2;
          return (
            <g key={`${label}-${i}`}>
              {series.map((s, j) => {
                const v = s.values[i] ?? 0;
                const h = (v / max) * plotH;
                return <rect key={s.label} x={x0 + j * barW} y={PAD.top + plotH - h} width={barW - 1} height={h} fill={s.color} rx={2}><title>{`${s.label} ${label}: ${v}`}</title></rect>;
              })}
              {(i % 2 === 0 || labels.length <= 8) && (
                <text x={PAD.left + i * groupW + groupW / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#71717a">{label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </div>
  );
}

export function Legend({ series }: { series: Array<Pick<Series, "label" | "color">> }) {
  return (
    <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-600">
      {series.map((s) => (
        <span key={s.label} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  );
}

export function Donut({ segments, centerLabel }: { segments: Array<{ label: string; value: number; color: string }>; centerLabel: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label="Donut chart">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#f4f4f5" strokeWidth="16" />
        {total > 0 && segments.map((s) => {
          const len = (s.value / total) * c;
          const el = <circle key={s.label} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)"><title>{`${s.label}: ${s.value}`}</title></circle>;
          offset += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" fontSize="18" fontWeight="700" fill="#18181b">{total}</text>
        <text x="70" y="84" textAnchor="middle" fontSize="10" fill="#71717a">{centerLabel}</text>
      </svg>
      <ul className="space-y-1 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}<span className="font-semibold">{s.value}</span></li>
        ))}
      </ul>
    </div>
  );
}

export function HBar({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-0.5 flex justify-between text-xs text-zinc-600"><span>{r.label}</span><span className="font-semibold text-zinc-900">{r.value}</span></div>
          <div className="h-2 rounded bg-zinc-100"><div className="h-2 rounded" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} /></div>
        </li>
      ))}
    </ul>
  );
}
