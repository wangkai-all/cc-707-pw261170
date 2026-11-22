/**
 * 基线对比：把同一模型的相关系数强制置零（独立假设）后重算，
 * 用于量化"把所有输入当独立量简单相加"会偏离多少。
 */

import type { EngineResult } from './engine';

export interface IndependenceBaseline {
  resultSymbol: string;
  sdCorrelated: number;
  sdIndependent: number;
  inflatedRatio: number;
  varianceDifference: number;
}

/** 用相关系数矩阵与一阶灵敏度做一次独立假设计算，无需重跑整个引擎。 */
export function independenceBaseline(
  engine: EngineResult,
  resultSymbol: string,
): IndependenceBaseline | null {
  const idx = engine.resultIndex.get(resultSymbol);
  if (idx === undefined) return null;
  const r = engine.results[idx];
  const g = r.gInputs;
  const m = engine.correlation.matrix;
  let varCorr = 0;
  let varIndep = 0;
  for (let i = 0; i < g.length; i += 1) {
    for (let j = 0; j < g.length; j += 1) {
      varCorr += g[i] * m[i][j] * g[j];
      if (i === j) varIndep += g[i] * m[i][j] * g[j];
    }
  }
  const sdCorrelated = Math.sqrt(Math.max(0, varCorr));
  const sdIndependent = Math.sqrt(Math.max(0, varIndep));
  return {
    resultSymbol,
    sdCorrelated,
    sdIndependent,
    inflatedRatio: sdCorrelated > 0 ? sdIndependent / sdCorrelated : Number.POSITIVE_INFINITY,
    varianceDifference: varIndep - varCorr,
  };
}

/** 同一结果在两个模型之间的标准不确定度变化倍数。 */
export function reloadBaseline(
  before: EngineResult,
  after: EngineResult,
  resultSymbol: string,
): number {
  const i = before.resultIndex.get(resultSymbol);
  const j = after.resultIndex.get(resultSymbol);
  if (i === undefined || j === undefined) return Number.NaN;
  const a = before.results[i].sdSI;
  const b = after.results[j].sdSI;
  return a > 0 ? b / a : Number.NaN;
}
