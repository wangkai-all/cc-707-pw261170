/** 数据模型：仪表、校准来源、输入量、结果公式、项目。 */

export type InstrumentKind = 'caliper' | 'micrometer' | 'balance' | 'thermometer' | 'gauge' | 'other';

export const INSTRUMENT_KIND_LABEL: Record<InstrumentKind, string> = {
  caliper: '游标/数显卡尺',
  micrometer: '千分尺',
  balance: '电子天平',
  thermometer: '温度计',
  gauge: '其他量具',
  other: '其他',
};

export type SourceBasis = 'standard' | 'expanded' | 'halfwidth';
export type SourceDistribution = 'normal' | 'rectangular' | 'triangular';

export const DISTRIBUTION_LABEL: Record<SourceDistribution, string> = {
  normal: '正态',
  rectangular: '矩形（均匀）',
  triangular: '三角',
};

export const BASIS_LABEL: Record<SourceBasis, string> = {
  standard: '标准不确定度 u',
  expanded: '扩展不确定度 U',
  halfwidth: '半宽 a',
};

export type LinkMode = 'additive' | 'relative';

export const LINK_MODE_LABEL: Record<LinkMode, string> = {
  additive: '加性（± 同量纲偏差）',
  relative: '相对（± 比例偏差）',
};

export interface SourceLink {
  sourceId: string;
  mode: LinkMode;
}

export interface Instrument {
  id: string;
  code: string;
  name: string;
  kind: InstrumentKind;
  serial: string;
  sourceLinks: SourceLink[];
  note: string;
}

export interface CalibrationSource {
  id: string;
  /** 独立编号，例如 SR-001 */
  code: string;
  name: string;
  /** 证书上的赋值，仅用于溯源展示 */
  value: string;
  valueUnit: string;
  distribution: SourceDistribution;
  basis: SourceBasis;
  /** 与 basis 对应的数值（标准 u / 扩展 U / 半宽），单位见 uncUnit */
  magnitude: string;
  uncUnit: string;
  coverageK: string;
  lab: string;
  certificate: string;
  validUntil: string;
  note: string;
  /** 由共用来源拆分出的副本指回原始来源，便于合并 */
  originSourceId?: string;
}

export type InputMode = 'series' | 'constant';

export interface InputQuantity {
  id: string;
  symbol: string;
  name: string;
  mode: InputMode;
  unit: string;
  readings: string[];
  constantValue: string;
  /** 常量输入的 B 类标准不确定度（与输入同单位） */
  constantUncertainty: string;
  /** 常量不确定度的抽样分布形状（仅影响蒙特卡洛） */
  constantDistribution: SourceDistribution;
  /** 读数末位对应的分辨率，例如 0.01；留空则从读数小数位推断 */
  resolution: string;
  instrumentId: string | null;
  includeResolution: boolean;
  note: string;
}

export interface ResultDef {
  id: string;
  symbol: string;
  name: string;
  formula: string;
  unit: string;
  note: string;
}

export interface CorrelationEntry {
  aId: string;
  bId: string;
  /** 用户输入的相关系数。故意不做范围裁剪：非法值必须阻断计算。 */
  value: number;
}

export interface CorrelationConfig {
  mode: 'derived' | 'manual';
  /** 仅 manual 模式使用；按输入量 id 记录成对相关系数，缺省为 0 */
  entries: CorrelationEntry[];
}

export interface ProjectSettings {
  seed: number;
  draws: number;
  nearZeroRel: number;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  instruments: Instrument[];
  sources: CalibrationSource[];
  inputs: InputQuantity[];
  results: ResultDef[];
  correlation: CorrelationConfig;
  settings: ProjectSettings;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  seed: 20261122,
  draws: 20000,
  nearZeroRel: 1e-4,
};

export function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}
