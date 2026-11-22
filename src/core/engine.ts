/**
 * 不确定度计算引擎。
 *
 * 建模约定：
 * - 每个校准来源只对应一个潜变量。多台仪表引用同一来源时共享该变量，
 *   输入量之间的协方差由共享来源自然产生，而不是"把输入当独立量相加"。
 * - 每条测量自身另有独立的重复性/分辨率潜变量。
 * - 先构造输入量协方差并做半正定校验；不合法则阻断，不自动修正矩阵。
 * - 一阶传播使用前向导数；蒙特卡洛使用固定种子，从同一协方差与同一
 *   来源分布形状抽样。
 */

import {
  astSize,
  collectIdentifiers,
  compileNumeric,
  evaluateFormula,
  parseFormula,
  type AstNode,
  type DivisionPoint,
  type EvalVar,
  type Issue,
} from './expr';
import {
  jacobiEigen,
  mulberry32,
  normalSampler,
  psdDiagnostics,
  sampleStats,
  samplingFactor,
  type PsdDiagnostics,
} from './linalg';
import { formatNumber, summarizeInput, type InputQuantitySummary } from './stats';
import {
  DIM_ZERO,
  dimEqual,
  formatDimension,
  fromSI,
  getUnit,
  toSI,
  unitLabel,
  type Dimension,
} from './units';
import type {
  CalibrationSource,
  InputQuantity,
  Project,
  ResultDef,
  SourceDistribution,
} from './types';

const DISTRIBUTION_LABEL_CN: Record<SourceDistribution, string> = {
  normal: '正态',
  rectangular: '矩形',
  triangular: '三角',
};

/* ------------------------------------------------------------------ *
 * 变量与输入模型
 * ------------------------------------------------------------------ */

export interface VariableDef {
  id: string;
  kind: 'own' | 'source';
  label: string;
  detail: string;
  inputId?: string;
  sourceId?: string;
  sourceCode?: string;
  /** 标准不确定度（SI） */
  sigmaSI: number;
  dim: Dimension;
  distribution: SourceDistribution;
}

export interface InputModel {
  input: InputQuantity;
  summary: InputQuantitySummary;
  meanSI: number;
  dim: Dimension;
  sensitivities: { varId: string; c: number }[];
  uSI: number;
  issues: Issue[];
}

export interface LinkDetail {
  inputId: string;
  inputSymbol: string;
  sourceId: string;
  sourceCode: string;
  mode: 'additive' | 'relative';
  variableId: string;
}

export interface CorrelationModel {
  mode: 'derived' | 'manual';
  matrix: number[][];
  derivedMatrix: number[][];
  diagnostics: PsdDiagnostics;
  status: 'ok' | 'singular' | 'invalid';
  issues: Issue[];
  labels: string[];
}

/** 来源标准不确定度（SI）。含证书折算与分布除数。 */
export function sourceUncertaintySI(source: CalibrationSource): {
  uSI: number;
  uDisplay: number;
  error: string | null;
} {
  const magnitude = Number(source.magnitude);
  if (source.magnitude.trim() === '' || !Number.isFinite(magnitude) || magnitude < 0) {
    return { uSI: Number.NaN, uDisplay: Number.NaN, error: '来源数值无效或为负' };
  }
  const unit = getUnit(source.uncUnit);
  if (!unit) return { uSI: Number.NaN, uDisplay: Number.NaN, error: '来源单位无效' };
  const k = source.basis === 'expanded' ? Number(source.coverageK || '2') : 1;
  if (source.basis === 'expanded' && source.coverageK.trim() !== '' && (!Number.isFinite(k) || k <= 0)) {
    return { uSI: Number.NaN, uDisplay: Number.NaN, error: '包含因子 k 必须为正值' };
  }
  if (source.basis === 'halfwidth' && k <= 0) {
    return { uSI: Number.NaN, uDisplay: Number.NaN, error: '包含因子 k 必须为正值' };
  }
  const divisor =
    source.distribution === 'rectangular'
      ? Math.sqrt(3)
      : source.distribution === 'triangular'
        ? Math.sqrt(6)
        : 1;
  let uDisplay: number;
  if (source.basis === 'standard') uDisplay = magnitude;
  else if (source.basis === 'expanded') uDisplay = magnitude / k;
  else uDisplay = magnitude / divisor;
  if (!Number.isFinite(uDisplay) || uDisplay < 0) {
    return { uSI: Number.NaN, uDisplay: Number.NaN, error: '折算后的标准不确定度无效' };
  }
  return { uSI: uDisplay * unit.factor, uDisplay, error: null };
}

/* ------------------------------------------------------------------ *
 * 公式校验与拓扑排序
 * ------------------------------------------------------------------ */

export interface FormulaValidation {
  resultId: string;
  symbol: string;
  ast?: AstNode;
  dependencies: string[];
  error: string | null;
}

export interface FormulaGraph {
  validations: FormulaValidation[];
  order: ResultDef[];
  astByResult: Map<string, AstNode>;
  issues: Issue[];
}

export function validateFormulas(project: Project): FormulaGraph {
  const issues: Issue[] = [];
  const validations: FormulaValidation[] = [];
  const inputSymbols = new Map<string, InputQuantity>();
  for (const q of project.inputs) {
    if (inputSymbols.has(q.symbol)) {
      issues.push({
        code: 'duplicate-symbol',
        message: `输入量符号“${q.symbol}”重复，公式无法唯一解析`,
        severity: 'error',
      });
    }
    inputSymbols.set(q.symbol, q);
  }
  const resultSymbols = new Map<string, ResultDef>();
  for (const r of project.results) {
    if (resultSymbols.has(r.symbol) || inputSymbols.has(r.symbol)) {
      issues.push({
        code: 'duplicate-symbol',
        message: `结果符号“${r.symbol}”与已有输入量或结果重名`,
        severity: 'error',
      });
    }
    resultSymbols.set(r.symbol, r);
  }

  const astByResult = new Map<string, AstNode>();
  for (const r of project.results) {
    const validation: FormulaValidation = { resultId: r.id, symbol: r.symbol, dependencies: [], error: null };
    const fail = (msg: string, code = 'syntax', pos?: number) => {
      if (!validation.error) validation.error = msg;
      issues.push({ code, message: `结果 ${r.symbol || '（未命名）'}：${msg}`, pos, severity: 'error' });
    };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.symbol)) {
      fail('符号不合法：需以字母或下划线开头，仅含字母、数字、下划线', 'bad-symbol');
      validations.push(validation);
      continue;
    }
    if (!getUnit(r.unit)) fail(`声明单位“${r.unit}”无效`, 'bad-unit');
    try {
      const ast = parseFormula(r.formula);
      if (astSize(ast) > 300) {
        fail(`公式过于复杂（${astSize(ast)} 个节点，上限 300）`, 'limit');
      }
      astByResult.set(r.id, ast);
      validation.ast = ast;
      const deps = [...collectIdentifiers(ast)];
      validation.dependencies = deps;
      for (const id of deps) {
        if (id === r.symbol) fail(`公式不能引用自身“${id}”`, 'cycle');
        else if (!inputSymbols.has(id) && !resultSymbols.has(id)) {
          fail(`引用了未定义的变量“${id}”`, 'unknown-symbol');
        }
      }
    } catch (err) {
      const e = err as { message?: string; pos?: number; code?: string };
      fail(e.message ?? '公式解析失败', e.code ?? 'syntax', e.pos);
    }
    validations.push(validation);
  }

  // 结果之间的依赖环
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const order: ResultDef[] = [];
  const cycle: { names: string[] | null } = { names: null };
  const visit = (r: ResultDef) => {
    if (cycle.names !== null) return;
    const s = state.get(r.id);
    if (s === 2) return;
    if (s === 1) {
      const start = stack.indexOf(r.id);
      cycle.names = [...stack.slice(start), r.id].map(
        (id) => project.results.find((x) => x.id === id)?.symbol ?? id,
      );
      return;
    }
    state.set(r.id, 1);
    stack.push(r.id);
    const ast = astByResult.get(r.id);
    if (ast) {
      for (const id of collectIdentifiers(ast)) {
        const dep = resultSymbols.get(id);
        if (dep && dep.id !== r.id) visit(dep);
      }
    }
    stack.pop();
    state.set(r.id, 2);
    order.push(r);
  };
  project.results.forEach(visit);
  if (cycle.names) {
    issues.push({
      code: 'cycle',
      message: `结果公式存在依赖环：${cycle.names.join(' → ')}`,
      severity: 'error',
    });
  }
  return { validations, order: cycle.names ? [] : order, astByResult, issues };
}

/* ------------------------------------------------------------------ *
 * 变量图
 * ------------------------------------------------------------------ */

export interface VariableGraph {
  variables: VariableDef[];
  inputs: InputModel[];
  links: LinkDetail[];
  issues: Issue[];
}

export function buildVariables(project: Project): VariableGraph {
  const issues: Issue[] = [];
  const variables: VariableDef[] = [];
  const inputs: InputModel[] = [];
  const links: LinkDetail[] = [];

  const sourceVarIndex = new Map<string, number>();
  const ensureSourceVariable = (source: (typeof project.sources)[number]) => {
    const existing = sourceVarIndex.get(source.id);
    if (existing !== undefined) return existing;
    const { uSI, error } = sourceUncertaintySI(source);
    const unit = getUnit(source.uncUnit);
    if (error || !unit) {
      issues.push({
        code: 'source-invalid',
        message: `校准来源 ${source.code || source.id}：${error ?? '单位无效'}`,
        severity: 'error',
      });
    }
    if (source.basis === 'halfwidth' && source.distribution === 'normal') {
      issues.push({
        code: 'source-distribution',
        message: `校准来源 ${source.code}：半宽 a 配正态分布没有定义，请选矩形或三角分布`,
        severity: 'error',
      });
    }
    const idx = variables.length;
    sourceVarIndex.set(source.id, idx);
    variables.push({
      id: `src:${source.id}`,
      kind: 'source',
      label: `${source.code} ${source.name}`,
      detail: [source.lab, source.certificate].filter(Boolean).join(' · ') || '未填写证书信息',
      sourceId: source.id,
      sourceCode: source.code,
      sigmaSI: Number.isFinite(uSI) ? uSI : 0,
      dim: unit?.dim ?? DIM_ZERO,
      distribution: source.distribution,
    });
    return idx;
  };

  for (const input of project.inputs) {
    const summary = summarizeInput(input, project.instruments, project.sources);
    const unit = getUnit(input.unit);
    const dim = unit?.dim ?? DIM_ZERO;
    const ownIssues: Issue[] = [];
    const add = (msg: string, severity: Issue['severity'], code: string) =>
      ownIssues.push({ code, message: `${input.symbol || '（未命名输入）'}：${msg}`, severity });
    if (!unit) add(`单位“${input.unit}”无效`, 'error', 'bad-unit');
    for (const msg of summary.errors) add(msg, 'error', 'input-invalid');
    for (const msg of summary.warnings) add(msg, 'warning', 'input-warning');

    if (summary.stats && summary.stats.n > 1 && summary.stats.n < 4) {
      add(
        `只有 ${summary.stats.n} 次读数，重复性估计非常不可靠；建议至少 6 次或改用历史合并标准差`,
        'warning',
        'few-readings',
      );
    }
    const sensitivities: { varId: string; c: number }[] = [];
    const addOwnVariable = (
      suffix: string,
      label: string,
      detail: string,
      displaySigma: number,
      distribution: SourceDistribution,
    ) => {
      const sigma = Number.isFinite(displaySigma) && unit ? displaySigma * unit.factor : 0;
      if (!(sigma > 0)) return;
      variables.push({
        id: `own:${input.id}:${suffix}`,
        kind: 'own',
        label,
        detail,
        inputId: input.id,
        sigmaSI: sigma,
        dim,
        distribution,
      });
      sensitivities.push({ varId: `own:${input.id}:${suffix}`, c: 1 });
    };

    addOwnVariable(
      'repeat',
      `${input.symbol} 重复性`,
      summary.stats
        ? `${summary.stats.n} 次读数，s = ${formatNumber(summary.stats.sd)} ${input.unit}，u = s/√n = ${formatNumber(
            summary.repeatabilityDisplay,
          )} ${input.unit}`
        : '无重复读数',
      summary.repeatabilityDisplay,
      'normal',
    );
    addOwnVariable(
      'resolution',
      `${input.symbol} 分辨率`,
      `分辨力 ${formatNumber(summary.resolutionDisplay)} ${input.unit}，u = δ/√12 = ${formatNumber(
        summary.resolutionComponentDisplay,
      )} ${input.unit}`,
      summary.resolutionComponentDisplay,
      'rectangular',
    );
    addOwnVariable(
      'btype',
      `${input.symbol} 常量 B 类`,
      `引用的常量值的不确定度 ${formatNumber(summary.constantUncertaintyDisplay)} ${input.unit}（${
        DISTRIBUTION_LABEL_CN[input.constantDistribution]
      }）`,
      summary.constantUncertaintyDisplay,
      input.constantDistribution,
    );

    const instrument = project.instruments.find((i) => i.id === input.instrumentId);
    if (input.instrumentId && !instrument) {
      add('指定的仪表已不存在', 'error', 'instrument-missing');
    }
    if (instrument) {
      for (const link of instrument.sourceLinks) {
        const source = project.sources.find((s) => s.id === link.sourceId);
        if (!source) {
          add(`引用的校准来源已不存在`, 'error', 'source-missing');
          continue;
        }
        const { error } = sourceUncertaintySI(source);
        const idx = ensureSourceVariable(source);
        if (error) {
          add(`来源 ${source.code}：${error}`, 'error', 'source-invalid');
          continue;
        }
        const v = variables[idx];
        if (link.mode === 'additive') {
          if (!dimEqual(v.dim, dim)) {
            add(
              `加性来源 ${source.code} 的单位“${unitLabel(source.uncUnit)}”(${formatDimension(
                v.dim,
              )}) 与输入量“${input.unit}”(${formatDimension(dim)}) 量纲不一致`,
              'error',
              'dimension',
            );
            continue;
          }
          sensitivities.push({ varId: v.id, c: 1 });
        } else {
          if (!dimEqual(v.dim, DIM_ZERO)) {
            add(
              `相对模式要求来源不确定度为比例（无量纲），来源 ${source.code} 的单位是“${unitLabel(
                source.uncUnit,
              )}”`,
              'error',
              'dimension',
            );
            continue;
          }
          if (!Number.isFinite(summary.meanSI)) {
            add('中心值无效，无法建立相对模式灵敏度', 'error', 'input-invalid');
            continue;
          }
          sensitivities.push({ varId: v.id, c: summary.meanSI });
        }
        links.push({
          inputId: input.id,
          inputSymbol: input.symbol,
          sourceId: source.id,
          sourceCode: source.code,
          mode: link.mode,
          variableId: v.id,
        });
      }
    }

    let variance = 0;
    for (const s of sensitivities) {
      const v = variables.find((x) => x.id === s.varId);
      if (v) variance += (s.c * v.sigmaSI) ** 2;
    }
    inputs.push({
      input,
      summary,
      meanSI: summary.meanSI,
      dim,
      sensitivities,
      uSI: Math.sqrt(variance),
      issues: ownIssues,
    });
  }

  // 未被任何输入量引用的来源：仍登记为变量，但标准不确定度置零，
  // 贡献图为空，也不会凭空白增加结果的不确定度。
  for (const source of project.sources) {
    const idx = ensureSourceVariable(source);
    if (variables[idx].sigmaSI > 0) continue;
    variables[idx] = {
      ...variables[idx],
      sigmaSI: 0,
      detail: `${variables[idx].detail} · 目前没有输入量引用该来源`,
    };
  }
  return { variables, inputs, links, issues };
}

/* ------------------------------------------------------------------ *
 * 相关与协方差
 * ------------------------------------------------------------------ */

export function buildCorrelation(
  project: Project,
  variables: VariableDef[],
  inputs: InputModel[],
): CorrelationModel {
  const n = inputs.length;
  const labels = inputs.map((x) => x.input.symbol);
  const issues: Issue[] = [];
  const varSigma = new Map(variables.map((v) => [v.id, v.sigmaSI]));

  const derived = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const derivedRho = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let cov = 0;
      for (const si of inputs[i].sensitivities) {
        for (const sj of inputs[j].sensitivities) {
          if (si.varId !== sj.varId) continue;
          const s = varSigma.get(si.varId) ?? 0;
          cov += si.c * sj.c * s * s;
        }
      }
      derived[i][j] = cov;
    }
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // 共同潜变量造成的相关；除以各自总 u，得到与"共享来源"直接对应的 ρ
      let common = 0;
      for (const si of inputs[i].sensitivities) {
        for (const sj of inputs[j].sensitivities) {
          if (si.varId !== sj.varId) continue;
          const s = varSigma.get(si.varId) ?? 0;
          common += si.c * sj.c * s * s;
        }
      }
      const denom = inputs[i].uSI * inputs[j].uSI;
      const rho = denom > 0 ? common / denom : 0;
      derivedRho[i][j] = rho;
      derivedRho[j][i] = rho;
    }
    derivedRho[i][i] = 1;
  }

  let matrix = derived;
  if (project.correlation.mode === 'manual') {
    matrix = Array.from({ length: n }, (_, i) => {
      const row = new Array<number>(n).fill(0);
      row[i] = derived[i][i];
      return row;
    });
    const seen = new Set<string>();
    for (const entry of project.correlation.entries) {
      const i = inputs.findIndex((x) => x.input.id === entry.aId);
      const j = inputs.findIndex((x) => x.input.id === entry.bId);
      if (i < 0 || j < 0 || i === j) {
        issues.push({
          code: 'correlation-reference',
          message: '手动相关系数引用了不存在的输入量或自身',
          severity: 'error',
        });
        continue;
      }
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      if (seen.has(key)) {
        issues.push({
          code: 'correlation-duplicate',
          message: `${labels[i]} 与 ${labels[j]} 的相关系数重复设置`,
          severity: 'error',
        });
        continue;
      }
      seen.add(key);
      if (!Number.isFinite(entry.value)) {
        issues.push({
          code: 'correlation-invalid',
          message: `${labels[i]} 与 ${labels[j]} 的相关系数不是有限数值`,
          severity: 'error',
        });
        continue;
      }
      if (Math.abs(entry.value) > 1) {
        issues.push({
          code: 'correlation-invalid',
          message: `${labels[i]} 与 ${labels[j]} 的相关系数 ${entry.value} 超出 [-1, 1]；不会自动裁剪`,
          severity: 'error',
        });
      }
      if (!dimEqual(inputs[i].dim, inputs[j].dim)) {
        issues.push({
          code: 'correlation-dimension',
          message: `${labels[i]} 与 ${labels[j]} 量纲不同（${formatDimension(
            inputs[i].dim,
          )} / ${formatDimension(inputs[j].dim)}），无法直接设定相关系数`,
          severity: 'error',
        });
        continue;
      }
      const cov = entry.value * Math.sqrt(Math.max(0, derived[i][i]) * Math.max(0, derived[j][j]));
      matrix[i][j] = cov;
      matrix[j][i] = cov;
    }
  }

  // 半正定校验前先归一化为相关矩阵：
  // 1) 只看实际参与计算的输入量（零方差分量不参与）；
  // 2) 消除量纲/量级差异，避免温度的大方差把长度小方差下的非法相关“淹没”。
  const used = inputs.map((_, i) => (matrix[i][i] > 0 ? i : -1)).filter((i) => i >= 0);
  const corr = used.map((i) =>
    used.map((j) => matrix[i][j] / Math.sqrt(matrix[i][i] * matrix[j][j])),
  );
  const diagnostics = psdDiagnostics(corr);
  let status: CorrelationModel['status'] = 'ok';
  if (!diagnostics.psd) {
    status = 'invalid';
    const hasRangeError = issues.some((i) => i.code === 'correlation-invalid');
    const offending = [...new Set(
      issues
        .filter((i) => i.code === 'correlation-invalid' || i.code === 'correlation-dimension')
        .map((i) => i.message.split('；')[0]),
    )];
    issues.push({
      code: 'covariance-not-psd',
      message: hasRangeError
        ? `协方差矩阵不是半正定：最小特征值 ${formatNumber(
            diagnostics.minEigenvalue,
          )}（容差 ${formatNumber(diagnostics.tolerance)}）。原因：${offending.join(
            '；',
          )}。已阻断计算——本工具不会自动裁剪系数或改写矩阵。`
        : `协方差矩阵不是半正定：最小特征值 ${formatNumber(
            diagnostics.minEigenvalue,
          )}（容差 ${formatNumber(diagnostics.tolerance)}）。该矩阵含有负方差方向，已阻断计算；请修正相关系数或来源设置——本工具不会自动改写矩阵。`,
      severity: 'error',
    });
  } else {
    let nearPerfect = false;
    for (let i = 0; i < n; i += 1) {
      if (!(matrix[i][i] > 0)) continue;
      for (let j = i + 1; j < n; j += 1) {
        if (!(matrix[j][j] > 0)) continue;
        const rho = matrix[i][j] / Math.sqrt(matrix[i][i] * matrix[j][j]);
        if (Math.abs(rho) > 0.999999) {
          nearPerfect = true;
          issues.push({
            code: 'perfect-correlation',
            message: `${labels[i]} 与 ${labels[j]} 的相关系数接近 ±1（${formatNumber(
              rho,
            )}）：矩阵奇异，一阶结果仍可解释，但逐项贡献不再唯一`,
            severity: 'warning',
          });
        }
      }
    }
    if (nearPerfect) status = 'singular';
  }
  return { mode: project.correlation.mode, matrix, derivedMatrix: derived, diagnostics, status, issues, labels };
}

/* ------------------------------------------------------------------ *
 * 一阶传播
 * ------------------------------------------------------------------ */

export interface ContributionRow {
  key: string;
  label: string;
  detail: string;
  kind: 'repeatability' | 'source' | 'input';
  /** 方差贡献（SI²），手动相关模式下可为负 */
  variance: number;
  share: number;
  sourceId?: string;
  sourceCode?: string;
  inputId?: string;
  affectedInputs: string[];
}

export interface McSummary {
  draws: number;
  seed: number;
  meanSI: number;
  sdSI: number;
  q025SI: number;
  q975SI: number;
  minSI: number;
  maxSI: number;
  skewness: number;
  failures: number;
  histogram: { edges: number[]; counts: number[] };
}

export interface ResultComputation {
  def: ResultDef;
  order: number;
  dim: Dimension;
  ok: boolean;
  valueSI: number;
  valueDisplay: number;
  gInputs: number[];
  gVars: number[];
  variance: number;
  sdSI: number;
  contributions: ContributionRow[];
  issues: Issue[];
  mc: McSummary | null;
  mcIssues: Issue[];
}

export interface LinearityComparison {
  firstOrderHalfWidthDisplay: number;
  mcHalfWidthDisplay: number;
  halfWidthRelDiff: number;
  sdRelDiff: number;
  skewness: number;
  nonlinear: boolean;
  reason: string;
}

function buildContributionsDerived(
  inputs: InputModel[],
  variables: VariableDef[],
  gInputs: number[],
  variance: number,
): ContributionRow[] {
  const varSens = new Map<string, number>();
  const affects = new Map<string, Set<string>>();
  inputs.forEach((m, i) => {
    for (const s of m.sensitivities) {
      varSens.set(s.varId, (varSens.get(s.varId) ?? 0) + gInputs[i] * s.c);
      const set = affects.get(s.varId) ?? new Set<string>();
      set.add(m.input.symbol);
      affects.set(s.varId, set);
    }
  });
  const rows: ContributionRow[] = [];
  for (const v of variables) {
    const sens = varSens.get(v.id) ?? 0;
    const contribution = (sens * v.sigmaSI) ** 2;
    if (contribution <= 0) continue;
    rows.push({
      key: v.id,
      label: v.label,
      detail: v.detail,
      kind: v.kind === 'source' ? 'source' : 'repeatability',
      variance: contribution,
      share: variance > 0 ? contribution / variance : 0,
      sourceId: v.sourceId,
      sourceCode: v.sourceCode,
      inputId: v.inputId,
      affectedInputs: [...(affects.get(v.id) ?? [])],
    });
  }
  rows.sort((a, b) => b.variance - a.variance);
  return rows;
}

function buildContributionsManual(
  inputs: InputModel[],
  matrix: number[][],
  gInputs: number[],
  variance: number,
): ContributionRow[] {
  const Cg = matrix.map((row) => row.reduce((s, x, j) => s + x * gInputs[j], 0));
  const rows: ContributionRow[] = [];
  inputs.forEach((m, i) => {
    const c = gInputs[i] * Cg[i];
    if (Math.abs(c) < 1e-300) return;
    rows.push({
      key: `input:${m.input.id}`,
      label: `${m.input.symbol} ${m.input.name}`,
      detail: '手动相关模式：含与其它输入量的协方差项（对称拆分）',
      kind: 'input',
      variance: c,
      share: variance > 0 ? c / variance : 0,
      inputId: m.input.id,
      affectedInputs: [m.input.symbol],
    });
  });
  rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  return rows;
}

/* ------------------------------------------------------------------ *
 * 蒙特卡洛
 * ------------------------------------------------------------------ */

interface LatentSampling {
  /** [变量][抽样] 的潜变量偏移 */
  offsets: Map<string, Float64Array>;
  draws: number;
  clampedEigen: number;
}

function sourceOffsetSampler(
  sigma: number,
  distribution: SourceDistribution,
  count: number,
  rand: () => number,
  normal: () => number,
): Float64Array {
  const out = new Float64Array(count);
  if (distribution === 'normal') {
    for (let k = 0; k < count; k += 1) out[k] = sigma * normal();
    return out;
  }
  if (distribution === 'rectangular') {
    // 半宽 a = σ√3，均值 0，标准差 σ
    for (let k = 0; k < count; k += 1) out[k] = sigma * Math.sqrt(3) * (2 * rand() - 1);
    return out;
  }
  // 三角：两独立 U(0,1) 之和的方差为 1/6，故 σ√6·(u1+u2−1) 的标准差恰为 σ
  for (let k = 0; k < count; k += 1) {
    out[k] = sigma * Math.sqrt(6) * (rand() + rand() - 1);
  }
  return out;
}

function buildLatentSamples(
  variables: VariableDef[],
  project: Project,
  draws: number,
): LatentSampling {
  const rand = mulberry32(project.settings.seed);
  const normal = normalSampler(project.settings.seed + 101);
  const offsets = new Map<string, Float64Array>();

  // 不同来源之间视为独立；"共享"由引用同一变量表达，因此同一来源
  // 在所有输入量中得到的是同一串抽样值。
  const sourceSamples = new Map<string, Float64Array>();
  for (const v of variables) {
    if (v.kind !== 'source') continue;
    sourceSamples.set(v.id, sourceOffsetSampler(v.sigmaSI, v.distribution, draws, rand, normal));
  }

  // 自身重复性：正态
  for (const v of variables) {
    if (v.kind === 'own') {
      const arr = new Float64Array(draws);
      for (let k = 0; k < draws; k += 1) arr[k] = v.sigmaSI * normal();
      offsets.set(v.id, arr);
    } else {
      const s = sourceSamples.get(v.id);
      if (s) offsets.set(v.id, s);
    }
  }
  return { offsets, draws, clampedEigen: 0 };
}

/** 让一阶协方差与 MC 使用同一相关结构：手动相关模式用相关矩阵重采样。 */
function buildManualSamples(
  inputs: InputModel[],
  matrix: number[][],
  draws: number,
  seed: number,
): { samples: number[][]; clamped: number } | null {
  const n = matrix.length;
  if (n === 0) return { samples: [], clamped: 0 };
  const { values, vectors } = jacobiEigen(matrix);
  const { L, clamped } = samplingFactor(values, vectors, n);
  void inputs;
  const normal = normalSampler(seed + 17);
  const samples = Array.from({ length: n }, () => new Array<number>(draws).fill(0));
  for (let k = 0; k < draws; k += 1) {
    const z = new Array<number>(n);
    for (let i = 0; i < n; i += 1) z[i] = normal();
    for (let i = 0; i < n; i += 1) {
      let v = 0;
      for (let j = 0; j < n; j += 1) v += L[i][j] * z[j];
      samples[i][k] = v;
    }
  }
  return { samples, clamped };
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

export interface EngineResult {
  variables: VariableDef[];
  inputs: InputModel[];
  links: LinkDetail[];
  inputIndex: Map<string, number>;
  correlation: CorrelationModel;
  results: ResultComputation[];
  resultIndex: Map<string, number>;
  formulaGraph: FormulaGraph;
  issues: Issue[];
  blocked: boolean;
  blockedReason: string | null;
}

function evaluateResultValue(
  def: ResultDef,
  inputs: InputModel[],
  prior: Map<string, { valueSI: number; dim: Dimension; gInputs: number[] }>,
  nearZeroRel: number,
): {
  valueSI: number;
  dim: Dimension;
  gInputs: number[];
  ok: boolean;
  issues: Issue[];
  divisions: DivisionPoint[];
} {
  const issues: Issue[] = [];
  const n = inputs.length;
  const vars = new Map<string, EvalVar>();
  inputs.forEach((m, i) => {
    const grad = new Array<number>(n).fill(0);
    grad[i] = 1;
    vars.set(m.input.symbol, { value: m.meanSI, dim: m.dim, grad, label: m.input.symbol });
  });
  for (const [symbol, val] of prior) {
    vars.set(symbol, { value: val.valueSI, dim: val.dim, grad: val.gInputs.slice(), label: symbol });
  }
  let ast: AstNode;
  try {
    ast = parseFormula(def.formula);
  } catch (err) {
    const e = err as { message?: string; pos?: number; code?: string };
    return {
      valueSI: Number.NaN,
      dim: DIM_ZERO,
      gInputs: new Array<number>(n).fill(Number.NaN),
      ok: false,
      issues: [
        { code: e.code ?? 'syntax', message: `结果 ${def.symbol}：${e.message ?? '公式解析失败'}`, pos: e.pos, severity: 'error' },
      ],
      divisions: [],
    };
  }
  const evaluation = evaluateFormula(ast, vars, n, nearZeroRel);
  issues.push(...evaluation.issues);
  const declared = getUnit(def.unit);
  if (declared && !dimEqual(evaluation.dim, declared.dim)) {
    issues.push({
      code: 'dimension',
      message: `结果 ${def.symbol} 的公式量纲为 ${formatDimension(evaluation.dim)}，声明单位“${unitLabel(
        def.unit,
      )}”为 ${formatDimension(declared.dim)}`,
      severity: 'error',
    });
  }
  if (declared && evaluation.ok && !Number.isFinite(fromSI(evaluation.value, def.unit))) {
    issues.push({
      code: 'unit-range',
      message: `结果 ${def.symbol} 换算到“${unitLabel(def.unit)}”后溢出，请改用更合适的单位`,
      severity: 'error',
    });
  }
  return {
    valueSI: evaluation.value,
    dim: evaluation.dim,
    gInputs: evaluation.grad,
    ok: evaluation.ok && !issues.some((i) => i.severity === 'error'),
    issues,
    divisions: evaluation.divisions,
  };
}

/** 用输入协方差估计分母自身的标准不确定度，判断“分母接近零”。 */
function checkDenominators(
  def: ResultDef,
  divisions: DivisionPoint[],
  correlation: CorrelationModel,
): Issue[] {
  const issues: Issue[] = [];
  if (divisions.length === 0) return issues;
  for (const d of divisions) {
    if (!Number.isFinite(d.value)) continue;
    const grad = d.grad;
    const n = grad.length;
    let variance = 0;
    if (correlation.mode === 'derived') {
      // 从输入协方差推导：σ_d² = gᵀ C g
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) variance += grad[i] * correlation.derivedMatrix[i][j] * grad[j];
      }
    } else {
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) variance += grad[i] * correlation.matrix[i][j] * grad[j];
      }
    }
    const sigma = Math.sqrt(Math.max(0, variance));
    if (d.value === 0) {
      issues.push({
        code: 'divide-zero',
        message: `结果 ${def.symbol} 的分母“${d.leftText}”在当前取值为零`,
        pos: d.pos,
        severity: 'error',
      });
      continue;
    }
    const ratio = sigma / Math.abs(d.value);
    const sigmaRatio = Math.abs(d.value) / sigma;
    if (sigmaRatio < 3) {
      issues.push({
        code: 'near-zero-denominator',
        message: `结果 ${def.symbol}：分母“${d.leftText}”= ${formatNumber(d.value)}，其标准不确定度为 ${formatNumber(
          sigma,
        )}（相对 ${
          Number.isFinite(ratio) ? `${(ratio * 100).toFixed(0)}%` : '∞'
        }）。分母可能跨过零，一阶传播不可用，蒙特卡洛也会大量失效。`,
        pos: d.pos,
        severity: 'error',
      });
    } else if (sigmaRatio < 10) {
      issues.push({
        code: 'small-denominator',
        message: `结果 ${def.symbol}：分母“${d.leftText}”= ${formatNumber(d.value)}，其相对不确定度约 ${(
          ratio * 100
        ).toFixed(1)}%，接近零的风险较高；请对照蒙特卡洛结果`,
        pos: d.pos,
        severity: 'warning',
      });
    }
  }
  return issues;
}

function histogram(values: number[], bins = 48): { edges: number[]; counts: number[] } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { edges: [], counts: [] };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi === lo) {
    const pad = Math.abs(lo) * 1e-6 || 1e-12;
    lo -= pad;
    hi += pad;
  }
  const width = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const v of finite) {
    let idx = Math.floor((v - lo) / width);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx] += 1;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width);
  return { edges, counts };
}

export function runEngine(project: Project): EngineResult {
  const formulaGraph = validateFormulas(project);
  const { variables, inputs, links, issues: varIssues } = buildVariables(project);
  const issues: Issue[] = [...formulaGraph.issues, ...varIssues];
  inputs.forEach((m) => issues.push(...m.issues));
  const correlation = buildCorrelation(project, variables, inputs);
  issues.push(...correlation.issues);

  const blockedByFormula = formulaGraph.issues.some((i) => i.severity === 'error');
  // 任何协方差错误都阻断：半正定失败、越界系数、量纲不符或引用错误。
  // 不自动裁剪、不替换矩阵，也不静默忽略无法定义的相关设定。
  const blockedByCorrelation = correlation.issues.some((i) => i.severity === 'error');
  const blockedByInputs = inputs.some((m) => m.issues.some((i) => i.severity === 'error'));
  const variablesInvalid = variables.some(
    (v) => v.kind === 'source' && (!Number.isFinite(v.sigmaSI) || v.sigmaSI < 0),
  );
  const blockedByModel = blockedByFormula || blockedByCorrelation || blockedByInputs || variablesInvalid;

  const results: ResultComputation[] = [];
  const resultIndex = new Map<string, number>();
  const prior = new Map<string, { valueSI: number; dim: Dimension; gInputs: number[] }>();

  for (const def of formulaGraph.order) {
    const evaluation = evaluateResultValue(def, inputs, prior, project.settings.nearZeroRel);
    const denomIssues = checkDenominators(def, evaluation.divisions, correlation);
    evaluation.issues.push(...denomIssues);
    if (denomIssues.some((i) => i.severity === 'error')) evaluation.ok = false;
    const gVars = new Array<number>(variables.length).fill(0);
    const varIndexByName = new Map(variables.map((v, i) => [v.id, i]));
    inputs.forEach((m, i) => {
      for (const s of m.sensitivities) {
        const vi = varIndexByName.get(s.varId);
        if (vi !== undefined && Number.isFinite(evaluation.gInputs[i])) {
          gVars[vi] += evaluation.gInputs[i] * s.c;
        }
      }
    });
    let variance: number;
    if (correlation.mode === 'derived') {
      variance = gVars.reduce((s, g, vi) => s + (g * variables[vi].sigmaSI) ** 2, 0);
    } else {
      const g = evaluation.gInputs;
      let v = 0;
      for (let i = 0; i < g.length; i += 1) {
        for (let j = 0; j < g.length; j += 1) v += g[i] * correlation.matrix[i][j] * g[j];
      }
      variance = v;
    }
    const roundedVariance = variance < 0 && variance > -1e-18 * Math.abs(variance) ? 0 : variance;
    const contributions =
      correlation.mode === 'derived'
        ? buildContributionsDerived(inputs, variables, evaluation.gInputs, Math.max(0, roundedVariance))
        : buildContributionsManual(inputs, correlation.matrix, evaluation.gInputs, Math.max(0, roundedVariance));
    const declared = getUnit(def.unit);
    const valueDisplay = declared ? fromSI(evaluation.valueSI, def.unit) : Number.NaN;
    const resultIssues = evaluation.issues.slice();
    if (roundedVariance < 0) {
      resultIssues.push({
        code: 'negative-variance',
        message: '一阶方差为负，模型或相关设置不自洽',
        severity: 'error',
      });
    }
    results.push({
      def,
      order: results.length,
      dim: evaluation.dim,
      ok: evaluation.ok && roundedVariance >= 0,
      valueSI: evaluation.valueSI,
      valueDisplay,
      gInputs: evaluation.gInputs,
      gVars,
      variance: Math.max(0, roundedVariance),
      sdSI: Math.sqrt(Math.max(0, roundedVariance)),
      contributions,
      issues: resultIssues,
      mc: null,
      mcIssues: [],
    });
    resultIndex.set(def.symbol, results.length - 1);
    prior.set(def.symbol, {
      valueSI: evaluation.valueSI,
      dim: evaluation.dim,
      gInputs: evaluation.gInputs,
    });
  }

  const blockedByResult = results.some((r) => r.issues.some((i) => i.severity === 'error'));
  const blocked = blockedByModel || blockedByResult;
  const blockedReason = correlation.status === 'invalid'
    ? '协方差矩阵不是半正定，已阻断一阶与蒙特卡洛计算；请修正后重试（矩阵不会被自动改写）。'
    : blockedByCorrelation
      ? '相关设定不合法（相关系数超出 [-1, 1]、量纲不一致或引用了不存在的输入量），已阻断计算。'
      : blockedByFormula
        ? '公式或依赖存在错误，已阻断计算。'
        : blockedByInputs || variablesInvalid
          ? '输入量或校准来源存在错误，已阻断计算。'
          : blockedByResult
            ? '部分结果公式存在量纲、定义域或除零问题，已阻断蒙特卡洛。'
            : null;

  if (!blocked) {
    const draws = Math.max(1000, Math.min(200000, Math.round(project.settings.draws)));
    const compiled = new Map<string, (vars: Record<string, number>) => number | null>();
    for (const r of results) {
      try {
        compiled.set(r.def.symbol, compileNumeric(parseFormula(r.def.formula)));
      } catch {
        compiled.set(r.def.symbol, () => null);
      }
    }
    const valuesPerResult: Float64Array[] = results.map(() => new Float64Array(draws));
    const failedPerResult: Uint8Array[] = results.map(() => new Uint8Array(draws));
    let clampedEigen = 0;

    if (correlation.mode === 'manual') {
      const sampling = buildManualSamples(inputs, correlation.matrix, draws, project.settings.seed);
      if (!sampling) {
        results.forEach((r) =>
          r.mcIssues.push({ code: 'mc-failed', message: '协方差矩阵无法分解', severity: 'error' }),
        );
      } else {
        clampedEigen = sampling.clamped;
        const record: Record<string, number> = {};
        const inputSamples = sampling.samples;
        for (let k = 0; k < draws; k += 1) {
          inputs.forEach((m, i) => {
            record[m.input.symbol] = m.meanSI + inputSamples[i][k];
          });
          for (const r of results) {
            const fn = compiled.get(r.def.symbol);
            const v = fn ? fn(record) : null;
            if (v === null) {
              failedPerResult[results.indexOf(r)][k] = 1;
              record[r.def.symbol] = Number.NaN;
            } else {
              valuesPerResult[results.indexOf(r)][k] = v;
              record[r.def.symbol] = v;
            }
          }
        }
      }
    } else {
      const latent = buildLatentSamples(variables, project, draws);
      clampedEigen += latent.clampedEigen;
      const record: Record<string, number> = {};
      for (let k = 0; k < draws; k += 1) {
        inputs.forEach((m) => {
          let v = m.meanSI;
          for (const s of m.sensitivities) {
            const arr = latent.offsets.get(s.varId);
            v += s.c * (arr ? arr[k] : 0);
          }
          record[m.input.symbol] = v;
        });
        for (const r of results) {
          const idx = results.indexOf(r);
          const fn = compiled.get(r.def.symbol);
          const v = fn ? fn(record) : null;
          if (v === null) {
            failedPerResult[idx][k] = 1;
            record[r.def.symbol] = Number.NaN;
          } else {
            valuesPerResult[idx][k] = v;
            record[r.def.symbol] = v;
          }
        }
      }
    }

    if (clampedEigen > 0 && correlation.mode === 'manual') {
      issues.push({
        code: 'covariance-rounded',
        message: `协方差矩阵有 ${clampedEigen} 个在容差内接近零的负特征值，采样时截为零；若并非舍入误差请修正相关设置`,
        severity: 'warning',
      });
    }

    results.forEach((r, i) => {
      const values: number[] = [];
      let failures = 0;
      for (let k = 0; k < draws; k += 1) {
        if (failedPerResult[i][k]) failures += 1;
        else values.push(valuesPerResult[i][k]);
      }
      if (values.length < Math.max(30, draws * 0.5)) {
        r.mcIssues.push({
          code: 'mc-failed',
          message: `蒙特卡洛样本失效过多（${failures}/${draws}），结果不可靠`,
          severity: 'error',
        });
        return;
      }
      if (failures > 0) {
        r.mcIssues.push({
          code: 'mc-partial',
          message: `蒙特卡洛有 ${failures}/${draws} 个样本落在公式定义域之外，已剔除；这本身提示非线性/定义域敏感`,
          severity: 'warning',
        });
      }
      const stats = sampleStats(values);
      r.mc = {
        draws: values.length,
        seed: project.settings.seed,
        meanSI: stats.mean,
        sdSI: stats.sd,
        q025SI: stats.q025,
        q975SI: stats.q975,
        minSI: stats.min,
        maxSI: stats.max,
        skewness: stats.skewness,
        failures,
        histogram: histogram(values, 56),
      };
    });
  }

  const allIssues = [...issues];
  for (const r of results) {
    for (const issue of r.issues) {
      allIssues.push({ ...issue, message: `[${r.def.symbol}] ${issue.message}`, resultId: r.def.id });
    }
  }
  return {
    variables,
    inputs,
    links,
    inputIndex: new Map(inputs.map((m, i) => [m.input.id, i])),
    correlation,
    results,
    resultIndex,
    formulaGraph,
    issues: allIssues,
    blocked,
    blockedReason,
  };
}

export function compareLinearity(r: ResultComputation, unit: string): LinearityComparison | null {
  if (!r.mc || !Number.isFinite(r.sdSI) || r.sdSI <= 0) return null;
  const firstOrderHalfWidth = 2 * r.sdSI;
  const mcHalfWidth = (r.mc.q975SI - r.mc.q025SI) / 2;
  const sdRelDiff = Math.abs(r.mc.sdSI - r.sdSI) / r.sdSI;
  const halfWidthRelDiff =
    firstOrderHalfWidth > 0 ? Math.abs(mcHalfWidth - firstOrderHalfWidth) / firstOrderHalfWidth : 0;
  const skewness = r.mc.skewness;
  const nonlinear = halfWidthRelDiff > 0.05 || sdRelDiff > 0.05 || Math.abs(skewness) > 0.3;
  let reason: string;
  if (Math.abs(skewness) > 0.3) {
    reason = `蒙特卡洛分布偏度 ${skewness.toFixed(2)}，分布明显不对称`;
  } else if (sdRelDiff > halfWidthRelDiff) {
    reason = `标准不确定度相差 ${(sdRelDiff * 100).toFixed(1)}%`;
  } else {
    reason = `95% 区间半宽相差 ${(halfWidthRelDiff * 100).toFixed(1)}%`;
  }
  return {
    firstOrderHalfWidthDisplay: fromSI(firstOrderHalfWidth, unit),
    mcHalfWidthDisplay: fromSI(mcHalfWidth, unit),
    halfWidthRelDiff,
    sdRelDiff,
    skewness,
    nonlinear,
    reason: nonlinear ? reason : `一阶与蒙特卡洛一致（${reason}，均在 5% 内）`,
  };
}

export { toSI };
