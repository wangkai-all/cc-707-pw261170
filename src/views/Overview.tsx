import { useMemo } from 'react';
import { useStore } from '../state/store';
import { Badge, Card, Empty, Stat } from '../components/ui';
import { HBarChart, SegmentedBar } from '../charts/primitives';
import {
  contributionDisplay,
  formatValue,
  formatWithUnc,
  relativePercent,
  resultDisplay,
  sdDisplay,
  varianceToDisplay,
} from '../components/format';
import { compareLinearity } from '../core/engine';
import { Icon } from '../components/Icon';
import { independenceBaseline } from '../core/baseline';
import { unitLabel } from '../core/units';

export function OverviewView() {
  const store = useStore();
  const { project, engine, selectedResult } = store;
  const selectedDef =
    project.results.find((r) => r.symbol === selectedResult) ?? project.results[0] ?? null;
  const selected =
    engine.results.find((r) => r.def.id === selectedDef?.id) ??
    engine.results.find((r) => r.def.symbol === selectedResult) ??
    engine.results[0] ??
    null;

  const errors = engine.issues.filter((i) => i.severity === 'error');
  const warnings = engine.issues.filter((i) => i.severity === 'warning');

  const sourceUsage = useMemo(() => {
    const map = new Map<string, { instruments: string[]; inputs: string[] }>();
    for (const src of project.sources) map.set(src.id, { instruments: [], inputs: [] });
    for (const inst of project.instruments) {
      for (const l of inst.sourceLinks) {
        map.get(l.sourceId)?.instruments.push(inst.code);
      }
    }
    for (const q of project.inputs) {
      const inst = project.instruments.find((i) => i.id === q.instrumentId);
      inst?.sourceLinks.forEach((l) => map.get(l.sourceId)?.inputs.push(q.symbol));
    }
    return map;
  }, [project]);

  const sharedSources = project.sources.filter(
    (s) => (sourceUsage.get(s.id)?.instruments.length ?? 0) > 1,
  );

  if (engine.results.length === 0) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>测量结果分析</h1>
            <p>建立校准来源、仪表、输入量与结果公式后，这里会显示结果值、不确定度区间及其主要来源。</p>
          </div>
        </div>
        <Card>
          <Empty
            title="还没有结果"
            action={
              <div className="inline-actions">
                <button type="button" className="btn primary" onClick={() => store.setView('results')}>
                  <Icon name="plus" size={14} /> 添加结果公式
                </button>
                <button type="button" className="btn" onClick={store.resetDemo}>
                  载入演示数据
                </button>
              </div>
            }
          >
            从校准来源开始录入，仪表引用来源，输入量引用仪表；不同仪表引用同一来源时，它们的不确定度会自动相关。
          </Empty>
        </Card>
      </div>
    );
  }

  const rd = selected ? resultDisplay(selected) : null;
  const cmp = selected && selected.ok ? compareLinearity(selected, selected.def.unit) : null;
  const baseline = selected ? independenceBaseline(engine, selected.def.symbol) : null;
  const totalVariance = selected ? varianceToDisplay(selected.variance, selected.def.unit) : 0;
  const top = selected?.contributions.slice(0, 5) ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>测量结果分析</h1>
          <p>
            结果值与其不确定度来自同一组共享随机变量：同一校准来源只产生一个随机变量，各条测量的重复误差保持独立。
            数值全部为虚构演示。
          </p>
        </div>
        <span className="spacer" />
        <div className="inline-actions">
          <button type="button" className="btn" onClick={() => store.setView('trace')}>
            <Icon name="trace" size={14} /> 查看溯源
          </button>
          <button type="button" className="btn primary" onClick={() => store.setView('results')}>
            结果工作区
          </button>
        </div>
      </div>

      {engine.blocked ? (
        <div className="callout error" style={{ marginBottom: 14 }} role="alert">
          <span className="ico"><Icon name="x" size={15} /></span>
          <div>
            <strong>计算已阻断：</strong>
            {engine.blockedReason}
            <div style={{ marginTop: 6 }}>
              {errors.slice(0, 4).map((e, i) => (
                <div key={i} className="small">· {e.message}</div>
              ))}
            </div>
          </div>
        </div>
      ) : warnings.length > 0 ? (
        <div className="callout warn" style={{ marginBottom: 14 }}>
          <span className="ico"><Icon name="alert" size={15} /></span>
          <div>
            <strong>{warnings.length} 条提醒：</strong>
            {warnings.slice(0, 3).map((w) => w.message).join('；')}
          </div>
        </div>
      ) : null}

      <div className="grid main-side">
        <div className="stack">
          <Card
            title={
              <span className="hstack" style={{ gap: 8 }}>
                <span className="mono" style={{ fontSize: 13 }}>{selected?.def.symbol}</span>
                {selected?.def.name}
                {cmp?.nonlinear ? <Badge tone="warn">非线性明显</Badge> : cmp ? <Badge tone="good">一阶≈MC</Badge> : null}
              </span>
            }
            subtitle={<span className="mono small">{selected?.def.formula}</span>}
            actions={
              <select
                aria-label="选择结果"
                value={selected?.def.symbol ?? ''}
                onChange={(e) => store.setSelectedResult(e.target.value)}
                style={{ width: 'auto' }}
              >
                {engine.results.map((r) => (
                  <option key={r.def.id} value={r.def.symbol}>
                    {r.def.symbol} · {r.def.name}
                  </option>
                ))}
              </select>
            }
          >
            {selected && rd ? (
              <div className="stack" style={{ gap: 14 }}>
                <div className="hstack" style={{ alignItems: 'flex-end', gap: 22, flexWrap: 'wrap' }}>
                  <div>
                    <div className="hero-value tabular">
                      {formatValue(rd.value, 6)}
                      <span className="hero-unit" style={{ marginLeft: 8 }}>{rd.unit}</span>
                    </div>
                    <div className="secondary" style={{ marginTop: 6, fontSize: 14 }}>
                      u = {formatValue(rd.u, 3)} {rd.unit} · 相对 {relativePercent(rd.u, rd.value)}
                    </div>
                  </div>
                  <div className="hstack" style={{ gap: 18 }}>
                    <div>
                      <div className="tiny muted">95% 区间（一阶，k=2）</div>
                      <div className="tabular" style={{ fontSize: 16, fontWeight: 600 }}>
                        {formatValue(rd.value - 2 * rd.u, 5)} … {formatValue(rd.value + 2 * rd.u, 5)}
                      </div>
                    </div>
                    {selected.mc && selected.ok ? (
                      <div>
                        <div className="tiny muted">95% 区间（蒙特卡洛）</div>
                        <div className="tabular" style={{ fontSize: 16, fontWeight: 600 }}>
                          {formatValue(rd.value + (selected.mc.q025SI - selected.valueSI), 5)} …{' '}
                          {formatValue(rd.value + (selected.mc.q975SI - selected.valueSI), 5)}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="hstack small secondary" style={{ marginBottom: 6 }}>
                    <span>方差构成（{formatValue(totalVariance, 3)} {rd.unit}²）</span>
                    <span className="spacer" />
                    <span className="muted">{selected.contributions.length} 个来源</span>
                  </div>
                  <SegmentedBar
                    ariaLabel="方差构成"
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
                            : 'var(--blue)',
                    }))}
                  />
                </div>

                <div>
                  <div className="hstack small secondary" style={{ marginBottom: 4 }}>
                    <span>主要贡献</span>
                    <span className="spacer" />
                    <button type="button" className="btn ghost sm" onClick={() => store.setView('results')}>
                      完整分解
                    </button>
                  </div>
                  <HBarChart
                    ariaLabel="不确定度贡献"
                    unit={rd.unit}
                    data={top.map((c) => ({
                      key: c.key,
                      label: c.label,
                      value: contributionDisplay(c.variance, selected.def.unit),
                      color: c.kind === 'source' ? 'var(--orange)' : c.kind === 'input' ? 'var(--violet)' : 'var(--blue)',
                      secondary: `${(c.share * 100).toFixed(1)}%`,
                      detail: <div className="tt-label">{c.detail}</div>,
                    }))}
                    formatValue={(v) => formatValue(v, 3)}
                  />
                </div>
              </div>
            ) : (
              <Empty title="没有可显示的结果" />
            )}
          </Card>

          <Card title="结果一览" flush>
            <div className="result-list">
              {engine.results.map((r) => {
                const d = resultDisplay(r);
                const rel = relativePercent(d.u, d.value);
                const active = r.def.symbol === selected?.def.symbol;
                return (
                  <button
                    key={r.def.id}
                    type="button"
                    className="result-row"
                    aria-current={active}
                    onClick={() => store.setSelectedResult(r.def.symbol)}
                  >
                    <span className="rr-sym">{r.def.symbol}</span>
                    <span className="rr-main">
                      <span className="rr-name">{r.def.name}</span>
                      <span className="rr-formula">{r.def.formula}</span>
                    </span>
                    <span className="rr-value">
                      <span style={{ fontWeight: 600 }}>{formatWithUnc(d.value, d.u).value}</span>
                      <span className="muted"> ± {formatWithUnc(d.value, d.u).u}</span>
                      <span className="muted small"> {d.unit}</span>
                      <div className="tiny muted">{rel} · k=2 区间</div>
                    </span>
                    {!r.ok ? <Badge tone="bad">检查</Badge> : null}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="模型规模">
            <div className="grid cols-2" style={{ gap: 4 }}>
              <Stat label="校准来源" value={project.sources.length} sub={`${sharedSources.length} 个被多台共用`} />
              <Stat label="仪表" value={project.instruments.length} />
              <Stat label="输入量" value={project.inputs.length} sub={`${engine.variables.filter((v) => v.kind === 'own').length} 个自身分量`} />
              <Stat label="结果" value={project.results.length} />
            </div>
          </Card>

          {sharedSources.length > 0 ? (
            <Card title="共用来源" subtitle="会引入输入量之间的相关性">
              <ul className="mini-list">
                {sharedSources.map((s) => {
                  const usage = sourceUsage.get(s.id);
                  return (
                    <li key={s.id}>
                      <span className="dotmark" style={{ background: 'var(--orange)' }} />
                      <div style={{ minWidth: 0 }}>
                        <div className="hstack" style={{ gap: 6 }}>
                          <span className="chip mono">{s.code}</span>
                          <span>{s.name}</span>
                        </div>
                        <div className="small muted" style={{ marginTop: 2 }}>
                          被 {usage?.instruments.join('、')} 共用；影响输入量 {[...new Set(usage?.inputs)].join('、') || '—'}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          {selected && baseline ? (
            <Card title="若当作独立量相加" subtitle="同一模型的相关系数置零">
              <div className="stack" style={{ gap: 8 }}>
                <div className="hstack">
                  <div className="stat" style={{ padding: 0 }}>
                    <div className="label small">独立假设的 u</div>
                    <div className="value sm tabular">
                      {formatValue(sdDisplay(baseline.sdIndependent, selected.def.unit), 3)}
                      <span className="unit">{unitLabel(selected.def.unit)}</span>
                    </div>
                  </div>
                  <span className="spacer" />
                  <Badge tone={baseline.inflatedRatio > 1.05 ? 'warn' : baseline.inflatedRatio < 0.95 ? 'info' : 'neutral'}>
                    {baseline.inflatedRatio >= 1 ? '高估' : '低估'} {Math.abs((baseline.inflatedRatio - 1) * 100).toFixed(0)}%
                  </Badge>
                </div>
                <div className="small secondary">
                  当前相关模型 u = {formatValue(sdDisplay(baseline.sdCorrelated, selected.def.unit), 3)} {unitLabel(selected.def.unit)}；独立相加为{' '}
                  {formatValue(sdDisplay(baseline.sdIndependent, selected.def.unit), 3)} {unitLabel(selected.def.unit)}。
                  {baseline.sdIndependent > baseline.sdCorrelated
                    ? ' 共享来源在结果中相互抵消时，独立相加会高估不确定度。'
                    : ' 共享来源在结果中同向叠加时，独立相加会低估不确定度。'}
                </div>
                <button type="button" className="btn sm" onClick={() => store.setView('compare')}>
                  打开改配对比 <Icon name="arrow" size={13} />
                </button>
              </div>
            </Card>
          ) : null}

          <Card title="检查项">
            {errors.length === 0 && warnings.length === 0 ? (
              <div className="small secondary">量纲、依赖环、分母与协方差均通过检查。</div>
            ) : (
              <ul className="mini-list">
                {[...errors, ...warnings].slice(0, 7).map((i, idx) => (
                  <li key={idx}>
                    <span className="dotmark" style={{ background: i.severity === 'error' ? 'var(--critical)' : 'var(--warning)' }} />
                    <div className="small">{i.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="抽样设置">
            <dl className="kv">
              <dt>种子</dt>
              <dd className="tabular">{project.settings.seed}</dd>
              <dt>抽样数</dt>
              <dd className="tabular">{project.settings.draws.toLocaleString('zh-CN')}</dd>
              <dt>调节</dt>
              <dd>
                <button type="button" className="btn sm" onClick={() => store.setView('results')}>
                  在结果页调整
                </button>
              </dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
