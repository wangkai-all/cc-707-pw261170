import { describe, expect, it } from 'vitest';
import { runEngine } from '../src/core/engine';
import { demoProject } from '../src/data/demo';
import { mergeSource, splitSharedSource } from '../src/data/operations';
import { independenceBaseline } from '../src/core/baseline';

function sd(project: ReturnType<typeof demoProject>, symbol: string) {
  const e = runEngine(project);
  return e.results[e.resultIndex.get(symbol)!].sdSI;
}
function mean(project: ReturnType<typeof demoProject>, symbol: string) {
  const e = runEngine(project);
  return e.results[e.resultIndex.get(symbol)!].valueSI;
}

describe('共用 → 独立标准件', () => {
  it('Lavg（和）：均值不变；共享时的正相关使和的不确定度更大，拆分后变小', () => {
    const before = demoProject();
    const split = splitSharedSource(before, 'src-block', ['ins-micrometer']);
    expect(split).not.toBeNull();
    const after = split!.project;
    expect(mean(after, 'Lavg')).toBeCloseTo(mean(before, 'Lavg'), 14);
    expect(sd(after, 'Lavg')).toBeLessThan(sd(before, 'Lavg'));
    expect(sd(after, 'Lavg')).toBeCloseTo(
      independenceBaseline(runEngine(before), 'Lavg')!.sdIndependent,
      10,
    );
  });

  it('ratio：均值不变，不确定度变大；dT 不变（不涉及量块）', () => {
    const before = demoProject();
    const after = splitSharedSource(before, 'src-block', ['ins-micrometer'])!.project;
    expect(mean(after, 'ratio')).toBeCloseTo(mean(before, 'ratio'), 14);
    expect(sd(after, 'ratio')).toBeGreaterThan(sd(before, 'ratio'));
    expect(sd(after, 'dT')).toBeCloseTo(sd(before, 'dT'), 20);
  });

  it('温度计拆分后 dT 的不确定度等于独立相加', () => {
    const before = demoProject();
    const eBefore = runEngine(before);
    const base = independenceBaseline(eBefore, 'dT')!;
    const after = splitSharedSource(before, 'src-temp', ['ins-thermo2'])!.project;
    const sdAfter = sd(after, 'dT');
    expect(sdAfter).toBeCloseTo(base.sdIndependent, 10);
    expect(sdAfter).toBeGreaterThan(sd(before, 'dT') * 1.5);
  });

  it('合并回去可恢复原模型', () => {
    const before = demoProject();
    const split = splitSharedSource(before, 'src-block', ['ins-micrometer'])!;
    const merged = mergeSource(split.project, split.newSourceId)!;
    expect(sd(merged, 'ratio')).toBeCloseTo(sd(before, 'ratio'), 14);
  });

  it('不能拆分唯一使用者（没有共享关系可拆）', () => {
    const before = demoProject();
    const split = splitSharedSource(before, 'src-mass', ['ins-balance']);
    expect(split).toBeNull();
  });
});

describe('独立性基线', () => {
  it('dT 的独立假设显著高估', () => {
    const e = runEngine(demoProject());
    const base = independenceBaseline(e, 'dT')!;
    expect(base.sdIndependent / base.sdCorrelated).toBeGreaterThan(2);
  });

  it('rho 受共享量块影响，独立假设同样偏离', () => {
    const e = runEngine(demoProject());
    const base = independenceBaseline(e, 'rho')!;
    expect(Math.abs(base.sdIndependent - base.sdCorrelated) / base.sdCorrelated).toBeGreaterThan(0.05);
  });
});
