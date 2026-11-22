import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Callout, Card, Empty } from '../components/ui';
import { Icon } from '../components/Icon';
import { HBarChart, IntervalChart } from '../charts/primitives';
import { contributionDisplay, formatValue, relativePercent, resultDisplay, sdDisplay } from '../components/format';
import { unitLabel } from '../core/units';
import { independenceBaseline } from '../core/baseline';
import { runEngine } from '../core/engine';
import { mergeSource, splitSharedSource } from '../data/operations';

/**
 * “改配与对比”：把共用标准件切成独立标准件（或反向合并），
 * 并在提交前用同一引擎做前后对照 —— 均值可能不变，不确定度必须变化。
 */
export function CompareView() {
  const store = useStore();
  const { project, engine, selectedResult } = store;

  const sharedSources = useMemo(() => {
    return project.sources
      .map((source) => {
        const users = project.instruments.filter((i) =>
          i.sourceLinks.some((l) => l.sourceId === source.id),
        );
        return { source, users };
      })
      .filter((x) => x.users.length > 1);
  }, [project]);

  const [sourceId, setSourceId] = useState<string | null>(sharedSources[0]?.source.id ?? null);
  const activeSource = sharedSources.find((x) => x.source.id === sourceId) ?? sharedSources[0] ?? null;
  const [detach, setDetach] = useState<string[]>([]);
  const [resultSymbol, setResultSymbol] = useState<string | null>(selectedResult);

  const detachSet = useMemo(() => {
    if (!activeSource) return new Set<string>();
    return new Set(detach.filter((id) => activeSource.users.some((u) => u.id === id)));
  }, [detach, activeSource]);

  const preview = useMemo(() => {
    if (!activeSource || detachSet.size === 0) return null;
    const split = splitSharedSource(project, activeSource.source.id, [...detachSet]);
    if (!split) return null;
    return { project: split.project, split };
  }, [project, activeSource, detachSet]);

  const afterEngine = useMemo(
    () => (preview ? runEngine(preview.project) : null),
    [preview],
  );

  const symbol = resultSymbol ?? engine.results[0]?.def.symbol ?? null;
  const before = symbol
    ? engine.results.find((r) => r.def.symbol === symbol) ?? engine.results[0]
    : engine.results[0];
  const after = symbol && afterEngine
    ? afterEngine.results.find((r) => r.def.symbol === symbol)
    : null;

  const beforeD = before ? resultDisplay(before) : null;
  const afterD = after ? resultDisplay(after) : null;
  const sdRatio =
    before && after && before.sdSI > 0 ? after.sdSI / before.sdSI : Number.NaN;

  const derivedSources = project.sources.filter((s) => s.originSourceId);

  const toggleDetach = (id: string) => {
    setDetach((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const applySplit = () => {
    if (!activeSource || detachSet.size === 0) return;
    if (detachSet.size >= activeSource.users.length) {
      store.toast('至少保留一台仪表使用原来源', 'warn');
      return;
    }
    const split = splitSharedSource(project, activeSource.source.id, [...detachSet]);
    if (!split) {
      store.toast('无法拆分：至少保留一台仪表使用原来源', 'warn');
      return;
    }
    store.replaceProject(split.project, `已把 ${split.detached.length} 台仪表改为独立来源 ${split.newCode}`);
    setDetach([]);
    setSourceId(split.newSourceId);
  };

  const applyMerge = (id: string) => {
    const merged = mergeSource(project, id);
    if (!merged) return;
    store.replaceProject(merged, '已合并回原来源');
  };

  const baseline = before ? independenceBaseline(engine, before.def.symbol) : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>改配与对比</h1>
          <p>
            用户把两台仪表从“共用同一标准件”改为“各自使用独立标准件”时，证书数值可以完全相同，
            结果均值也因此不变；但共享随机变量消失，协方差项随之变化，不确定度区间必须反映这一点。
            下面先在浏览器内预览，再决定是否应用。
          </p>
        </div>
      </div>

      {project.sources.length === 0 || project.instruments.length === 0 ? (
        <Card>
          <Empty title="模型还不完整">至少需要一个校准来源和两台仪表才能演示“共用 → 独立”的改配。</Empty>
        </Card>
      ) : sharedSources.length === 0 && derivedSources.length === 0 ? (
        <Card>
          <Empty title="当前没有共用来源">
            所有来源都只被一台仪表引用，因此没有共享相关项。若要在两台仪表间制造相关，
            请到“仪表”页让它们引用同一个来源编号。
          </Empty>
        </Card>
      ) : null}

      {sharedSources.length > 0 ? (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 380px) minmax(0, 1fr)' }}>
          <div className="stack">
            <Card title="① 选择共用来源" subtitle="只有被两台及以上仪表引用的来源才能拆分">
              <div className="stack" style={{ gap: 8 }}>
                {sharedSources.map(({ source, users }) => (
                  <button
                    key={source.id}
                    type="button"
                    className="result-row"
                    aria-current={activeSource?.source.id === source.id}
                    onClick={() => {
                      setSourceId(source.id);
                      setDetach([]);
                    }}
                  >
                    <span className="rr-sym mono" style={{ minWidth: 78 }}>{source.code}</span>
                    <span className="rr-main">
                      <span className="rr-name">{source.name}</span>
                      <span className="rr-formula">被 {users.map((u) => u.code).join('、')} 共用</span>
                    </span>
                    <Badge tone="info">{users.length} 台</Badge>
                  </button>
                ))}
              </div>
            </Card>

            {activeSource ? (
              <Card title="② 选择改为独立标准件的仪表" subtitle={`来源 ${activeSource.source.code} 至少保留一台仪表`}>
                <div className="stack" style={{ gap: 10 }}>
                  {activeSource.users.map((inst) => {
                    const checked = detachSet.has(inst.id);
                    const blocked = !checked && detachSet.size >= activeSource.users.length - 1;
                    const inputs = project.inputs.filter((q) => q.instrumentId === inst.id);
                    return (
                      <label
                        key={inst.id}
                        className="hstack"
                        style={{
                          gap: 8,
                          padding: '8px 10px',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          background: checked ? 'color-mix(in srgb, var(--orange) 8%, transparent)' : 'var(--surface-2)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDetach(inst.id)}
                          disabled={blocked && !checked}
                        />
                        <span className="mono small">{inst.code}</span>
                        <span className="small">{inst.name}</span>
                        <span className="spacer" />
                        <span className="tiny muted">
                          {inputs.map((q) => q.symbol).join('、') || '无关输入量'}
                        </span>
                      </label>
                    );
                  })}
                  <div className="small muted">
                    勾选的仪表会改挂到编号为 <span className="mono">{activeSource.source.code}-D01</span> 的副本上：
                    证书能力与中心值完全相同，但不再与其余仪表共享随机变量。
                  </div>
                  <div className="hstack">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={detachSet.size === 0}
                      onClick={applySplit}
                    >
                      <Icon name="split" size={13} /> 应用改配
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={detachSet.size === 0}
                      onClick={() => setDetach([])}
                    >
                      清除选择
                    </button>
                    <span className="spacer" />
                    <span className="tiny muted">应用后可撤销</span>
                  </div>
                </div>
              </Card>
            ) : null}

            {derivedSources.length > 0 ? (
              <Card title="③ 已拆分的独立来源" subtitle="可合并回原来源">
                <div className="stack" style={{ gap: 8 }}>
                  {derivedSources.map((s) => {
                    const origin = project.sources.find((x) => x.id === s.originSourceId);
                    const users = project.instruments.filter((i) =>
                      i.sourceLinks.some((l) => l.sourceId === s.id),
                    );
                    return (
                      <div key={s.id} className="hstack" style={{ gap: 8 }}>
                        <span className="chip mono">{s.code}</span>
                        <span className="small">{users.map((u) => u.code).join('、') || '无仪表'}</span>
                        <span className="spacer" />
                        <Badge>源自 {origin?.code ?? '?'}</Badge>
                        <button type="button" className="btn sm" onClick={() => applyMerge(s.id)}>
                          <Icon name="merge" size={12} /> 合并
                        </button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : null}
          </div>

          <div className="stack">
            <Card
              title="预览：改配前后"
              subtitle="使用同一引擎、同一随机种子；未应用前不会改动项目"
              actions={
                <select
                  aria-label="选择结果"
                  value={symbol ?? ''}
                  onChange={(e) => setResultSymbol(e.target.value)}
                  style={{ width: 'auto' }}
                >
                  {engine.results.map((r) => (
                    <option key={r.def.id} value={r.def.symbol}>{r.def.symbol} · {r.def.name}</option>
                  ))}
                </select>
              }
            >
              {!preview || !before || !after || !beforeD || !afterD ? (
                <Empty title="先勾选要改为独立标准件的仪表">
                  选中后这里会显示改配前后的结果均值、标准不确定度与 95% 区间。
                </Empty>
              ) : !before.ok || !after.ok ? (
                <Callout tone="error" title="无法对比：模型存在错误">
                  当前或改配后的模型未通过检查（公式、量纲、分母或协方差）。
                  请先修正错误，再预览改配效果。
                </Callout>
              ) : (
                <div className="stack" style={{ gap: 14 }}>
                  <div className="grid cols-2" style={{ gap: 10 }}>
                    <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                      <div className="hstack small secondary">
                        <span>改配前</span>
                        <span className="spacer" />
                        <Badge tone="info">共用 {activeSource?.source.code}</Badge>
                      </div>
                      <div className="tabular" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>
                        {formatValue(beforeD.value, 6)}
                        <span className="muted small"> {beforeD.unit}</span>
                      </div>
                      <div className="small secondary">
                        u = {formatValue(beforeD.u, 4)} · 相对 {relativePercent(beforeD.u, beforeD.value)}
                      </div>
                      <div className="tiny muted">
                        95%: {formatValue(beforeD.value - 2 * beforeD.u, 5)} … {formatValue(beforeD.value + 2 * beforeD.u, 5)}
                      </div>
                    </div>
                    <div
                      style={{
                        padding: 12,
                        border: '1px solid color-mix(in srgb, var(--orange) 45%, transparent)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'color-mix(in srgb, var(--orange) 5%, transparent)',
                      }}
                    >
                      <div className="hstack small secondary">
                        <span>改配后</span>
                        <span className="spacer" />
                        <Badge tone="warn">各自独立</Badge>
                      </div>
                      <div className="tabular" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>
                        {formatValue(afterD.value, 6)}
                        <span className="muted small"> {afterD.unit}</span>
                      </div>
                      <div className="small secondary">
                        u = {formatValue(afterD.u, 4)} · 相对 {relativePercent(afterD.u, afterD.value)}
                      </div>
                      <div className="tiny muted">
                        95%: {formatValue(afterD.value - 2 * afterD.u, 5)} … {formatValue(afterD.value + 2 * afterD.u, 5)}
                      </div>
                    </div>
                  </div>

                  <Callout tone={Math.abs(afterD.u / Math.max(1e-300, beforeD.u) - 1) < 0.005 ? 'warn' : 'info'}>
                    <div className="small">
                      <strong>均值变化：</strong>
                      {formatValue(afterD.value - beforeD.value, 3)} {afterD.unit}（
                      {Math.abs(afterD.value - beforeD.value) <= Math.abs(beforeD.value) * 1e-9
                        ? '完全不变 —— 证书数值与读数都未改变'
                        : '因数值精度或单位换算产生的微小变化'}
                      ）。
                      <strong style={{ marginLeft: 8 }}>标准不确定度：</strong>
                      {formatValue(beforeD.u, 4)} → {formatValue(afterD.u, 4)} {afterD.unit}
                      {Number.isFinite(sdRatio)
                        ? `（${sdRatio >= 1 ? '变为' : '降为'}原来的 ${(sdRatio * 100).toFixed(1)}%）`
                        : ''}
                      。
                      {Math.abs(sdRatio - 1) < 1e-6
                        ? ' 该结果对这条共享来源不敏感，换一个结果（如平均值或比值）观察差异。'
                        : ' 共享随机变量消失后，协方差项相应改变，区间必须随之变化。'}
                    </div>
                  </Callout>

                  <div>
                    <div className="small secondary" style={{ marginBottom: 4 }}>95% 区间对照</div>
                    <IntervalChart
                      ariaLabel="改配前后区间对照"
                      unit={afterD.unit}
                      rows={[
                        {
                          label: `改配前（共用）`,
                          lo: beforeD.value - 2 * beforeD.u,
                          hi: beforeD.value + 2 * beforeD.u,
                          center: beforeD.value,
                          color: 'var(--blue)',
                        },
                        {
                          label: '改配后（独立）',
                          lo: afterD.value - 2 * afterD.u,
                          hi: afterD.value + 2 * afterD.u,
                          center: afterD.value,
                          color: 'var(--orange)',
                        },
                      ]}
                      format={(v) => formatValue(v, 7)}
                      height={140}
                    />
                  </div>

                  <div>
                    <div className="small secondary" style={{ marginBottom: 4 }}>各来源贡献对照（√方差）</div>
                    <HBarChart
                      ariaLabel="改配前后来源贡献"
                      unit={afterD.unit}
                      data={[
                        ...before.contributions.slice(0, 6).map((c, i) => ({
                          key: `b${i}`,
                          label: `改配前 · ${c.label}`,
                          value: contributionDisplay(c.variance, before.def.unit),
                          color: 'var(--blue)',
                          secondary: `${(c.share * 100).toFixed(0)}%`,
                        })),
                        ...after.contributions.slice(0, 6).map((c, i) => ({
                          key: `a${i}`,
                          label: `改配后 · ${c.label}`,
                          value: contributionDisplay(c.variance, before.def.unit),
                          color: 'var(--orange)',
                          secondary: `${(c.share * 100).toFixed(0)}%`,
                        })),
                      ]}
                      formatValue={(v) => formatValue(v, 3)}
                    />
                  </div>
                </div>
              )}
            </Card>

            {before && baseline && before.ok ? (
              <Card title="对照：如果所有输入量都当独立量相加" subtitle="同一模型的对角化基线">
                <div className="grid cols-3" style={{ gap: 2 }}>
                  <div className="stat">
                    <div className="label">当前（含相关）</div>
                    <div className="value sm tabular">{formatValue(sdDisplay(baseline.sdCorrelated, before.def.unit), 4)}<span className="unit">{unitLabel(before.def.unit)}</span></div>
                  </div>
                  <div className="stat">
                    <div className="label">独立相加</div>
                    <div className="value sm tabular">{formatValue(sdDisplay(baseline.sdIndependent, before.def.unit), 4)}<span className="unit">{unitLabel(before.def.unit)}</span></div>
                  </div>
                  <div className="stat">
                    <div className="label">独立/相关</div>
                    <div className="value sm tabular">
                      {Number.isFinite(baseline.inflatedRatio) ? baseline.inflatedRatio.toFixed(3) : '—'}
                    </div>
                  </div>
                </div>
                <div className="small secondary" style={{ marginTop: 8 }}>
                  比值 &gt; 1 表示忽略共享来源会高估不确定度（共享偏差在结果中抵消）；
                  比值 &lt; 1 表示忽略相关会低估（共享偏差在结果中同向叠加）。
                  结果 {before.def.symbol} 按 {unitLabel(before.def.unit)} 显示。
                </div>
              </Card>
            ) : null}

            {engine.blocked && before ? (
              <Callout tone="error" title="当前项目被阻断，无法可靠对比">
                先修正错误（协方差矩阵或公式），再来预览改配效果。
              </Callout>
            ) : null}
          </div>
        </div>
      ) : null}

      <Card title="这一页验证的性质">
        <div className="grid cols-3" style={{ gap: 18 }}>
          <div className="small secondary">
            <strong>均值不变</strong>
            <div style={{ marginTop: 4 }}>
              拆分只改“随机变量归属”，不改证书中心值、读数或公式，因此结果均值理论上完全不变。
            </div>
          </div>
          <div className="small secondary">
            <strong>区间必须改变</strong>
            <div style={{ marginTop: 4 }}>
              相关项从 Σ c<sub>i</sub>c<sub>j</sub>u<sub>S</sub>² 变为 0。对和式结果，独立后不确定度下降；
              对差值/比值，独立后上升。
            </div>
          </div>
          <div className="small secondary">
            <strong>可逆</strong>
            <div style={{ marginTop: 4 }}>
              拆分出的来源记录了指回原来源的编号，可一键合并；所有操作都进入撤销历史。
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
