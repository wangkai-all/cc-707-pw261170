/** 界面共用的展示格式化与小工具。 */

import type { InputModel, ResultComputation, VariableDef } from '../core/engine';
import { fromSI, getUnit, unitLabel } from '../core/units';

export function formatValue(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) {
    return Number(v.toPrecision(sig)).toLocaleString('zh-CN', { maximumFractionDigits: 10 });
  }
  const exp = Math.floor(Math.log10(a));
  const mant = v / 10 ** exp;
  return `${Number(mant.toPrecision(sig))}e${exp}`;
}

/** 按不确定度定位有效数字（GUM 惯例：u 保留 2 位，值对齐）。 */
export function formatWithUnc(value: number, u: number, unit?: string): {
  value: string;
  u: string;
  text: string;
} {
  if (!Number.isFinite(value) || !Number.isFinite(u)) {
    return { value: '—', u: '—', text: '—' };
  }
  if (u <= 0) return { value: formatValue(value), u: formatValue(u), text: formatValue(value) };
  const digits = Math.min(6, Math.max(1, 2 - Math.floor(Math.log10(Math.abs(u)))));
  const v = Number(value.toFixed(Math.max(0, digits)));
  const uu = Number(u.toFixed(Math.max(0, digits)));
  return {
    value: v.toLocaleString('zh-CN', { maximumFractionDigits: 8 }),
    u: uu.toLocaleString('zh-CN', { maximumFractionDigits: 8 }),
    text: `${v.toLocaleString('zh-CN', { maximumFractionDigits: 8 })} ± ${uu.toLocaleString('zh-CN', {
      maximumFractionDigits: 8,
    })}${unit ? ` ${unit}` : ''}`,
  };
}

export function displayUnit(unitId: string): string {
  return unitLabel(unitId);
}

export function resultDisplay(r: ResultComputation): { value: number; u: number; unit: string } {
  const unit = r.def.unit;
  return { value: r.valueDisplay, u: fromSI(r.sdSI, unit), unit: unitLabel(unit) };
}

/** SI 方差（σ²）换算到展示单位下的方差。 */
export function varianceToDisplay(varianceSI: number, unitId: string): number {
  const def = getUnit(unitId);
  if (!def) return Number.NaN;
  return varianceSI / def.factor ** 2;
}

export function relativePercent(sd: number, value: number): string {
  if (!Number.isFinite(sd) || !Number.isFinite(value) || value === 0) return '—';
  return `${((sd / Math.abs(value)) * 100).toFixed(2)}%`;
}

export const SERIES_COLORS = [
  'var(--blue)',
  'var(--orange)',
  'var(--aqua)',
  'var(--yellow)',
  'var(--magenta)',
  'var(--green)',
  'var(--violet)',
  'var(--red)',
];

/** 稳定配色：按实体 id 排序分配，不随筛选改变。 */
export function buildColorMap(ids: string[]): Map<string, string> {
  const sorted = [...new Set(ids)].sort();
  const map = new Map<string, string>();
  sorted.forEach((id, i) => map.set(id, i < SERIES_COLORS.length ? SERIES_COLORS[i] : 'var(--text-muted)'));
  return map;
}

export function contributionLabel(c: { kind: string; label: string }): string {
  return c.label;
}

export function describeInputSource(input: InputModel): string {
  const parts: string[] = [];
  const inst = input.input.instrumentId;
  if (inst) parts.push('有仪表');
  input.summary.links.forEach((l) => parts.push(l.source.code));
  return parts.join(' · ');
}

export function allVariablesForResult(
  variables: VariableDef[],
  result: ResultComputation,
): { variable: VariableDef; sensitivity: number }[] {
  return variables
    .map((v, i) => ({ variable: v, sensitivity: result.gVars[i] }))
    .filter((x) => Math.abs(x.sensitivity) > 0 && x.variable.sigmaSI > 0)
    .sort((a, b) => Math.abs(b.sensitivity * b.variable.sigmaSI) - Math.abs(a.sensitivity * a.variable.sigmaSI));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function uidShort(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function prettyNumberString(raw: string): string {
  const v = Number(raw);
  if (!Number.isFinite(v)) return raw;
  return String(Number(v.toPrecision(10)));
}

/** 方差贡献（SI²）开方后换算到展示单位，用于贡献条形图。 */
export function contributionDisplay(varianceSI: number, unitId: string): number {
  if (!(varianceSI > 0)) return 0;
  return fromSI(Math.sqrt(varianceSI), unitId);
}

/** σ 从 SI 换算到展示单位。 */
export function sdDisplay(sdSI: number, unitId: string): number {
  return fromSI(sdSI, unitId);
}
