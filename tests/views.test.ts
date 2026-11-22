// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StoreProvider } from '../src/state/store';
import { demoProject } from '../src/data/demo';
import { runEngine } from '../src/core/engine';
import type { Project } from '../src/core/types';
import { OverviewView } from '../src/views/Overview';
import { SourcesView } from '../src/views/Sources';
import { InstrumentsView } from '../src/views/Instruments';
import { InputsView } from '../src/views/Inputs';
import { ResultsView } from '../src/views/Results';
import { CorrelationView } from '../src/views/Correlation';
import { TraceView } from '../src/views/Trace';
import { CompareView } from '../src/views/Compare';

const views = [
  ['overview', OverviewView],
  ['sources', SourcesView],
  ['instruments', InstrumentsView],
  ['inputs', InputsView],
  ['results', ResultsView],
  ['correlation', CorrelationView],
  ['trace', TraceView],
  ['compare', CompareView],
] as const;

function render(name: string) {
  return renderToString(
    createElement(StoreProvider, null, createElement(views.find((v) => v[0] === name)![1])),
  );
}

describe('render smoke', () => {
  for (const [name] of views) {
    it(`${name} renders`, () => {
      const html = render(name);
      expect(html.length).toBeGreaterThan(200);
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Infinity');
    });
  }
  it('demo model is valid and all results computed', () => {
    const e = runEngine(demoProject());
    expect(e.blocked).toBe(false);
    expect(e.results).toHaveLength(7);
    for (const r of e.results) {
      expect(r.ok).toBe(true);
      expect(r.mc).not.toBeNull();
      expect(r.sdSI).toBeGreaterThan(0);
    }
    const alpha = e.results.find((r) => r.def.symbol === 'alphaEst')!;
    expect(alpha.mc!.skewness).toBeGreaterThan(1);
    // 演示数据要让两条共享来源都能在贡献图中被看到：
    // SR-001 出现在 V / Lavg，SR-002 在 dT 中相消、在 Tavg 中成为主项。
    const tavg = e.results.find((r) => r.def.symbol === 'Tavg')!;
    const temp = tavg.contributions.find((c) => c.sourceCode === 'SR-002');
    expect(temp).toBeDefined();
    expect(temp!.share).toBeGreaterThan(0.9);
  });
  it('manual invalid correlation blocks every result', () => {
    const p: Project = demoProject();
    p.correlation = { mode: 'manual', entries: [{ aId: 'q-len', bId: 'q-len2', value: 1.4 }] };
    const e = runEngine(p);
    expect(e.blocked).toBe(true);
    expect(e.blockedReason).toContain('半正定');
    expect(e.results.every((r) => r.mc === null)).toBe(true);
  });
});
