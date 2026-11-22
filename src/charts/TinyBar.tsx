/** 紧凑的构成条形图：表格行内并列展示各分量。 */

import type { ReactNode } from 'react';
import { useTooltip } from './primitives';

export interface TinyBarRow {
  label: ReactNode;
  value: number;
  color: string;
  detail?: ReactNode;
}

export function TinyBar({
  rows,
  ariaLabel,
  unit,
  format,
}: {
  rows: TinyBarRow[];
  ariaLabel: string;
  unit?: string;
  format?: (v: number) => string;
}) {
  const tip = useTooltip();
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-300);
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const f = format ?? ((v: number) => (Number.isFinite(v) ? Number(v.toPrecision(3)).toString() : '—'));
  return (
    <div className="stack" style={{ gap: 5 }} role="img" aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const pct = total > 0 ? (Math.max(0, r.value) / total) * 100 : 0;
        return (
          <div key={i} className="hstack" style={{ gap: 8 }}>
            <span className="small secondary" style={{ width: 96, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}
            </span>
            <div className="bar-track" style={{ flex: 1, height: 7 }}>
              <div
                className="bar-fill"
                style={{
                  width: `${Math.max(0, (Math.abs(r.value) / max) * 100)}%`,
                  background: r.color,
                  cursor: 'pointer',
                }}
                onPointerMove={(e) =>
                  tip.show(e, (
                    <>
                      <div className="tt-label">{r.label}</div>
                      <div className="tt-value">
                        {f(r.value)}
                        {unit ? ` ${unit}` : ''}
                      </div>
                      <div className="tt-label">占本输入量 u² 的 {pct.toFixed(1)}%</div>
                      {r.detail ? <div className="tt-label">{r.detail}</div> : null}
                    </>
                  ))
                }
                onPointerLeave={tip.hide}
              />
            </div>
            <span className="small tabular" style={{ width: 84, textAlign: 'right', flex: 'none' }}>
              {f(r.value)}
            </span>
          </div>
        );
      })}
      {tip.node}
    </div>
  );
}
