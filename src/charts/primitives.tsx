/** 小型 SVG 图表基元。所有颜色取自 CSS 变量，随主题切换。 */

import { useId, useMemo, useRef, useState, type ReactNode } from 'react';

export function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const show = (event: { clientX: number; clientY: number }, content: ReactNode) => {
    setTip({ x: event.clientX, y: event.clientY, content });
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.content}
    </div>
  ) : null;
  return { show, hide, node };
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

export function fmtNumber(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e5) return Number(v.toPrecision(digits)).toLocaleString('zh-CN', { maximumFractionDigits: 8 });
  const exp = Math.floor(Math.log10(a));
  const mant = v / 10 ** exp;
  return `${Number(mant.toPrecision(digits))}×10${superscript(exp)}`;
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function superscript(n: number): string {
  return String(n).split('').map((c) => SUP[c] ?? c).join('');
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  color?: string;
  secondary?: string;
  detail?: ReactNode;
  negative?: boolean;
}


/** 轴刻度格式化：按步长决定小数位，避免 12282 被 3 位有效数字舍入成 12300。 */
export function axisFormatter(step: number): (v: number) => string {
  if (!Number.isFinite(step) || step <= 0) return (v) => fmtNumber(v, 4);
  return (v) => {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) return fmtNumber(v, 4);
    const decimals = Math.max(0, Math.min(9, Math.ceil(-Math.log10(step))));
    return v.toLocaleString('zh-CN', { maximumFractionDigits: decimals });
  };
}

/** 横向条形图：用于贡献/来源排序。 */
export function HBarChart({
  data,
  unit,
  height,
  ariaLabel,
  formatValue,
  maxBarWidth,
}: {
  data: BarDatum[];
  unit?: string;
  height?: number;
  ariaLabel: string;
  formatValue?: (v: number) => string;
  maxBarWidth?: number;
}) {
  const tip = useTooltip();
  const labelW = 210;
  const valueW = 92;
  const width = 760;
  const barMax = maxBarWidth ?? width - labelW - valueW - 22;
  const rowH = height ?? 30;
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1e-300);
  const svgH = data.length * rowH + 6;
  if (data.length === 0) return <div className="empty small">暂无数据</div>;
  return (
    <>
      <svg viewBox={`0 0 ${width} ${svgH}`} className="chart" role="img" aria-label={ariaLabel} style={{ height: svgH }}>
        {data.map((d, i) => {
          const y = i * rowH + 4;
          const w = Math.max(2, (Math.abs(d.value) / max) * barMax);
          const share = total > 0 ? (Math.max(0, d.value) / total) * 100 : 0;
          return (
            <g key={d.key}>
              <text x={0} y={y + rowH / 2 + 4} className="axis-label" style={{ fontSize: 11.5, fill: 'var(--text-secondary)' }}>
                {d.label.length > 24 ? `${d.label.slice(0, 23)}…` : d.label}
              </text>
              <rect
                x={labelW}
                y={y + 4}
                width={w}
                height={rowH - 14}
                rx={4}
                fill={d.color ?? 'var(--blue)'}
                opacity={d.negative ? 0.5 : 0.92}
                className="bar-mark"
              />
              <text x={labelW + w + 7} y={y + rowH / 2 + 4} className="axis-label" style={{ fill: 'var(--text-primary)' }}>
                {formatValue ? formatValue(d.value) : fmtNumber(d.value, 3)}
                {unit ? ` ${unit}` : ''}
                {d.secondary ? <tspan fill="var(--text-muted)"> · {d.secondary}</tspan> : null}
              </text>
              {d.negative ? (
                <text x={labelW + w + 7} y={y + rowH / 2 + 4} className="axis-label" style={{ fill: 'var(--critical-ink)' }}>
                  {' '}
                </text>
              ) : null}
              <rect
                x={0}
                y={y}
                width={width}
                height={rowH}
                className="hit"
                onPointerMove={(e) =>
                  tip.show(e, (
                    <>
                      <div className="tt-label">{d.label}</div>
                      <div className="tt-value">
                        {formatValue ? formatValue(d.value) : fmtNumber(d.value, 4)}
                        {unit ? ` ${unit}` : ''}
                      </div>
                      <div className="tt-label">占结果方差 {share.toFixed(1)}%</div>
                      {d.detail}
                    </>
                  ))
                }
                onPointerLeave={tip.hide}
                onFocus={(e) => {
                  const r = (e.target as SVGRectElement).getBoundingClientRect();
                  tip.show({ clientX: r.left + r.width / 2, clientY: r.top }, (
                    <>
                      <div className="tt-label">{d.label}</div>
                      <div className="tt-value">{formatValue ? formatValue(d.value) : fmtNumber(d.value, 4)}{unit ? ` ${unit}` : ''}</div>
                      <div className="tt-label">占结果方差 {share.toFixed(1)}%</div>
                    </>
                  ));
                }}
                onBlur={tip.hide}
                tabIndex={0}
                role="button"
                aria-label={`${d.label}：${fmtNumber(d.value)} ${unit ?? ''}`}
              />
            </g>
          );
        })}
      </svg>
      {tip.node}
    </>
  );
}

/** 直方图 + 叠加的 95% 区间标注。 */
export function HistogramChart({
  edges,
  counts,
  markers,
  height = 210,
  ariaLabel,
  color = 'var(--blue)',
  unit,
}: {
  edges: number[];
  counts: number[];
  markers: { value: number; label: string; color: string }[];
  height?: number;
  ariaLabel: string;
  color?: string;
  unit?: string;
}) {
  const tip = useTooltip();
  const W = 720;
  const H = height;
  const pad = { l: 34, r: 12, t: 12, b: 30 };
  const bins = counts.length;
  if (bins === 0) return <div className="empty small">没有可用样本</div>;
  const lo = edges[0];
  const hi = edges[bins];
  const maxCount = Math.max(...counts, 1);
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * (W - pad.l - pad.r);
  const y = (c: number) => H - pad.b - (c / maxCount) * (H - pad.t - pad.b);
  const ticks = niceTicks(lo, hi, 5);
  const tickFmt = axisFormatter(ticks.length > 1 ? ticks[1] - ticks[0] : (hi - lo) / 4);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={ariaLabel} style={{ height: H }}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} />
            <text className="axis-label" x={x(t)} y={H - pad.b + 15} textAnchor="middle">{tickFmt(t)}</text>
          </g>
        ))}
        <line className="baseline" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
        {counts.map((c, i) => {
          const x0 = x(edges[i]);
          const x1 = x(edges[i + 1]);
          const w = Math.max(0.8, x1 - x0 - 1);
          return (
            <rect
              key={i}
              x={x0}
              y={y(c)}
              width={w}
              height={Math.max(0, H - pad.b - y(c))}
              fill={color}
              opacity={0.8}
              onPointerMove={(e) =>
                tip.show(e, (
                  <>
                    <div className="tt-label">区间</div>
                    <div className="tt-value">{tickFmt(edges[i])} – {tickFmt(edges[i + 1])}</div>
                    <div className="tt-label">{c} 个样本{unit ? `（${unit}）` : ''}</div>
                  </>
                ))
              }
              onPointerLeave={tip.hide}
            />
          );
        })}
        {markers.map((m) => (
          <g key={m.label}>
            <line x1={x(m.value)} x2={x(m.value)} y1={pad.t} y2={H - pad.b} stroke={m.color} strokeWidth={2} strokeDasharray="4 3" />
            <text x={x(m.value) + 4} y={pad.t + 10} className="axis-label" style={{ fill: m.color, fontWeight: 600 }}>{m.label}</text>
          </g>
        ))}
      </svg>
      {tip.node}
    </>
  );
}

/** 水平区间图：用于并列展示 95% 区间（一阶 vs MC）。 */
export function IntervalChart({
  rows,
  height = 130,
  ariaLabel,
  unit,
  format,
}: {
  rows: { label: string; lo: number; hi: number; center: number; color: string }[];
  height?: number;
  ariaLabel: string;
  unit?: string;
  format?: (v: number) => string;
}) {
  const W = 720;
  const pad = { l: 92, r: 26, t: 20, b: 26 };
  const lo = Math.min(...rows.map((r) => r.lo));
  const hi = Math.max(...rows.map((r) => r.hi));
  const span = hi - lo || 1;
  const x = (v: number) => pad.l + ((v - lo) / span) * (W - pad.l - pad.r);
  const rowH = (height - pad.t - pad.b) / Math.max(1, rows.length);
  const ticks = niceTicks(lo, hi, 5);
  const tickFmt = axisFormatter(ticks.length > 1 ? ticks[1] - ticks[0] : (hi - lo) / 4);
  const f = format ?? tickFmt;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={ariaLabel} style={{ height }}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="gridline" x1={x(t)} x2={x(t)} y1={pad.t - 8} y2={height - pad.b + 4} />
          <text className="axis-label" x={x(t)} y={height - pad.b + 16} textAnchor="middle">{f(t)}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cy = pad.t + rowH * i + rowH / 2;
        return (
          <g key={r.label}>
            <text x={0} y={cy + 4} className="axis-label" style={{ fill: 'var(--text-secondary)', fontSize: 11.5 }}>{r.label}</text>
            <line x1={x(r.lo)} x2={x(r.hi)} y1={cy} y2={cy} stroke={r.color} strokeWidth={8} strokeLinecap="round" opacity={0.32} />
            <line x1={x(r.lo)} x2={x(r.hi)} y1={cy} y2={cy} stroke={r.color} strokeWidth={2} strokeLinecap="round" />
            <circle cx={x(r.center)} cy={cy} r={4.5} fill={r.color} stroke="var(--surface-1)" strokeWidth={2} />
            <text x={x(r.hi) + 7} y={cy + 4} className="axis-label" style={{ fill: 'var(--text-primary)' }}>
              {f(r.lo)} – {f(r.hi)}{unit ? ` ${unit}` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 细长分段条（份额），用于展示总体构成。 */
export function SegmentedBar({
  parts,
  ariaLabel,
  height = 10,
}: {
  parts: { key: string; label: string; value: number; color: string }[];
  ariaLabel: string;
  height?: number;
}) {
  const tip = useTooltip();
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <div className="empty small">无正分量</div>;
  return (
    <>
      <div style={{ display: 'flex', gap: 2, height, width: '100%' }} role="img" aria-label={ariaLabel}>
        {parts.map((p) => {
          const pct = (p.value / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={p.key}
              style={{ width: `${pct}%`, background: p.color, borderRadius: 3, minWidth: pct > 0.5 ? 3 : 0 }}
              onPointerMove={(e) => tip.show(e, (
                <>
                  <div className="tt-label">{p.label}</div>
                  <div className="tt-value">{pct.toFixed(1)}%</div>
                </>
              ))}
              onPointerLeave={tip.hide}
            />
          );
        })}
      </div>
      {tip.node}
    </>
  );
}

/** 词云式标签按钮，让用户点击跳转。 */
export function LinkChip({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button type="button" className="chip link" onClick={onClick} title={title} style={{ font: 'inherit' }}>
      {children}
    </button>
  );
}

export function useStableId(prefix: string): string {
  const raw = useId();
  return useMemo(() => `${prefix}-${raw.replace(/[:]/g, '')}`, [prefix, raw]);
}

export function useMeasure<T extends SVGElement>() {
  const ref = useRef<T | null>(null);
  return ref;
}
