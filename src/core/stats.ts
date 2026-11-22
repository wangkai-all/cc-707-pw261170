/** 基础统计与不确定度分量计算。 */

import type { CalibrationSource, InputQuantity, Instrument, SourceDistribution } from './types';
import { toSI } from './units';

export interface SeriesStats {
  n: number;
  mean: number;
  sd: number;
  /** 平均值标准不确定度 s/√n */
  uMean: number;
  min: number;
  max: number;
  range: number;
}

export function parseNumberList(readings: string[]): { values: number[]; invalid: string[] } {
  const values: number[] = [];
  const invalid: string[] = [];
  readings.forEach((raw) => {
    const text = raw.trim();
    if (text === '') return;
    const v = Number(text);
    if (!Number.isFinite(v)) invalid.push(raw);
    else values.push(v);
  });
  return { values, invalid };
}

export function seriesStats(values: number[]): SeriesStats | null {
  if (values.length === 0) return null;
  const n = values.length;
  const mean = values.reduce((s, x) => s + x, 0) / n;
  let ss = 0;
  for (const x of values) ss += (x - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { n, mean, sd, uMean: n > 1 ? sd / Math.sqrt(n) : 0, min, max, range: max - min };
}

/** 从读数文本推断分辨率（末位单位）。无法推断时返回 0。 */
export function inferResolution(readings: string[]): number {
  for (const raw of readings) {
    const text = raw.trim();
    if (!text) continue;
    const m = /^[+-]?\d*(?:\.(\d+))?(?:[eE][+-]?\d+)?$/.exec(text);
    if (!m) continue;
    const decimals = m[1]?.length ?? 0;
    const expMatch = /[eE]([+-]?\d+)$/.exec(text);
    const exp = expMatch ? Number(expMatch[1]) : 0;
    return 10 ** (exp - decimals);
  }
  return 0;
}

export const DISTRIBUTION_DIVISOR: Record<SourceDistribution, number> = {
  normal: 1,
  rectangular: Math.sqrt(3),
  triangular: Math.sqrt(6),
};

/** 把来源的证书值折算成标准不确定度（SI），并返回说明。 */
export function sourceStandardUncertainty(source: CalibrationSource): {
  uSI: number;
  uDisplay: number;
  explanation: string;
  error: string | null;
} {
  const magnitude = Number(source.magnitude);
  if (!Number.isFinite(magnitude) || magnitude < 0) {
    return {
      uSI: Number.NaN,
      uDisplay: Number.NaN,
      explanation: '',
      error: '来源数值无效或为负',
    };
  }
  const k = source.basis === 'expanded' ? Number(source.coverageK || '2') : 1;
  if (source.basis === 'expanded' && (!Number.isFinite(k) || k <= 0)) {
    return { uSI: Number.NaN, uDisplay: Number.NaN, explanation: '', error: '包含因子 k 必须为正数' };
  }
  const divisor = source.distribution === 'normal' ? 1 : DISTRIBUTION_DIVISOR[source.distribution];
  let uDisplay: number;
  let explanation: string;
  if (source.basis === 'standard') {
    uDisplay = magnitude;
    explanation =
      source.distribution === 'normal'
        ? `证书给出标准不确定度 u = ${magnitude}`
        : `由标准不确定度 u = ${magnitude} 直接作为来源分布的标准差（分布类型仅影响蒙特卡洛抽样形状）`;
  } else if (source.basis === 'expanded') {
    uDisplay = magnitude / k;
    explanation = `扩展不确定度 U = ${magnitude}，k = ${k} → u = U/k = ${formatNumber(uDisplay)}`;
  } else {
    uDisplay = magnitude / divisor;
    const distLabel = source.distribution === 'rectangular' ? '矩形' : source.distribution === 'triangular' ? '三角' : '正态';
    explanation = `半宽 a = ${magnitude}，按${distLabel}分布 → u = a/${formatRoot(divisor)} = ${formatNumber(uDisplay)}`;
  }
  if (!Number.isFinite(uDisplay) || uDisplay < 0) {
    return { uSI: Number.NaN, uDisplay: Number.NaN, explanation, error: '折算后的标准不确定度为负或非有限值' };
  }
  return {
    uSI: toSI(uDisplay, source.uncUnit),
    uDisplay,
    explanation,
    error: null,
  };
}

function formatRoot(divisor: number): string {
  if (Math.abs(divisor - Math.sqrt(3)) < 1e-12) return '√3';
  if (Math.abs(divisor - Math.sqrt(6)) < 1e-12) return '√6';
  return String(divisor);
}

export function formatNumber(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e-4 && abs < 1e6) return Number(v.toPrecision(digits)).toString();
  return v.toExponential(3);
}

export interface InstrumentLink {
  source: CalibrationSource;
  mode: 'additive' | 'relative';
  uSI: number;
  /** relative 模式下，每单位读数对应的 SI 偏差标准差；additive 模式下为 uSI */
  sigmaPerUnit: number;
  explanation: string;
  error: string | null;
}

export function instrumentLinks(
  instrument: Instrument | undefined,
  sources: CalibrationSource[],
): InstrumentLink[] {
  if (!instrument) return [];
  const out: InstrumentLink[] = [];
  for (const link of instrument.sourceLinks) {
    const source = sources.find((s) => s.id === link.sourceId);
    if (!source) continue;
    const u = sourceStandardUncertainty(source);
    if (u.error) {
      out.push({
        source,
        mode: link.mode,
        uSI: Number.NaN,
        sigmaPerUnit: Number.NaN,
        explanation: u.explanation,
        error: u.error,
      });
      continue;
    }
    out.push({
      source,
      mode: link.mode,
      uSI: u.uSI,
      sigmaPerUnit: u.uSI,
      explanation: u.explanation,
      error: null,
    });
  }
  return out;
}

export function effectiveResolution(input: InputQuantity): number {
  const explicit = input.resolution.trim();
  if (explicit) {
    const v = Number(explicit);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return inferResolution(input.readings);
}

export interface InputQuantitySummary {
  input: InputQuantity;
  meanDisplay: number;
  meanSI: number;
  stats: SeriesStats | null;
  invalidReadings: string[];
  resolutionDisplay: number;
  repeatabilityDisplay: number;
  resolutionComponentDisplay: number;
  constantUncertaintyDisplay: number;
  /** 输入量自身（重复性 + 分辨率 + B 类常量）的 display 标准不确定度 */
  ownDisplay: number;
  links: InstrumentLink[];
  errors: string[];
  warnings: string[];
}

export function summarizeInput(
  input: InputQuantity,
  instruments: Instrument[],
  sources: CalibrationSource[],
): InputQuantitySummary {
  const errors: string[] = [];
  const warnings: string[] = [];
  const instrument = instruments.find((i) => i.id === input.instrumentId);
  const links = instrumentLinks(instrument, sources);
  for (const l of links) {
    if (l.error) errors.push(`来源 ${l.source.code}：${l.error}`);
  }
  const { values, invalid } = parseNumberList(input.readings);
  if (invalid.length) errors.push(`有 ${invalid.length} 条读数不是有效数字：${invalid.join('、')}`);
  const stats = seriesStats(values);
  const resolutionDisplay = effectiveResolution(input);
  if (input.mode === 'series' && !stats) errors.push('序列模式下至少需要一条有效读数');
  if (input.mode === 'constant') {
    const c = Number(input.constantValue);
    if (input.constantValue.trim() === '' || !Number.isFinite(c)) errors.push('常量值无效');
  }
  let meanDisplay = 0;
  if (input.mode === 'series') meanDisplay = stats?.mean ?? Number.NaN;
  else meanDisplay = Number(input.constantValue);
  const resolutionComponentDisplay =
    input.includeResolution && resolutionDisplay > 0 ? resolutionDisplay / Math.sqrt(12) : 0;
  const constantUncertaintyDisplay =
    input.mode === 'constant' ? Math.max(0, Number(input.constantUncertainty) || 0) : 0;
  if (input.mode === 'constant' && input.constantUncertainty.trim() !== '') {
    const cu = Number(input.constantUncertainty);
    if (!Number.isFinite(cu) || cu < 0) {
      errors.push('常量的 B 类标准不确定度必须为非负数值');
    }
  }
  if (input.mode === 'constant' && constantUncertaintyDisplay === 0) {
    warnings.push('常量输入没有设定 B 类不确定度，将按零不确定度处理');
  }
  if (input.includeResolution && resolutionDisplay <= 0) {
    warnings.push('无法推断分辨率，分辨率分量按 0 处理；可在输入量中显式填写');
  }
  const repeatabilityDisplay = stats ? stats.uMean : 0;
  const ownDisplay = Math.sqrt(
    repeatabilityDisplay ** 2 + resolutionComponentDisplay ** 2 + constantUncertaintyDisplay ** 2,
  );
  return {
    input,
    meanDisplay,
    meanSI: Number.isFinite(meanDisplay) ? toSI(meanDisplay, input.unit) : Number.NaN,
    stats,
    invalidReadings: invalid,
    resolutionDisplay,
    repeatabilityDisplay,
    resolutionComponentDisplay,
    constantUncertaintyDisplay,
    ownDisplay,
    links,
    errors,
    warnings,
  };
}
