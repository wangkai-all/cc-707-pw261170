import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Callout, Card, ConfirmDialog, Empty, Field, Stat, TextField } from '../components/ui';
import { Icon } from '../components/Icon';
import {
  DISTRIBUTION_LABEL,
  type InputQuantity,
  type InputMode,
  type SourceDistribution,
} from '../core/types';
import { sourceStandardUncertainty, summarizeInput } from '../core/stats';
import { isValidSymbol, unitGroups, unitLabel } from '../core/units';
import { formatValue } from '../components/format';
import { TinyBar } from '../charts/TinyBar';

function newInput(existing: InputQuantity[]): InputQuantity {
  let idx = existing.length + 1;
  let symbol = `x${idx}`;
  while (existing.some((q) => q.symbol === symbol)) {
    idx += 1;
    symbol = `x${idx}`;
  }
  return {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    symbol,
    name: '新输入量',
    mode: 'series',
    unit: 'mm',
    readings: ['', '', '', '', '', ''],
    constantValue: '',
    constantUncertainty: '',
    constantDistribution: 'normal',
    resolution: '',
    instrumentId: null,
    includeResolution: true,
    note: '',
  };
}

export function InputsView() {
  const store = useStore();
  const { project, engine } = store;
  const [editingId, setEditingId] = useState<string | null>(project.inputs[0]?.id ?? null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const editing = project.inputs.find((q) => q.id === editingId) ?? project.inputs[0] ?? null;
  const model = editing ? engine.inputs.find((m) => m.input.id === editing.id) : null;
  const summary = editing ? summarizeInput(editing, project.instruments, project.sources) : null;

  const instrumentUse = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of project.inputs) {
      if (q.instrumentId) map.set(q.instrumentId, (map.get(q.instrumentId) ?? 0) + 1);
    }
    return map;
  }, [project.inputs]);

  const commit = (patch: Partial<InputQuantity>) => {
    if (!editing) return;
    const next = { ...editing, ...patch };
    if (patch.symbol !== undefined) {
      const clash =
        !isValidSymbol(next.symbol) ||
        project.inputs.some((q) => q.id !== editing.id && q.symbol === next.symbol) ||
        project.results.some((r) => r.symbol === next.symbol);
      if (clash) store.toast('符号不合法或已存在', 'warn');
    }
    store.updateProject((p) => ({
      ...p,
      inputs: p.inputs.map((q) => (q.id === editing.id ? next : q)),
    }));
  };

  const setReadings = (readings: string[]) => {
    if (!editing) return;
    const next = { ...editing, readings };
    store.updateProject(
      (p) => ({ ...p, inputs: p.inputs.map((q) => (q.id === editing.id ? next : q)) }),
      { silent: false },
    );
  };

  const add = () => {
    const q = newInput(project.inputs);
    store.updateProject((p) => ({ ...p, inputs: [...p.inputs, q] }));
    setEditingId(q.id);
  };

  const remove = (id: string) => {
    const usedBy = project.results.filter((r) => new RegExp(`\\b${project.inputs.find((q) => q.id === id)?.symbol}\\b`).test(r.formula));
    if (usedBy.length) {
      store.toast(`结果 ${usedBy.map((r) => r.symbol).join('、')} 仍引用该符号`, 'bad');
      return;
    }
    store.updateProject((p) => ({ ...p, inputs: p.inputs.filter((q) => q.id !== id) }));
    if (editingId === id) setEditingId(null);
    setDeleteId(null);
    store.toast('已删除输入量', 'warn');
  };

  const linkedSources = summary?.links ?? [];
  const totalOwn = summary?.ownDisplay ?? 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>输入量</h1>
          <p>
            录入原始读数或常量。每条测量的重复性误差各自独立（s/√n）；分辨率按 δ/√12 计入；
            若选择了仪表，其校准来源会作为共享潜变量加入——同一来源被多台仪表引用时只抽样一次。
          </p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={add}>
          <Icon name="plus" size={14} /> 新增输入量
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)' }}>
        <Card title="输入量清单" flush actions={<span className="small muted">{project.inputs.length} 项</span>}>
          {project.inputs.length === 0 ? (
            <Empty title="还没有输入量">每条测量对应一个输入量；常量（如证书值）也可作为输入量。</Empty>
          ) : (
            <div className="result-list">
              {project.inputs.map((q) => {
                const s = summarizeInput(q, project.instruments, project.sources);
                const inst = project.instruments.find((i) => i.id === q.instrumentId);
                const bad = s.errors.length > 0;
                return (
                  <button
                    key={q.id}
                    type="button"
                    className="result-row"
                    aria-current={editing?.id === q.id}
                    onClick={() => setEditingId(q.id)}
                  >
                    <span className="rr-sym">{q.symbol}</span>
                    <span className="rr-main">
                      <span className="rr-name">{q.name}</span>
                      <span className="rr-formula">
                        {inst ? inst.code : '无仪表'} · {unitLabel(q.unit)} · u={formatValue(s.ownDisplay, 3)}
                      </span>
                    </span>
                    {s.links.length > 0 ? <Badge tone="info">{s.links.length} 来源</Badge> : null}
                    {bad ? <Badge tone="bad">错误</Badge> : null}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {editing && summary ? (
          <div className="stack">
            <Card
              title={
                <span className="hstack" style={{ gap: 8 }}>
                  编辑输入量 <span className="chip mono">{editing.symbol}</span>
                  {model && model.uSI > 0 ? <Badge>u = {formatValue(summary.ownDisplay, 3)} {unitLabel(editing.unit)}（自身）</Badge> : null}
                </span>
              }
              actions={
                <button type="button" className="btn danger sm" onClick={() => setDeleteId(editing.id)}>
                  <Icon name="trash" size={13} /> 删除
                </button>
              }
            >
              <div className="stack" style={{ gap: 14 }}>
                <div className="form-grid c4">
                  <Field label="符号" hint="公式中引用，如 L、m、T">
                    <TextField
                      className="mono"
                      value={editing.symbol}
                      live={false}
                      onCommit={(v) => commit({ symbol: v })}
                    />
                  </Field>
                  <Field label="名称" span="span-2">
                    <TextField value={editing.name} onCommit={(v) => commit({ name: v })} />
                  </Field>
                  <Field label="单位">
                    <select value={editing.unit} onChange={(e) => commit({ unit: e.target.value })}>
                      {unitGroups().map((g) => (
                        <optgroup key={g.id} label={g.label}>
                          {g.units.map((x) => (
                            <option key={x.id} value={x.id}>{x.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="form-grid c4">
                  <Field label="数据类型">
                    <select value={editing.mode} onChange={(e) => commit({ mode: e.target.value as InputMode })}>
                      <option value="series">重复读数序列</option>
                      <option value="constant">常量（含 B 类）</option>
                    </select>
                  </Field>
                  <Field label="引用仪表" hint="决定哪些校准来源参与计算">
                    <select
                      value={editing.instrumentId ?? ''}
                      onChange={(e) => commit({ instrumentId: e.target.value || null })}
                    >
                      <option value="">不引用仪表</option>
                      {project.instruments.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.code} · {i.name}
                          {instrumentUse.get(i.id) ? `（${instrumentUse.get(i.id)} 项使用）` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="分辨率" hint="留空则从读数小数位推断">
                    <TextField
                      className="mono"
                      value={editing.resolution}
                      placeholder="例如 0.001"
                      onCommit={(v) => commit({ resolution: v })}
                    />
                  </Field>
                  <div className="field" style={{ justifyContent: 'flex-end' }}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={editing.includeResolution}
                        onChange={(e) => commit({ includeResolution: e.target.checked })}
                      />
                      计入分辨率不确定度 δ/√12
                    </label>
                  </div>
                </div>

                {editing.mode === 'series' ? (
                  <div>
                    <div className="hstack" style={{ marginBottom: 6 }}>
                      <span className="small secondary">原始读数（{unitLabel(editing.unit)}）</span>
                      <span className="spacer" />
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setReadings([...editing.readings, ''])}
                      >
                        <Icon name="plus" size={12} /> 添加一条
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setReadings([...editing.readings, editing.readings[editing.readings.length - 1] ?? ''])}
                      >
                        复制末条
                      </button>
                    </div>
                    <div className="readings-editor">
                      {editing.readings.map((r, i) => (
                        <div key={i} className="reading-chip">
                          <input
                            type="text"
                            inputMode="decimal"
                            className="mono"
                            aria-label={`第 ${i + 1} 条读数`}
                            value={r}
                            onChange={(e) => {
                              const arr = editing.readings.slice();
                              arr[i] = e.target.value;
                              setReadings(arr);
                            }}
                          />
                          <button
                            type="button"
                            aria-label="删除该读数"
                            onClick={() => setReadings(editing.readings.filter((_, k) => k !== i))}
                          >
                            <Icon name="x" size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="hstack small muted" style={{ marginTop: 6 }}>
                      <span>n = {summary.stats?.n ?? 0}</span>
                      <span>·</span>
                      <span>可从表格软件复制一列后粘贴</span>
                    </div>
                    <BulkPaste onApply={setReadings} />
                  </div>
                ) : (
                  <div className="form-grid c3">
                    <Field label="常量值">
                      <TextField
                        className="mono"
                        value={editing.constantValue}
                        onCommit={(v) => commit({ constantValue: v })}
                      />
                    </Field>
                    <Field label="B 类标准不确定度" hint="与输入量同单位">
                      <TextField
                        className="mono"
                        value={editing.constantUncertainty}
                        onCommit={(v) => commit({ constantUncertainty: v })}
                      />
                    </Field>
                    <Field label="分布形状" hint="仅影响蒙特卡洛抽样">
                      <select
                        value={editing.constantDistribution}
                        onChange={(e) => commit({ constantDistribution: e.target.value as SourceDistribution })}
                      >
                        {(Object.keys(DISTRIBUTION_LABEL) as SourceDistribution[]).map((d) => (
                          <option key={d} value={d}>{DISTRIBUTION_LABEL[d]}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}

                <Field label="备注">
                  <TextField value={editing.note} onCommit={(v) => commit({ note: v })} />
                </Field>

                {summary.errors.length > 0 || summary.warnings.length > 0 ? (
                  <div className="stack" style={{ gap: 6 }}>
                    {summary.errors.map((e, i) => (
                      <Callout key={`e${i}`} tone="error">{e}</Callout>
                    ))}
                    {summary.warnings.map((w, i) => (
                      <Callout key={`w${i}`} tone="warn">{w}</Callout>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card title="不确定度分解" subtitle="自身分量各自独立；来源分量与其它仪表共享">
              <div className="grid cols-3" style={{ gap: 2, marginBottom: 12 }}>
                <Stat label="重复性 u" value={summary.stats ? formatValue(summary.repeatabilityDisplay, 3) : '—'} unit={unitLabel(editing.unit)} sub={summary.stats ? `s/√n，n=${summary.stats.n}` : '无读数'} />
                <Stat label="分辨率 u" value={formatValue(summary.resolutionComponentDisplay, 3)} unit={unitLabel(editing.unit)} sub={`δ = ${formatValue(summary.resolutionDisplay, 4)}`} />
                <Stat
                  label={editing.mode === 'constant' ? 'B 类 u' : '自身合计'}
                  value={formatValue(editing.mode === 'constant' ? summary.constantUncertaintyDisplay : totalOwn, 3)}
                  unit={unitLabel(editing.unit)}
                  sub={editing.mode === 'constant' ? DISTRIBUTION_LABEL[editing.constantDistribution] : '平方和开根'}
                />
              </div>

              {summary.stats ? (
                <div className="small secondary" style={{ marginBottom: 10 }}>
                  均值 {formatValue(summary.stats.mean, 6)} {unitLabel(editing.unit)}；s = {formatValue(summary.stats.sd, 4)}；
                  极差 {formatValue(summary.stats.range, 4)}；范围 {formatValue(summary.stats.min, 6)} … {formatValue(summary.stats.max, 6)}
                </div>
              ) : null}

              <div className="hstack small secondary" style={{ marginBottom: 6 }}>
                <span>本输入量的分量（display 单位）</span>
                <span className="spacer" />
                <span className="muted">
                  合计 u = {formatValue(Math.sqrt(linkedSources.reduce((s, l) => s + (Number.isFinite(l.uSI) ? l.uSI ** 2 : 0), 0) + summary.ownDisplay ** 2), 4)}
                </span>
              </div>
              <TinyBar
                ariaLabel="输入量不确定度构成"
                unit={unitLabel(editing.unit)}
                rows={[
                  {
                    label: '重复性',
                    value: summary.repeatabilityDisplay,
                    color: 'var(--blue)',
                    detail: summary.stats ? `${summary.stats.n} 次读数` : '无读数',
                  },
                  {
                    label: '分辨率',
                    value: summary.resolutionComponentDisplay,
                    color: 'var(--violet)',
                    detail: `δ = ${formatValue(summary.resolutionDisplay, 4)}`,
                  },
                  ...(editing.mode === 'constant'
                    ? [
                        {
                          label: 'B 类',
                          value: summary.constantUncertaintyDisplay,
                          color: 'var(--aqua)',
                          detail: DISTRIBUTION_LABEL[editing.constantDistribution],
                        },
                      ]
                    : []),
                  ...linkedSources.map((l) => ({
                    label: l.source.code,
                    value: Number.isFinite(l.uSI) ? l.uSI : 0,
                    color: 'var(--orange)',
                    detail: `${l.source.name}${l.mode === 'relative' ? '（相对）' : ''}`,
                  })),
                ]}
              />

              {linkedSources.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div className="small secondary" style={{ marginBottom: 6 }}>引用的校准来源</div>
                  <div className="stack" style={{ gap: 6 }}>
                    {linkedSources.map((l) => {
                      const users = project.instruments.filter((i) => i.sourceLinks.some((x) => x.sourceId === l.source.id));
                      return (
                        <div key={l.source.id} className="hstack small" style={{ gap: 8 }}>
                          <span className="chip mono">{l.source.code}</span>
                          <span>{l.source.name}</span>
                          <span className="muted">
                            u = {l.error ? '无效' : `${formatValue(sourceStandardUncertainty(l.source).uDisplay, 4)} ${unitLabel(l.source.uncUnit)}`}
                            {l.mode === 'relative' ? ' · 相对' : ''}
                          </span>
                          <span className="spacer" />
                          {users.length > 1 ? (
                            <button type="button" className="chip link" onClick={() => store.setView('instruments')}>
                              与 {users.filter((i) => i.id !== editing.instrumentId).map((i) => i.code).join('、')} 共用
                            </button>
                          ) : (
                            <span className="muted">独用</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : editing.instrumentId ? (
                <div className="small muted" style={{ marginTop: 10 }}>
                  所选仪表没有引用校准来源，因此没有来源分量。
                </div>
              ) : null}
            </Card>
          </div>
        ) : (
          <Card>
            <Empty title="选择一个输入量">左侧列表中选择，或新增输入量。</Empty>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title="删除输入量"
        confirmLabel="删除"
        tone="danger"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => deleteId && remove(deleteId)}
      >
        删除后无法恢复（可用撤销）。仍被结果公式引用时不会被删除。
      </ConfirmDialog>
    </div>
  );
}

function BulkPaste({ onApply }: { onApply: (values: string[]) => void }) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const apply = () => {
    const vals = text
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!vals.length) {
      setHint('没有识别到数字');
      return;
    }
    onApply(vals);
    setText('');
    setHint(`已替换为 ${vals.length} 条读数`);
  };
  return (
    <details className="debug-details" style={{ marginTop: 8 }}>
      <summary>批量粘贴读数</summary>
      <div className="stack" style={{ gap: 6, marginTop: 6 }}>
        <textarea
          aria-label="批量粘贴读数"
          className="mono"
          style={{ minHeight: 54 }}
          placeholder="按行、空格或逗号分隔，例如：25.004 25.006 25.003"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(null);
          }}
        />
        <div className="hstack">
          <button type="button" className="btn sm" onClick={apply} disabled={!text.trim()}>
            替换读数
          </button>
          {hint ? <span className="small muted">{hint}</span> : null}
        </div>
      </div>
    </details>
  );
}
