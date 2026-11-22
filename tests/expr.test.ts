import { describe, expect, it } from 'vitest';
import { evaluateFormula, parseFormula, type EvalVar } from '../src/core/expr';
import { DIM_LENGTH, DIM_MASS, DIM_ZERO, dimEqual } from '../src/core/units';

function vars(map: Record<string, { v: number; dim: readonly [number, number, number, number] }>) {
  const entries = Object.entries(map);
  const m = new Map<string, EvalVar>();
  entries.forEach(([k, val], i) => {
    const grad = new Array(entries.length).fill(0);
    grad[i] = 1;
    m.set(k, { value: val.v, dim: val.dim, grad, label: k });
  });
  return m;
}

describe('公式解析与求值', () => {
  it('四则运算与优先级', () => {
    const ast = parseFormula('1 + 2 * 3');
    const r = evaluateFormula(ast, vars({}), 0, 1e-4);
    expect(r.value).toBe(7);
  });

  it('幂右结合且负号优先于幂', () => {
    expect(evaluateFormula(parseFormula('2^3^2'), vars({}), 0, 1e-4).value).toBe(512);
    expect(evaluateFormula(parseFormula('-2^2'), vars({}), 0, 1e-4).value).toBe(-4);
  });

  it('隐式乘法与百分号', () => {
    expect(evaluateFormula(parseFormula('2(3+4)'), vars({}), 0, 1e-4).value).toBe(14);
    expect(evaluateFormula(parseFormula('5%'), vars({}), 0, 1e-4).value).toBeCloseTo(0.05);
  });

  it('白名单之外的内容被拒绝', () => {
    expect(() => parseFormula('a.b')).toThrow();
    expect(() => parseFormula('alert(1)')).toThrow();
    expect(() => parseFormula('x = 1')).toThrow();
    expect(() => parseFormula('constructor')).not.toThrow(); // 视作普通变量名
  });

  it('量纲推断：体积与密度', () => {
    const v = vars({ D: { v: 25, dim: DIM_LENGTH }, m: { v: 200, dim: DIM_MASS } });
    const volume = evaluateFormula(parseFormula('pi*(D/2)^2*D'), v, 2, 1e-4);
    expect(dimEqual(volume.dim, [3, 0, 0, 0])).toBe(true);
    const density = evaluateFormula(parseFormula('m/(pi*(D/2)^2*D)'), v, 2, 1e-4);
    expect(dimEqual(density.dim, [-3, 1, 0, 0])).toBe(true);
  });

  it('量纲不一致被报告', () => {
    const v = vars({ L: { v: 1, dim: DIM_LENGTH }, m: { v: 1, dim: DIM_MASS } });
    const r = evaluateFormula(parseFormula('L + m'), v, 2, 1e-4);
    expect(r.issues.some((i) => i.code === 'dimension' && i.severity === 'error')).toBe(true);
  });

  it('sqrt 的非整数量纲被拒绝，sqrt(L^2) 合法', () => {
    const v = vars({ L: { v: 4, dim: DIM_LENGTH } });
    expect(evaluateFormula(parseFormula('sqrt(L)'), v, 1, 1e-4).issues.some((i) => i.code === 'dimension')).toBe(true);
    const ok = evaluateFormula(parseFormula('sqrt(L^2)'), v, 1, 1e-4);
    expect(ok.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(dimEqual(ok.dim, DIM_LENGTH)).toBe(true);
  });

  it('导数用于一阶传播：m/V', () => {
    const v = vars({ m: { v: 200, dim: DIM_MASS }, V: { v: 8, dim: [3, 0, 0, 0] as const } });
    const r = evaluateFormula(parseFormula('m/V'), v, 2, 1e-4);
    expect(r.grad[0]).toBeCloseTo(1 / 8);
    expect(r.grad[1]).toBeCloseTo(-200 / 64);
  });

  it('除零与接近零分母', () => {
    const v = vars({ x: { v: 0, dim: DIM_ZERO } });
    const zero = evaluateFormula(parseFormula('1/x'), v, 1, 1e-4);
    expect(zero.issues.some((i) => i.code === 'divide-zero')).toBe(true);
    const tiny = vars({ x: { v: 1e-12, dim: DIM_ZERO }, y: { v: 1, dim: DIM_ZERO } });
    const near = evaluateFormula(parseFormula('y/x'), tiny, 2, 1e-4);
    // 分母是否"接近零"需要结合不确定度，交由引擎判定；此处仅确认除法可计算
    expect(near.divisions).toHaveLength(1);
    expect(near.divisions[0].value).toBe(1e-12);
  });

  it('函数定义域错误', () => {
    const v = vars({ x: { v: -1, dim: DIM_ZERO } });
    expect(evaluateFormula(parseFormula('ln(x)'), v, 1, 1e-4).issues.some((i) => i.code === 'domain')).toBe(true);
    expect(evaluateFormula(parseFormula('sqrt(x)'), v, 1, 1e-4).issues.some((i) => i.code === 'domain')).toBe(true);
  });

  it('未知变量被报告', () => {
    const r = evaluateFormula(parseFormula('L * zz'), vars({ L: { v: 1, dim: DIM_LENGTH } }), 1, 1e-4);
    expect(r.issues.some((i) => i.code === 'unknown-symbol')).toBe(true);
  });
});
