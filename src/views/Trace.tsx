import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Card, Empty } from '../components/ui';
import { Icon } from '../components/Icon';
import { LinkChip } from '../charts/primitives';
import { contributionDisplay, formatValue, relativePercent, sdDisplay } from '../components/format';
import {
  INSTRUMENT_KIND_LABEL,
  DISTRIBUTION_LABEL,
  BASIS_LABEL,
} from '../core/types';
import { unitLabel } from '../core/units';
import { sourceStandardUncertainty } from '../core/stats';

/** 结果 → 公式依赖 → 输入量 → 仪表 → 校准来源 → 原始读数。 */
export function TraceView() {
  const store = useStore();
  const { project, engine, selectedResult } = store;
  const selectedDef =
    project.results.find((r) => r.symbol === selectedResult) ?? project.results[0] ?? null;
  const selected =
    engine.results.find((r) => r.def.id === selectedDef?.id) ??
    engine.results.find((r) => r.def.symbol === selectedResult) ??
    engine.results[0] ??
    null;
  const [openInput, setOpenInput] = useState<string | null>(null);

  const inputBySymbol = useMemo(
    () => new Map(project.inputs.map((q) => [q.symbol, q])),
    [project.inputs],
  );

  const directSymbols = useMemo(() => {
    if (!selected) return [] as string[];
    const validation = engine.formulaGraph.validations.find((v) => v.resultId === selected.def.id);
    if (validation) return validation.dependencies.filter((d) => inputBySymbol.has(d));
    return [];
  }, [selected, engine.formulaGraph, inputBySymbol]);

  /** 递归收集所有上游输入量（结果引用结果时） */
  const allSymbols = useMemo(() => {
    if (!selected) return [] as string[];
    const out = new Set<string>(directSymbols);
    const queue = [...directSymbols];
    while (queue.length) {
      const sym = queue.pop()!;
      const depResult = project.results.find((r) => r.symbol === sym);
      if (!depResult) continue;
      const v = engine.formulaGraph.validations.find((x) => x.resultId === depResult.id);
      for (const d of v?.dependencies ?? []) {
        if (inputBySymbol.has(d) && !out.has(d)) {
          out.add(d);
          queue.push(d);
        }
      }
    }
    return [...out];
  }, [selected, directSymbols, project.results, engine.formulaGraph, inputBySymbol]);

  const contributionByInput = useMemo(() => {
    const map = new Map<string, number>();
    if (!selected) return map;
    for (const c of selected.contributions) {
      if (c.inputId) map.set(c.inputId, (map.get(c.inputId) ?? 0) + c.share);
      for (const sym of c.affectedInputs) {
        const q = inputBySymbol.get(sym);
        if (q && c.kind === 'source') {
          map.set(q.id, (map.get(q.id) ?? 0) + c.share / Math.max(1, c.affectedInputs.length));
        }
      }
    }
    return map;
  }, [selected, inputBySymbol]);

  if (!selected) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>溯源链</h1>
            <p>从结果公式逐层追到原始读数与共享的校准来源。</p>
          </div>
        </div>
        <Card>
          <Empty title="还没有结果">先在“结果与公式”中定义至少一个结果。</Empty>
        </Card>
      </div>
    );
  }

  const renderUnit = unitLabel(selected.def.unit);
  const uDisplay = sdDisplay(selected.sdSI, selected.def.unit);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>溯源链</h1>
          <p>
            从结果沿公式依赖向下追踪到原始读数，向上追踪到校准来源。每一个来源编号只对应一个随机变量：
            两条不同测量若引用同一编号，它们的来源分量就是同一个变量。
          </p>
        </div>
        <span className="spacer" />
        <select
          aria-label="选择要溯源的结果"
          value={selected.def.symbol}
          onChange={(e) => store.setSelectedResult(e.target.value)}
          style={{ width: 'auto' }}
        >
          {engine.results.map((r) => (
            <option key={r.def.id} value={r.def.symbol}>{r.def.symbol} · {r.def.name}</option>
          ))}
        </select>
      </div>

      <div className="trace-grid">
        <div className="stack" style={{ gap: 0 }}>
          <div className="trace-node" style={{ borderColor: 'var(--blue)' }}>
            <div className="node-head">
              <Badge tone="info">结果</Badge>
              <span className="node-title mono">{selected.def.symbol}</span>
              <span>{selected.def.name}</span>
              <span className="spacer" />
              <span className="tabular small">
                {formatValue(selected.valueDisplay, 6)} ± {formatValue(sdDisplay(selected.sdSI, selected.def.unit), 3)} {renderUnit}
              </span>
            </div>
            <div className="node-body">
              <span className="mono">{selected.def.formula}</span>
              <span className="muted"> · 声明单位 {renderUnit} · 相对 {relativePercent(selected.sdSI, selected.valueDisplay)}</span>
            </div>
          </div>

          <div className="trace-arrow">
            <span className="line" />
            <span>公式依赖 {allSymbols.length} 个输入量</span>
          </div>

          {allSymbols.length === 0 ? (
            <div className="trace-node">
              <div className="node-body">该结果只引用常量，没有输入量依赖。</div>
            </div>
          ) : (
            allSymbols.map((sym) => {
              const q = inputBySymbol.get(sym)!;
              const model = engine.inputs.find((m) => m.input.id === q.id);
              const instrument = project.instruments.find((i) => i.id === q.instrumentId);
              const sources = instrument
                ? instrument.sourceLinks
                    .map((l) => ({ link: l, source: project.sources.find((s) => s.id === l.sourceId) }))
                    .filter((x): x is { link: typeof x.link; source: NonNullable<typeof x.source> } => Boolean(x.source))
                : [];
              const open = openInput === q.id;
              const share = contributionByInput.get(q.id) ?? 0;
              return (
                <div key={q.id} className="stack" style={{ gap: 0 }}>
                  <button
                    type="button"
                    className="trace-node"
                    style={{ textAlign: 'left', width: '100%', cursor: 'pointer', background: 'var(--surface-1)' }}
                    onClick={() => setOpenInput(open ? null : q.id)}
                    aria-expanded={open}
                  >
                    <div className="node-head">
                      <Badge>输入量</Badge>
                      <span className="node-title mono">{q.symbol}</span>
                      <span>{q.name}</span>
                      <span className="spacer" />
                      {share > 0 ? <Badge tone="info">贡献 {Math.min(100, share * 100).toFixed(1)}%</Badge> : null}
                      <span className="tabular small">
                        {model ? formatValue(model.summary.meanDisplay, 6) : '—'} {unitLabel(q.unit)}
                      </span>
                      <Icon name="chevron" size={13} />
                    </div>
                    <div className="node-body">
                      {q.mode === 'series'
                        ? `${model?.summary.stats?.n ?? 0} 条读数，均值 ${formatValue(model?.summary.stats?.mean ?? Number.NaN, 6)}，s = ${formatValue(model?.summary.stats?.sd ?? Number.NaN, 4)}`
                        : `常量 ${q.constantValue || '—'}，B 类 u = ${q.constantUncertainty || '0'}`}
                      {' · '}
                      自身 u = {formatValue(model?.summary.ownDisplay ?? 0, 4)} {unitLabel(q.unit)}
                      {instrument ? ` · 仪表 ${instrument.code}` : ' · 无仪表'}
                      {sources.length ? ` · 来源 ${sources.map((s) => s.source.code).join('、')}` : ''}
                    </div>
                  </button>

                  {open ? (
                    <div
                      className="stack"
                      style={{
                        gap: 0,
                        margin: '0 0 0 14px',
                        paddingLeft: 12,
                        borderLeft: '1px solid var(--border-strong)',
                      }}
                    >
                      <div className="trace-arrow"><span className="line" /><span>原始读数</span></div>
                      <div className="trace-node">
                        <div className="node-head">
                          <Badge>读数</Badge>
                          <span className="node-title">{q.mode === 'series' ? `${model?.summary.stats?.n ?? 0} 条` : '常量'}</span>
                        </div>
                        <div className="node-body">
                          {q.mode === 'series' ? (
                            <div className="readings-editor" style={{ marginTop: 4 }}>
                              {q.readings.filter((r) => r.trim() !== '').map((r, i) => (
                                <span key={i} className="chip mono">{r}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="mono">{q.constantValue} {unitLabel(q.unit)}</span>
                          )}
                          <div className="small muted" style={{ marginTop: 6 }}>
                            分辨率 {formatValue(model?.summary.resolutionDisplay ?? 0, 4)} {unitLabel(q.unit)}
                            ；重复性 u = {formatValue(model?.summary.repeatabilityDisplay ?? 0, 4)}
                            ；分辨率分量 u = {formatValue(model?.summary.resolutionComponentDisplay ?? 0, 4)}
                          </div>
                        </div>
                      </div>

                      <div className="trace-arrow"><span className="line" /><span>仪表</span></div>
                      {instrument ? (
                        <div className="trace-node">
                          <div className="node-head">
                            <Badge tone="info">仪表</Badge>
                            <span className="node-title mono">{instrument.code}</span>
                            <span>{instrument.name}</span>
                            <span className="spacer" />
                            <span className="small muted">{INSTRUMENT_KIND_LABEL[instrument.kind]} · {instrument.serial || '无序列号'}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="trace-node">
                          <div className="node-body">该输入量未引用仪表，没有校准来源链。</div>
                        </div>
                      )}

                      {sources.length > 0 ? (
                        <>
                          <div className="trace-arrow"><span className="line" /><span>校准来源（共享变量）</span></div>
                          {sources.map(({ link, source }) => {
                            const calc = sourceStandardUncertainty(source);
                            const users = project.instruments.filter((i) =>
                              i.sourceLinks.some((x) => x.sourceId === source.id),
                            );
                            const affected = project.inputs.filter((q2) => {
                              const inst2 = project.instruments.find((i) => i.id === q2.instrumentId);
                              return inst2?.sourceLinks.some((x) => x.sourceId === source.id);
                            });
                            return (
                              <div key={source.id} className="trace-node" style={{ borderColor: 'var(--orange)' }}>
                                <div className="node-head">
                                  <Badge tone="warn">来源</Badge>
                                  <span className="node-title mono">{source.code}</span>
                                  <span>{source.name}</span>
                                  <span className="spacer" />
                                  <Badge tone="info">{link.mode === 'relative' ? '相对' : '加性'}</Badge>
                                </div>
                                <div className="node-body">
                                  {BASIS_LABEL[source.basis]} = {source.magnitude || '—'} {unitLabel(source.uncUnit)}
                                  {source.basis === 'expanded' ? `，k = ${source.coverageK || '2'}` : ''}
                                  {' · '}
                                  {DISTRIBUTION_LABEL[source.distribution]} → u = {calc.error ? '无效' : `${formatValue(calc.uDisplay, 4)} ${unitLabel(source.uncUnit)}`}
                                  {source.value ? ` · 证书赋值 ${source.value} ${unitLabel(source.valueUnit)}` : ''}
                                </div>
                                <div className="node-body">
                                  <div className="hstack" style={{ gap: 6 }}>
                                    <span className="muted small">被</span>
                                    {users.map((u2) => (
                                      <span key={u2.id} className="chip mono">{u2.code}</span>
                                    ))}
                                    <span className="muted small">共用；影响输入量</span>
                                    {affected.map((q2) => (
                                      <LinkChip key={q2.id} onClick={() => setOpenInput(q2.id)}>
                                        {q2.symbol}
                                      </LinkChip>
                                    ))}
                                  </div>
                                  <div className="small muted" style={{ marginTop: 6 }}>
                                    {users.length > 1
                                      ? '这是一个共享随机变量：同一编号的偏差会同时作用于上述输入量，形成协方差。'
                                      : '仅一台仪表引用，暂未产生输入量之间的相关。'}
                                  </div>
                                  {source.lab || source.certificate ? (
                                    <div className="tiny muted" style={{ marginTop: 4 }}>
                                      {[source.lab, source.certificate, source.validUntil ? `有效期至 ${source.validUntil}` : '']
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="stack">
          <Card title="本结果的变量贡献" subtitle="按潜变量列出，含受影响的输入量">
            {selected.contributions.length === 0 ? (
              <div className="small muted">没有正贡献。</div>
            ) : (
              <ul className="mini-list">
                {selected.contributions.map((c) => (
                  <li key={c.key}>
                    <span
                      className="dotmark"
                      style={{
                        background:
                          c.kind === 'source' ? 'var(--orange)' : c.key.includes(':resolution') ? 'var(--aqua)' : 'var(--blue)',
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className="small" style={{ fontWeight: 550 }}>{c.label}</div>
                      <div className="tiny muted">
                        {c.affectedInputs.length ? `输入量 ${c.affectedInputs.join('、')} · ` : ''}
                        {(c.share * 100).toFixed(1)}% · √方差 {formatValue(contributionDisplay(c.variance, selected.def.unit), 3)} {renderUnit}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="链路统计">
            <dl className="kv">
              <dt>直接依赖</dt>
              <dd>{directSymbols.join('、') || '—'}</dd>
              <dt>全部上游输入量</dt>
              <dd>{allSymbols.join('、') || '—'}</dd>
              <dt>仪表数</dt>
              <dd>
                {
                  new Set(
                    allSymbols
                      .map((s) => inputBySymbol.get(s)?.instrumentId)
                      .filter((x): x is string => Boolean(x)),
                  ).size
                }
              </dd>
              <dt>来源数</dt>
              <dd>
                {
                  new Set(
                    project.instruments
                      .filter((i) =>
                        allSymbols.some((s) => inputBySymbol.get(s)?.instrumentId === i.id),
                      )
                      .flatMap((i) => i.sourceLinks.map((l) => l.sourceId)),
                  ).size
                }
              </dd>
              <dt>结果不确定度</dt>
              <dd className="tabular">{formatValue(uDisplay, 4)} {renderUnit}</dd>
            </dl>
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn sm" onClick={() => store.setView('compare')}>
                改配后会发生什么？ <Icon name="arrow" size={12} />
              </button>
            </div>
          </Card>

          <Card title="操作提示">
            <div className="small secondary">
              点击任一输入量卡片展开原始读数、仪表与来源。点击来源中的输入量标签可跳到另一条链路；
              带“共用”的来源正是相关性来源——把其中一台仪表改为独立标准件，可用“改配与对比”预览。
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
