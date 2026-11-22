/**
 * 量纲与单位。
 *
 * 维度向量顺序：[长度 L, 质量 M, 时间 T, 温度 Θ]。
 * 所有计算内部以 SI 值进行；°C 与 K 作为温度间隔单位（因子均为 1），
 * 不做绝对温标偏移换算——本应用中的温度量均表示读数/温差。
 */

export type Dimension = readonly [number, number, number, number];

export const DIM_ZERO: Dimension = [0, 0, 0, 0];
export const DIM_LENGTH: Dimension = [1, 0, 0, 0];
export const DIM_MASS: Dimension = [0, 1, 0, 0];
export const DIM_TEMPERATURE: Dimension = [0, 0, 0, 1];

export function dimEqual(a: Dimension, b: Dimension): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function dimAdd(a: Dimension, b: Dimension): Dimension {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}

export function dimSub(a: Dimension, b: Dimension): Dimension {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
}

export function dimScale(a: Dimension, n: number): Dimension {
  return [a[0] * n, a[1] * n, a[2] * n, a[3] * n];
}

/** 整数除，用于开方/开立方；不可整除时返回 null。 */
export function dimDivide(a: Dimension, n: number): Dimension | null {
  if (!Number.isInteger(n) || n === 0) return null;
  const out = a.map((x) => x / n) as unknown as Dimension;
  return out.every((x) => Number.isInteger(x)) ? out : null;
}

const SUP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
};

const BASE_NAMES = ['长度', '质量', '时间', '温度'];

export function formatDimension(dim: Dimension): string {
  const parts: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const exp = dim[i];
    if (exp === 0) continue;
    if (exp === 1) parts.push(BASE_NAMES[i]);
    else {
      const sup = String(exp)
        .split('')
        .map((c) => SUP[c] ?? c)
        .join('');
      parts.push(`${BASE_NAMES[i]}${sup}`);
    }
  }
  return parts.length ? parts.join('·') : '无量纲';
}

export interface UnitDef {
  id: string;
  label: string;
  /** 1 个该单位 = factor 个 SI 基本单位 */
  factor: number;
  dim: Dimension;
  group: string;
  groupLabel: string;
}

const L = DIM_LENGTH;
const M = DIM_MASS;
const T: Dimension = [0, 0, 1, 0];
const TH = DIM_TEMPERATURE;
const ONE = DIM_ZERO;
const AREA: Dimension = [2, 0, 0, 0];
const VOL: Dimension = [3, 0, 0, 0];
const DENSITY: Dimension = [-3, 1, 0, 0];
const FORCE: Dimension = [1, 1, -2, 0];
const PRESSURE: Dimension = [-1, 1, -2, 0];
const INV_TEMP: Dimension = [0, 0, 0, -1];

function u(
  id: string,
  label: string,
  factor: number,
  dim: Dimension,
  group: string,
  groupLabel: string,
): UnitDef {
  return { id, label, factor, dim, group, groupLabel };
}

export const UNIT_LIST: UnitDef[] = [
  u('m', 'm', 1, L, 'length', '长度'),
  u('mm', 'mm', 1e-3, L, 'length', '长度'),
  u('cm', 'cm', 1e-2, L, 'length', '长度'),
  u('µm', 'µm', 1e-6, L, 'length', '长度'),
  u('in', 'in', 0.0254, L, 'length', '长度'),
  u('mm2', 'mm²', 1e-6, AREA, 'area', '面积'),
  u('cm2', 'cm²', 1e-4, AREA, 'area', '面积'),
  u('m2', 'm²', 1, AREA, 'area', '面积'),
  u('mm3', 'mm³', 1e-9, VOL, 'volume', '体积'),
  u('cm3', 'cm³', 1e-6, VOL, 'volume', '体积'),
  u('mL', 'mL', 1e-6, VOL, 'volume', '体积'),
  u('L', 'L', 1e-3, VOL, 'volume', '体积'),
  u('m3', 'm³', 1, VOL, 'volume', '体积'),
  u('kg', 'kg', 1, M, 'mass', '质量'),
  u('g', 'g', 1e-3, M, 'mass', '质量'),
  u('mg', 'mg', 1e-6, M, 'mass', '质量'),
  u('µg', 'µg', 1e-9, M, 'mass', '质量'),
  u('kg_m3', 'kg/m³', 1, DENSITY, 'density', '密度'),
  u('g_cm3', 'g/cm³', 1000, DENSITY, 'density', '密度'),
  u('g_mm3', 'g/mm³', 1e6, DENSITY, 'density', '密度'),
  u('s', 's', 1, T, 'time', '时间'),
  u('degC', '°C', 1, TH, 'temperature', '温度'),
  u('K', 'K', 1, TH, 'temperature', '温度'),
  u('N', 'N', 1, FORCE, 'force', '力'),
  u('kN', 'kN', 1000, FORCE, 'force', '力'),
  u('Pa', 'Pa', 1, PRESSURE, 'pressure', '压力'),
  u('MPa', 'MPa', 1e6, PRESSURE, 'pressure', '压力'),
  u('1', '1（无量纲）', 1, ONE, 'ratio', '比值'),
  u('%', '%', 0.01, ONE, 'ratio', '比值'),
  u('ppm', 'ppm', 1e-6, ONE, 'ratio', '比值'),
  u('1_degC', '1/°C', 1, INV_TEMP, 'invtemp', '热膨胀系数'),
  u('1_K', '1/K', 1, INV_TEMP, 'invtemp', '热膨胀系数'),
  u('1_mm', '1/mm', 1e3, [ -1, 0, 0, 0 ], 'invlength', '倒数长度'),
  u('1_m', '1/m', 1, [ -1, 0, 0, 0 ], 'invlength', '倒数长度'),
  u('1_mm2', '1/mm²', 1e6, [-2, 0, 0, 0], 'invarea', '倒数面积'),
  u('1_mm3', '1/mm³', 1e9, [-3, 0, 0, 0], 'invvolume', '倒数体积'),
  u('kg_mm3', 'kg/mm³', 1e9, [-3, 1, 0, 0], 'density', '密度'),
];

export const UNITS: Record<string, UnitDef> = Object.fromEntries(
  UNIT_LIST.map((x) => [x.id, x]),
);

export function getUnit(id: string): UnitDef | undefined {
  return UNITS[id];
}

export function unitLabel(id: string): string {
  return UNITS[id]?.label ?? id;
}

export function unitDimension(id: string): Dimension | null {
  return UNITS[id]?.dim ?? null;
}

export function unitsCompatible(a: string, b: string): boolean {
  const ua = UNITS[a];
  const ub = UNITS[b];
  return Boolean(ua && ub && dimEqual(ua.dim, ub.dim));
}

/** 将 display 值转为 SI 值。 */
export function toSI(value: number, unitId: string): number {
  const def = UNITS[unitId];
  if (!def) throw new Error(`未知单位：${unitId}`);
  return value * def.factor;
}

/** 将 SI 值转为 display 值。 */
export function fromSI(value: number, unitId: string): number {
  const def = UNITS[unitId];
  if (!def) throw new Error(`未知单位：${unitId}`);
  return value / def.factor;
}

export function unitGroups(): { id: string; label: string; units: UnitDef[] }[] {
  const map = new Map<string, UnitDef[]>();
  for (const unit of UNIT_LIST) {
    const arr = map.get(unit.group) ?? [];
    arr.push(unit);
    map.set(unit.group, arr);
  }
  return [...map.entries()].map(([id, units]) => ({
    id,
    label: units[0].groupLabel,
    units,
  }));
}

export const RESERVED_SYMBOLS = new Set(['pi', 'e']);

export function isValidSymbol(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !RESERVED_SYMBOLS.has(s);
}
