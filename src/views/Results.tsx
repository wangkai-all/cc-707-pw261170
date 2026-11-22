import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Callout, Card, ConfirmDialog, Empty, Field, TextField } from '../components/ui';
import { Icon } from '../components/Icon';
import {
  HBarChart,
  HistogramChart,
  IntervalChart,
  SegmentedBar,
} from '../charts/primitives';
import { caretSnippet, FUNCTIONS, parseFormula, collectIdentifiers } from '../core/expr';
import { compareLinearity } from '../core/engine';
import { fromSI, getUnit, unitGroups, unitLabel } from '../core/units';
import {
  contributionDisplay,
  formatValue,
  formatWithUnc,
  relativePercent,
  resultDisplay,
  varianceToDisplay,
} from '../components/format';
import type { ResultDef } from '../core/types';

const EXAMPLES = [
  { label: '圆柱体积', formula: 'pi * (D/2)^2 * L', unit: 'mm3' },
  { label: '密度', formula: 'm / V', unit: 'g_cm3' },
  { label: '两位置平均', formula: '(L + L2) / 2', unit: 'mm' },
  { label: '两支温度计平均', formula: '(T + T2) / 2', unit: 'degC' },
  { label: '温度差', formula: 'T - T2', unit: 'degC' },
  { label: '热膨胀', formula: 'dLm / (L * dTcal)', unit: '1_degC' },
];

export function ResultsView() {
  const store = useStore();
  const { project, engine, selectedResult } = store;
  // 用项目中的符号定位定义，再按定义 id 找计算结果：
  // 重命名符号时（引擎基于延迟值）编辑器不会闪回第一个结果。
  const selectedDef =
    project.results.find((r) => r.symbol === selectedResult) ?? project.results[0] ?? null;
  const selected =
    engine.results.find((r) => r.def.id === selectedDef?.id) ??
    engine.results.find((r) => r.def.symbol === selectedResult) ??
    engine.results[0] ??
    null;
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const rd = selected ? resultDisplay(selected) : null;
  const cmp = selected && selected.ok ? compareLinearity(selected, selected.def.unit) : null;

  const validation = selected
    ? engine.formulaGraph.validations.find((v) => v.resultId === selected.def.id)
    : null;

  const deps = useMemo(() => {
    if (!selected) return [] as string[];
    try {
      return [...collectIdentifiers(parseFormula(selected.def.formula))];
    } catch {
      return [] as string[];
    }
  }, [selected]);

  const unitDef = selected ? getUnit(selected.def.unit) : null;
  const renderUnit = selected ? unitLabel(selected.def.unit) : '';

  const commit = (patch: Partial<ResultDef>) => {
    if (!selected) return;
    store.updateProject((p) => ({
      ...p,
      results: p.results.map((r) => (r.id === selected.def.id ? { ...r, ...patch } : r)),
    }));
  };

  const addResult = (formula = 'x', unit = 'mm') => {
    let n = 1;
    let symbol = `R${n}`;
    while (
      project.results.some((r) => r.symbol === symbol) ||
      project.inputs.some((q) => q.symbol === symbol)
    ) {
      n += 1;
      symbol = `R${n}`;
    }
    const next: ResultDef = {
      id: `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      symbol,
      name: '新结果',
      formula,
      unit,
      note: '',
    };
    store.updateProject(
      (p) => ({ ...p, results: [...p.results, next] }),
      { select: symbol },
    );
  };

  const removeResult = (id: string) => {
    const target = project.results.find((r) => r.id === id);
    const usedBy = target
      ? project.results.filter(
          (r) => r.id !== id && new RegExp(`\\b${target.symbol}\\b`).test(r.formula),
        )
      : [];
    if (usedBy.length) {
      store.toast(`结果 ${usedBy.map((r) => r.symbol).join('、')} 引用了该符号，不能删除`, 'bad');
      return;
    }
    store.updateProject(
      (p) => ({ ...p, results: p.results.filter((r) => r.id !== id) }),
      { select: project.results.find((r) => r.id !== id)?.symbol ?? null },
    );
    setDeleteId(null);
    store.toast('已删除结果', 'warn');
  };

  const setSetting = (patch: Partial<typeof project.settings>) => {
    store.updateProject((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>结果与公式</h1>
          <p>
            公式只允许白名单运算与已定义符号。计算前先检查量纲、依赖环、定义域和分母接近零；
            一阶传播与固定种子蒙特卡洛使用同一相关模型，非线性明显时给出两者的差异。
          </p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => setShowHelp((v) => !v)}>
          {showHelp ? '收起语法' : '语法与示例'}
        </button>
        <button type="button" className="btn primary" onClick={() => addResult()}>
          <Icon name="plus" size={14} /> 新增结果
        </button>
      </div>

      {showHelp ? (
        <Card title="公式语法（白名单）" subtitle="不使用 eval：解析 → 量纲推导 → 前向导数 → 求值">
          <div className="stack" style={{ gap: 10 }}>
            <div className="small secondary">
              <strong>运算符：</strong> + − × ÷ ^（右结合），前缀负号，百分号后缀，隐式乘法（如 2L）。<br />
              <strong>常量：</strong> pi、e。<strong>函数：</strong>{' '}
              <span className="mono">{FUNCTIONS.join('、')}</span>。
              <br />
              <strong>量纲：</strong>加减要求同量纲；乘除自由；ln/exp/三角函数要求无量纲；开方需可整除。
              结果会与实际声明的单位量纲比对。温度差写作 <span className="mono">T - T2</span>，也可用{' '}
              <span className="mono">20 °C</span> 这类区间字面量。
            </div>
            <div className="example-formulas">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  className="btn sm"
                  title={`使用示例：${ex.formula}`}
                  onClick={() => {
                    const symbols = new Set(project.inputs.map((q) => q.symbol));
                    const parts = ex.formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
                    const missing = [...new Set(parts)].filter(
                      (p) => !symbols.has(p) && !['pi', 'e', 'sqrt', 'cbrt'].includes(p) && !FUNCTIONS.includes(p as never),
                    );
                    if (missing.length) {
                      store.toast(`示例需要输入量：${missing.join('、')}`, 'warn');
                      return;
                    }
                    addResult(ex.formula, ex.unit);
                  }}
                >
                  {ex.label} <span className="mono muted">{ex.formula}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)' }}>
        <Card title="结果清单" flush actions={<span className="small muted">{project.results.length} 项</span>}>
          {project.results.length === 0 ? (
            <Empty
              title="还没有结果"
              action={<button type="button" className="btn sm" onClick={() => addResult()}>新增结果</button>}
            >
              输入量准备好后，用公式把测量结果表达出来。
            </Empty>
          ) : (
            <div className="result-list">
              {engine.results.map((r) => {
                const d = resultDisplay(r);
                return (
                  <button
                    key={r.def.id}
                    type="button"
                    className="result-row"
                    aria-current={selected?.def.id === r.def.id}
                    onClick={() => store.setSelectedResult(r.def.symbol)}
                  >
                    <span className="rr-sym">{r.def.symbol}</span>
                    <span className="rr-main">
                      <span className="rr-name">{r.def.name}</span>
                      <span className="rr-formula">{r.def.formula}</span>
                    </span>
                    <span className="rr-value small">
                      {r.ok ? formatWithUnc(d.value, d.u).text : '—'}
                      <div className="tiny muted">{unitLabel(r.def.unit)}</div>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {selected && rd ? (
          <div className="stack">
            <Card
              title={
                <span className="hstack" style={{ gap: 8 }}>
                  <span className="mono">{selected.def.symbol}</span>
                  {selected.def.name}
                  {!selected.ok ? <Badge tone="bad">检查未通过</Badge> : cmp?.nonlinear ? (
                    <Badge tone="warn">非线性明显</Badge>
                  ) : (
                    <Badge tone="good">一阶≈MC</Badge>
                  )}
                </span>
              }
              subtitle={`依赖：${deps.length ? deps.map((d) => <span key={d} className="chip mono" style={{ marginRight: 4 }}>{d}</span>) : '无'}`}
              actions={
                <button type="button" className="btn danger sm" onClick={() => setDeleteId(selected.def.id)}>
                  <Icon name="trash" size={13} /> 删除
                </button>
              }
            >
              <div className="stack" style={{ gap: 14 }}>
                <div className="form-grid c4">
                  <Field label="结果符号" hint="字母或下划线开头">
                    <TextField
                      className="mono"
                      value={selected.def.symbol}
                      live={false}
                      onCommit={(next) => {
                        const clash =
                          project.results.some((r) => r.id !== selected.def.id && r.symbol === next) ||
                          project.inputs.some((q) => q.symbol === next);
                        if (clash) store.toast('符号已被占用', 'warn');
                        commit({ symbol: next });
                        store.setSelectedResult(next);
                      }}
                    />
                  </Field>
                  <Field label="名称" span="span-2">
                    <TextField value={selected.def.name} onCommit={(v) => commit({ name: v })} />
                  </Field>
                  <Field
                    label="单位"
                    hint={unitDef ? undefined : '单位无效'}
                  >
                    <select value={selected.def.unit} onChange={(e) => commit({ unit: e.target.value })}>
                      {unitGroups().map((g) => (
                        <optgroup key={g.id} label={g.label}>
                          {g.units.map((u) => (
                            <option key={u.id} value={u.id}>{u.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="公式" hint="只允许白名单函数与已定义符号">
                  <textarea
                    className="mono formula-input"
                    style={{ minHeight: 58 }}
                    value={selected.def.formula}
                    spellCheck={false}
                    onChange={(e) => commit({ formula: e.target.value })}
                  />
                </Field>

                {validation?.error ? (
                  <Callout tone="error" title="公式检查未通过">
                    <div className="small">{validation.error}</div>
                  </Callout>
                ) : null}

                {selected.issues.filter((i) => i.severity === 'error').length > 0 ? (
                  <div className="stack" style={{ gap: 6 }}>
                    {selected.issues
                      .filter((i) => i.severity === 'error')
                      .map((i, idx) => (
                        <Callout key={idx} tone="error" title={i.code}>
                          <div>{i.message.replace(/^\[[^\]]+\]\s*/, '')}</div>
                          {i.pos !== undefined && Number.isFinite(i.pos) ? (
                            <pre
                              className="mono"
                              style={{
                                margin: '6px 0 0',
                                padding: '6px 8px',
                                background: 'var(--surface-2)',
                                borderRadius: 6,
                                fontSize: 11.5,
                                overflowX: 'auto',
                              }}
                            >
                              {caretSnippet(selected.def.formula, i.pos)}
                            </pre>
                          ) : null}
                        </Callout>
                      ))}
                  </div>
                ) : null}

                {selected.issues.filter((i) => i.severity === 'warning').length > 0 ? (
                  <div className="stack" style={{ gap: 6 }}>
                    {selected.issues
                      .filter((i) => i.severity === 'warning')
                      .slice(0, 4)
                      .map((i, idx) => (
                        <Callout key={idx} tone="warn">
                          {i.message.replace(/^\[[^\]]+\]\s*/, '')}
                        </Callout>
                      ))}
                  </div>
                ) : null}

                <Field label="备注">
                  <TextField value={selected.def.note} onCommit={(v) => commit({ note: v })} />
                </Field>
              </div>
            </Card>

            {selected.ok ? (
              <>
                <Card title="结果与不确定度" subtitle="GUM 一阶传播；k = 2 区间按正态近似">
                  <div className="stack" style={{ gap: 14 }}>
                    <div className="hstack" style={{ alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
                      <div>
                        <div className="hero-value tabular">
                          {formatValue(rd.value, 6)}
                          <span className="hero-unit" style={{ marginLeft: 8 }}>{renderUnit}</span>
                        </div>
                        <div className="secondary" style={{ marginTop: 6 }}>
                          标准不确定度 u = {formatValue(rd.u, 4)} {renderUnit} · 相对 {relativePercent(rd.u, rd.value)}
                        </div>
                      </div>
                      <div className="stack" style={{ gap: 6 }}>
                        <div>
                          <span className="tiny muted">一阶 95% 区间 </span>
                          <span className="tabular" style={{ fontWeight: 600 }}>
                            {formatValue(rd.value - 2 * rd.u, 5)} … {formatValue(rd.value + 2 * rd.u, 5)} {renderUnit}
                          </span>
                        </div>
                        {selected.mc ? (
                          <div>
                            <span className="tiny muted">蒙特卡洛 95% 区间 </span>
                            <span className="tabular" style={{ fontWeight: 600 }}>
                              {formatValue(rd.value + (selected.mc.q025SI - selected.valueSI), 5)} …{' '}
                              {formatValue(rd.value + (selected.mc.q975SI - selected.valueSI), 5)} {renderUnit}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <div className="hstack small secondary" style={{ marginBottom: 6 }}>
                        <span>方差构成（总 u² = {formatValue(varianceToDisplay(selected.variance, selected.def.unit), 3)} {renderUnit}²）</span>
                        <span className="spacer" />
                        <span className="muted">
                          来源 {selected.contributions.filter((c) => c.kind === 'source').length} · 自身{' '}
                          {selected.contributions.filter((c) => c.kind !== 'source').length}
                        </span>
                      </div>
                      <SegmentedBar
                        ariaLabel="结果方差构成"
                        height={12}
                        parts={selected.contributions.map((c) => ({
                          key: c.key,
                          label: `${c.label} ${(c.share * 100).toFixed(1)}%`,
                          value: c.share,
                          color:
                            c.kind === 'source'
                              ? 'var(--orange)'
                              : c.kind === 'input'
                                ? 'var(--violet)'
                                : c.key.includes(':resolution')
                                  ? 'var(--aqua)'
                                  : 'var(--blue)',
                        }))}
                      />
                    </div>

                    <div>
                      <div className="hstack small secondary" style={{ marginBottom: 4 }}>
                        <span>不确定度贡献（√方差，按大小排序）</span>
                        <span className="spacer" />
                        <button type="button" className="btn ghost sm" onClick={() => store.setView('trace')}>
                          溯源 <Icon name="arrow" size={12} />
                        </button>
                      </div>
                      <HBarChart
                        ariaLabel="不确定度贡献"
                        unit={renderUnit}
                        data={selected.contributions.map((c) => ({
                          key: c.key,
                          label: c.label,
                          value: contributionDisplay(c.variance, selected.def.unit),
                          color:
                            c.kind === 'source'
                              ? 'var(--orange)'
                              : c.kind === 'input'
                                ? 'var(--violet)'
                                : c.key.includes(':resolution')
                                  ? 'var(--aqua)'
                                  : 'var(--blue)',
                          secondary: `${(c.share * 100).toFixed(1)}%`,
                          negative: c.variance < 0,
                          detail: (
                            <>
                              <div className="tt-label">{c.detail}</div>
                              {c.affectedInputs.length ? (
                                <div className="tt-label">影响输入量：{c.affectedInputs.join('、')}</div>
                              ) : null}
                            </>
                          ),
                        }))}
                        formatValue={(v) => formatValue(v, 3)}
                      />
                    </div>

                    <div className="legend">
                      <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--orange)' }} />共享/校准来源</span>
                      <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--blue)' }} />重复性</span>
                      <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--aqua)' }} />分辨率</span>
                      <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--violet)' }} />手动相关的输入分量</span>
                    </div>
                  </div>
                </Card>

                <Card
                  title="一阶传播 vs 蒙特卡洛"
                  subtitle={`固定种子 ${project.settings.seed} · ${project.settings.draws.toLocaleString('zh-CN')} 次抽样`}
                  actions={
                    selected.mc ? (
                      <Badge tone="info">有效样本 {selected.mc.draws.toLocaleString('zh-CN')}</Badge>
                    ) : (
                      <Badge tone="bad">未运行</Badge>
                    )
                  }
                >
                  {!selected.mc ? (
                    <div className="small secondary">
                      蒙特卡洛未运行。通常是模型被阻断，或抽样数设置过小。
                    </div>
                  ) : (
                    <div className="stack" style={{ gap: 14 }}>
                      {cmp ? (
                        <Callout tone={cmp.nonlinear ? 'warn' : 'good'} title={cmp.nonlinear ? '非线性明显：一阶结果不可直接替代 MC' : '两种方法一致'}>
                          <div className="small">
                            一阶 95% 半宽 {formatValue(cmp.firstOrderHalfWidthDisplay, 4)} {renderUnit}；MC 半宽{' '}
                            {formatValue(cmp.mcHalfWidthDisplay, 4)} {renderUnit}。{cmp.reason}。
                            {cmp.nonlinear
                              ? ' 建议以蒙特卡洛区间报告，或缩小输入不确定度 / 改用不跨越零的表达式。'
                              : ' 一阶结果可作为报告值。'}
                          </div>
                        </Callout>
                      ) : null}

                      <div className="grid cols-2" style={{ gap: 18 }}>
                        <div>
                          <div className="small secondary" style={{ marginBottom: 4 }}>结果分布（蒙特卡洛）</div>
                          <HistogramChart
                            ariaLabel="蒙特卡洛结果分布"
                            edges={selected.mc.histogram.edges.map((e) => fromSI(e, selected.def.unit))}
                            counts={selected.mc.histogram.counts}
                            unit={renderUnit}
                            markers={[
                              { value: rd.value, label: '一阶值', color: 'var(--text-secondary)' },
                              {
                                value: fromSI(selected.mc.meanSI, selected.def.unit),
                                label: 'MC 均值',
                                color: 'var(--blue)',
                              },
                            ]}
                            height={220}
                          />
                        </div>
                        <div>
                          <div className="small secondary" style={{ marginBottom: 4 }}>95% 区间对照</div>
                          <IntervalChart
                            ariaLabel="一阶与蒙特卡洛区间对照"
                            unit={renderUnit}
                            rows={[
                              {
                                label: '一阶 ±2u',
                                lo: rd.value - 2 * rd.u,
                                hi: rd.value + 2 * rd.u,
                                center: rd.value,
                                color: 'var(--violet)',
                              },
                              {
                                label: '蒙特卡洛',
                                lo: rd.value + (selected.mc.q025SI - selected.valueSI),
                                hi: rd.value + (selected.mc.q975SI - selected.valueSI),
                                center: fromSI(selected.mc.meanSI, selected.def.unit),
                                color: 'var(--blue)',
                              },
                            ]}
                            format={(v) => formatValue(v, 7)}
                            height={140}
                          />
                        </div>
                      </div>

                      <div className="grid cols-4" style={{ gap: 2 }}>
                        <div className="stat">
                          <div className="label">MC 标准不确定度</div>
                          <div className="value sm tabular">
                            {formatValue(fromSI(selected.mc.sdSI, selected.def.unit), 4)}
                            <span className="unit">{renderUnit}</span>
                          </div>
                          <div className="sub">
                            相对一阶 {((selected.mc.sdSI / Math.max(1e-300, selected.sdSI) - 1) * 100).toFixed(2)}%
                          </div>
                        </div>
                        <div className="stat">
                          <div className="label">偏度</div>
                          <div className="value sm tabular">{selected.mc.skewness.toFixed(2)}</div>
                          <div className="sub">|偏度| &gt; 0.3 视为明显</div>
                        </div>
                        <div className="stat">
                          <div className="label">MC 范围</div>
                          <div className="value sm tabular" style={{ fontSize: 13 }}>
                            {formatValue(fromSI(selected.mc.minSI, selected.def.unit), 3)} …{' '}
                            {formatValue(fromSI(selected.mc.maxSI, selected.def.unit), 3)}
                          </div>
                          <div className="sub">{renderUnit}</div>
                        </div>
                        <div className="stat">
                          <div className="label">失效样本</div>
                          <div className="value sm tabular">{selected.mc.failures}</div>
                          <div className="sub">落在定义域外被剔除</div>
                        </div>
                      </div>

                      {selected.mcIssues.length > 0 ? (
                        <div className="stack" style={{ gap: 6 }}>
                          {selected.mcIssues.map((i, idx) => (
                            <Callout key={idx} tone={i.severity === 'error' ? 'error' : 'warn'}>
                              {i.message}
                            </Callout>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </Card>
              </>
            ) : (
              <Card>
                <Empty title="计算被阻断">
                  先修正上面的错误。协方差矩阵不合法时，工具会阻断计算而不是自动修复矩阵。
                </Empty>
              </Card>
            )}

            <Card title="抽样与检查设置" subtitle="固定种子保证同一输入可复现">
              <div className="form-grid c4">
                <Field label="随机种子" hint="同一种子产生同一组样本">
                  <TextField
                    inputMode="numeric"
                    className="mono"
                    value={String(project.settings.seed)}
                    parse={(raw) => (/^\d+$/.test(raw.trim()) ? String(Number(raw)) : null)}
                    onCommit={(v) => setSetting({ seed: Number(v) })}
                  />
                </Field>
                <Field label="抽样数" hint="1000 – 200000">
                  <select
                    value={project.settings.draws}
                    onChange={(e) => setSetting({ draws: Number(e.target.value) })}
                  >
                    {[2000, 5000, 10000, 20000, 50000, 100000].map((d) => (
                      <option key={d} value={d}>{d.toLocaleString('zh-CN')}</option>
                    ))}
                  </select>
                </Field>
                <Field label="分母近零阈值" hint="相对输入量级">
                  <TextField
                    inputMode="decimal"
                    className="mono"
                    value={String(project.settings.nearZeroRel)}
                    parse={(raw) => {
                      if (raw.trim() === '' || raw.endsWith('.')) return null;
                      const v = Number(raw);
                      return Number.isFinite(v) && v >= 0 ? String(v) : null;
                    }}
                    onCommit={(v) => setSetting({ nearZeroRel: Number(v) })}
                  />
                </Field>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setSetting({ seed: Math.floor(Math.random() * 1e9) })}
                  >
                    <Icon name="reset" size={12} /> 换一个种子
                  </button>
                </div>
              </div>
              <div className="small muted" style={{ marginTop: 10 }}>
                一阶结果使用前向导数；蒙特卡洛从同一模型抽样。分母近零检查用分母自身的标准不确定度
                （由协方差传播得到）判断，不依赖数值大小。所有数值均为虚构演示数据。
              </div>
            </Card>
          </div>
        ) : (
          <Card>
            <Empty title="选择一个结果">在左侧选择结果，或新增一个公式。</Empty>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title="删除结果"
        confirmLabel="删除"
        tone="danger"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => deleteId && removeResult(deleteId)}
      >
        删除后无法恢复（可用撤销）。仍被其它公式引用时不会被删除。
      </ConfirmDialog>
    </div>
  );
}
