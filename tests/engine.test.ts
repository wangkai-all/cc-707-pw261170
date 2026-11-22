import { describe, expect, it } from 'vitest';
import { compareLinearity, runEngine, sourceUncertaintySI } from '../src/core/engine';
import { demoProject } from '../src/data/demo';
import type { Project } from '../src/core/types';

function project(mutate: (p: Project) => void): Project {
  const p = demoProject();
  mutate(p);
  return p;
}

describe('校准来源折算', () => {
  it('扩展不确定度 / k', () => {
    const p = demoProject();
    const src = p.sources.find((s) => s.id === 'src-block')!;
    const r = sourceUncertaintySI(src);
    expect(r.uDisplay).toBeCloseTo(0.0015, 12);
    expect(r.uSI).toBeCloseTo(0.0015e-3, 15); // mm → m
  });
  it('矩形半宽除以 √3', () => {
    const p = demoProject();
    const src = p.sources.find((s) => s.id === 'src-temp')!;
    const r = sourceUncertaintySI(src);
    expect(r.uDisplay).toBeCloseTo(0.45 / Math.sqrt(3), 10);
  });
});

describe('共享来源与相关性', () => {
  it('两台长度仪器共享量块 → 输入量相关系数大于 0', () => {
    const e = runEngine(demoProject());
    expect(e.blocked).toBe(false);
    const iL = e.inputIndex.get('q-len')!;
    const iD = e.inputIndex.get('q-dia')!;
    const rho = e.correlation.matrix[iL][iD] / Math.sqrt(e.correlation.matrix[iL][iL] * e.correlation.matrix[iD][iD]);
    expect(rho).toBeGreaterThan(0.05);
    const cov = e.correlation.matrix[iL][iD];
    const expectedVar = (0.0015e-3) ** 2; // 来源标准差折算到 m 后的平方
    expect(cov / expectedVar).toBeCloseTo(1, 10); // 共享来源方差原样出现在协方差里
  });

  it('共享温度校正值的两支温度计差：校正值完全相消', () => {
    const e = runEngine(demoProject());
    const idx = e.resultIndex.get('dT')!;
    const r = e.results[idx];
    const sourceRows = r.contributions.filter((c) => c.sourceCode === 'SR-002');
    expect(sourceRows).toHaveLength(0);
    const t = e.inputs[e.inputIndex.get('q-temp')!];
    expect(t.uSI).toBeGreaterThan(0);
  });

  it('拆成独立标准件：均值不变，L/D 的不确定度按预期增大', () => {
    const before = runEngine(demoProject());
    const rBefore = before.results[before.resultIndex.get('ratio')!];

    const split = project((p) => {
      const detach = p.instruments.find((i) => i.id === 'ins-micrometer')!;
      const cloned = JSON.parse(JSON.stringify(p)) as Project;
      const src = cloned.sources.find((s) => s.id === 'src-block')!;
      const newId = 'src-block-copy';
      cloned.sources.push({ ...src, id: newId, code: 'SR-001-D01', originSourceId: src.id });
      const mic = cloned.instruments.find((i) => i.id === detach.id)!;
      mic.sourceLinks = mic.sourceLinks.map((l) => (l.sourceId === 'src-block' ? { ...l, sourceId: newId } : l));
      Object.assign(p, cloned);
    });
    const after = runEngine(split);
    const rAfter = after.results[after.resultIndex.get('ratio')!];
    expect(rAfter.valueSI).toBeCloseTo(rBefore.valueSI, 12);
    expect(rAfter.sdSI).toBeGreaterThan(rBefore.sdSI);
    const iL = after.inputIndex.get('q-len')!;
    const iD = after.inputIndex.get('q-dia')!;
    const rho = after.correlation.matrix[iL][iD] / Math.sqrt(after.correlation.matrix[iL][iL] * after.correlation.matrix[iD][iD]);
    expect(rho).toBe(0);
  });
});

describe('阻断与校验', () => {
  it('相关系数 >1 会报错，但两变量 1.4 的矩阵仍半正定——不裁剪、不阻断', () => {
    const p = project((p) => {
      p.correlation.mode = 'manual';
      p.correlation.entries = [
        { aId: 'q-len', bId: 'q-dia', value: 1.4 },
        { aId: 'q-len', bId: 'q-mass', value: 0 },
      ];
    });
    const e = runEngine(p);
    const iL = e.inputIndex.get('q-len')!;
    const iD = e.inputIndex.get('q-dia')!;
    const denom = Math.sqrt(e.correlation.matrix[iL][iL] * e.correlation.matrix[iD][iD]);
    expect(e.correlation.matrix[iL][iD] / denom).toBeCloseTo(1.4, 12);
    expect(e.issues.some((i) => i.code === 'correlation-invalid')).toBe(true);
  });

  it('手动相关矩阵非半正定（三变量两两 -0.9）被阻断', () => {
    const p = project((p) => {
      // 增加第二个长度输入量，使三个同量纲输入两两相关
      p.inputs.push({
        id: 'q-len2',
        symbol: 'L2',
        name: '第二台卡尺长度',
        mode: 'series',
        unit: 'mm',
        readings: ['25.001', '25.002', '25.000', '25.001'],
        constantValue: '',
        constantUncertainty: '',
        constantDistribution: 'normal',
        resolution: '0.001',
        instrumentId: 'ins-caliper',
        includeResolution: true,
        note: '',
      });
      p.correlation.mode = 'manual';
      p.correlation.entries = [
        { aId: 'q-len', bId: 'q-dia', value: -0.9 },
        { aId: 'q-len', bId: 'q-len2', value: -0.9 },
        { aId: 'q-dia', bId: 'q-len2', value: -0.9 },
      ];
    });
    const e = runEngine(p);
    expect(e.correlation.status).toBe('invalid');
    expect(e.blocked).toBe(true);
    expect(e.blockedReason).toContain('半正定');
    expect(e.results.every((r) => r.mc === null)).toBe(true);
  });

  it('公式依赖环被阻断', () => {
    const p = project((p) => {
      p.results.push({ id: 'r-a', symbol: 'A', name: 'A', formula: 'B + 1', unit: '1', note: '' });
      p.results.push({ id: 'r-b', symbol: 'B', name: 'B', formula: 'A + 1', unit: '1', note: '' });
    });
    const e = runEngine(p);
    expect(e.blocked).toBe(true);
    expect(e.issues.some((i) => i.code === 'cycle')).toBe(true);
  });

  it('量纲不匹配被阻断（结果单位声明错误）', () => {
    const p = project((p) => {
      const r = p.results.find((x) => x.symbol === 'ratio')!;
      r.unit = 'mm';
    });
    const e = runEngine(p);
    expect(e.blocked).toBe(true);
    expect(e.issues.some((i) => i.code === 'dimension')).toBe(true);
  });

  it('加性来源量纲不匹配被阻断', () => {
    const p = project((p) => {
      const inst = p.instruments.find((i) => i.id === 'ins-caliper')!;
      inst.sourceLinks = [{ sourceId: 'src-mass', mode: 'additive' }];
    });
    const e = runEngine(p);
    expect(e.blocked).toBe(true);
  });
});

describe('一阶与蒙特卡洛', () => {
  it('一阶与 MC 在近线性结果上一致', () => {
    const e = runEngine(demoProject());
    const r = e.results[e.resultIndex.get('rho')!];
    expect(r.mc).not.toBeNull();
    const rel = Math.abs(r.mc!.sdSI - r.sdSI) / r.sdSI;
    expect(rel).toBeLessThan(0.06);
  });

  it('非线性结果下 MC 与一阶出现差异（1/x 型）', () => {
    const p = project((p) => {
      // 加入一个刻意非线性的结果：L 的倒数，L 的相对不确定度较大
      const q = p.inputs.find((x) => x.symbol === 'L')!;
      q.readings = ['24.0', '26.0', '25.0', '22.0', '28.0', '25.0'];
      q.resolution = '0.001';
      p.results.push({
        id: 'r-inv',
        symbol: 'invL',
        name: '长度倒数',
        formula: '1 / L',
        unit: '1_m',
        note: '',
      });
    });
    const e = runEngine(p);
    expect(e.blocked).toBe(false);
    const r = e.results[e.resultIndex.get('invL')!];
    expect(r.mc).not.toBeNull();
    // 1/L 的 Jensen 效应：MC 均值应高于 1/mean(L)，且分布明显偏斜
    const meanL = e.inputs[e.inputIndex.get('q-len')!].meanSI;
    expect(r.mc!.meanSI).toBeGreaterThan(1 / meanL);
    expect(Math.abs(r.mc!.skewness)).toBeGreaterThan(0.1);
  });

  it('贡献之和等于总方差', () => {
    const e = runEngine(demoProject());
    for (const r of e.results) {
      const sum = r.contributions.reduce((s, c) => s + c.variance, 0);
      expect(sum).toBeCloseTo(r.variance, 12);
    }
  });

  it('固定种子可复现', () => {
    const a = runEngine(demoProject());
    const b = runEngine(demoProject());
    const ra = a.results[a.resultIndex.get('rho')!];
    const rb = b.results[b.resultIndex.get('rho')!];
    expect(ra.mc!.sdSI).toBe(rb.mc!.sdSI);
  });

  it('单位换算：V 以 mm³、rho 以 g/cm³ 显示', () => {
    const e = runEngine(demoProject());
    const v = e.results[e.resultIndex.get('V')!];
    const rho = e.results[e.resultIndex.get('rho')!];
    const L = e.inputs[e.inputIndex.get('q-len')!].meanSI;
    const D = e.inputs[e.inputIndex.get('q-dia')!].meanSI;
    expect(v.valueDisplay).toBeCloseTo((Math.PI * (D / 2) ** 2 * L) / 1e-9, 6);
    const m = e.inputs[e.inputIndex.get('q-mass')!].meanSI;
    expect(rho.valueDisplay).toBeCloseTo(m / (Math.PI * (D / 2) ** 2 * L) / 1000, 9);
  });
});

describe('alphaEst 的非线性对照', () => {
  it('dTcal 分母相对不确定度大，一阶与 MC 出现显著差异并被标记', () => {
    const e = runEngine(demoProject());
    const r = e.results[e.resultIndex.get('alphaEst')!];
    expect(r.ok).toBe(true);
    expect(r.mc).not.toBeNull();
    const cmp = compareLinearity(r, '1_degC');
    expect(cmp).not.toBeNull();
    const rel = Math.abs(r.mc!.sdSI - r.sdSI) / r.sdSI;
    expect(rel).toBeGreaterThan(0.03);
  });
});
