import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Callout, Card, ConfirmDialog, Empty, Field, TextField } from '../components/ui';
import { Icon } from '../components/Icon';
import { sourceUncertaintySI } from '../core/engine';
import {
  BASIS_LABEL,
  DISTRIBUTION_LABEL,
  type CalibrationSource,
  type SourceBasis,
  type SourceDistribution,
} from '../core/types';
import { unitGroups, unitLabel } from '../core/units';
import { formatValue } from '../components/format';

function newSource(existing: CalibrationSource[]): CalibrationSource {
  let n = 1;
  let code = 'SR-001';
  while (existing.some((s) => s.code === code)) {
    n += 1;
    code = `SR-${String(n).padStart(3, '0')}`;
  }
  return {
    id: `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    code,
    name: '新校准来源',
    value: '',
    valueUnit: 'mm',
    distribution: 'normal',
    basis: 'expanded',
    magnitude: '',
    uncUnit: 'mm',
    coverageK: '2',
    lab: '',
    certificate: '',
    validUntil: '',
    note: '',
  };
}

export function SourcesView() {
  const store = useStore();
  const { project } = store;
  const [editingId, setEditingId] = useState<string | null>(project.sources[0]?.id ?? null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const editing = project.sources.find((s) => s.id === editingId) ?? project.sources[0] ?? null;

  const usage = useMemo(() => {
    const map = new Map<string, { instruments: { id: string; code: string }[]; inputs: string[] }>();
    for (const s of project.sources) map.set(s.id, { instruments: [], inputs: [] });
    for (const inst of project.instruments) {
      for (const l of inst.sourceLinks) {
        map.get(l.sourceId)?.instruments.push({ id: inst.id, code: inst.code });
      }
    }
    for (const q of project.inputs) {
      const inst = project.instruments.find((i) => i.id === q.instrumentId);
      if (!inst) continue;
      for (const l of inst.sourceLinks) map.get(l.sourceId)?.inputs.push(q.symbol);
    }
    return map;
  }, [project]);

  const commit = (patch: Partial<CalibrationSource>) => {
    if (!editing) return;
    store.updateProject((p) => ({
      ...p,
      sources: p.sources.map((s) => (s.id === editing.id ? { ...s, ...patch } : s)),
    }));
  };

  const add = () => {
    const src = newSource(project.sources);
    store.updateProject((p) => ({ ...p, sources: [...p.sources, src] }));
    setEditingId(src.id);
  };

  const remove = (id: string) => {
    const used = usage.get(id);
    if (used && (used.instruments.length > 0 || used.inputs.length > 0)) {
      store.toast('该来源仍被仪表引用，请先解除引用', 'bad');
      return;
    }
    store.updateProject((p) => ({ ...p, sources: p.sources.filter((s) => s.id !== id) }));
    if (editingId === id) setEditingId(null);
    setDeleteId(null);
    store.toast('已删除来源', 'warn');
  };

  const u = editing ? sourceUncertaintySI(editing) : null;
  const derived = project.sources.filter((s) => s.originSourceId);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>校准来源</h1>
          <p>
            每个来源拥有独立编号。同一来源被多台仪表引用时，所有引用共享同一个随机变量——这就是相关性的来源。
            扩展不确定度按 U/k 折算，半宽按分布除以 √3 或 √6。
          </p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={add}>
          <Icon name="plus" size={14} /> 新增来源
        </button>
      </div>

      {derived.length > 0 ? (
        <Callout tone="info" title="存在由共用来源拆分出的独立副本">
          {derived.map((s) => `${s.code}（源自 ${project.sources.find((x) => x.id === s.originSourceId)?.code ?? '?'}）`).join('、')}
          。它们数值相同但不再与其余仪表共享随机变量。
        </Callout>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', marginTop: 14 }}>
        <Card title="来源清单" flush actions={<span className="small muted">{project.sources.length} 项</span>}>
          {project.sources.length === 0 ? (
            <Empty title="还没有校准来源" action={<button type="button" className="btn sm" onClick={add}>新增来源</button>}>
              证书、标准器或温度校正值都从这里登记。
            </Empty>
          ) : (
            <div className="result-list">
              {project.sources.map((s) => {
                const used = usage.get(s.id);
                const comp = sourceUncertaintySI(s);
                const shared = (used?.instruments.length ?? 0) > 1;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="result-row"
                    aria-current={editing?.id === s.id}
                    onClick={() => setEditingId(s.id)}
                  >
                    <span className="rr-sym mono" style={{ minWidth: 78 }}>{s.code}</span>
                    <span className="rr-main">
                      <span className="rr-name">{s.name}</span>
                      <span className="rr-sub" style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
                        u = {comp.error ? '无效' : `${formatValue(comp.uDisplay, 3)} ${unitLabel(s.uncUnit)}`}
                        {' · '}
                        {used?.instruments.length ?? 0} 台仪表
                      </span>
                    </span>
                    {shared ? <Badge tone="info">共用</Badge> : null}
                    {comp.error ? <Badge tone="bad">错误</Badge> : null}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {editing ? (
          <Card
            title={
              <span className="hstack" style={{ gap: 8 }}>
                编辑来源 <span className="chip mono">{editing.code}</span>
                {usage.get(editing.id)?.instruments.length === 1 ? <Badge>单台使用</Badge> : null}
                {(usage.get(editing.id)?.instruments.length ?? 0) > 1 ? <Badge tone="info">被多台共用</Badge> : null}
              </span>
            }
            actions={
              <button type="button" className="btn danger sm" onClick={() => setDeleteId(editing.id)}>
                <Icon name="trash" size={13} /> 删除
              </button>
            }
          >
            <div className="stack" style={{ gap: 14 }}>
              <div className="form-grid c3">
                <Field label="来源编号" hint="例如 SR-001；用于溯源与引用">
                  <TextField
                    className="mono"
                    value={editing.code}
                    live={false}
                    onCommit={(v) => commit({ code: v })}
                    aria-label="来源编号"
                  />
                </Field>
                <Field label="名称" span="span-2">
                  <TextField value={editing.name} onCommit={(v) => commit({ name: v })} />
                </Field>
              </div>

              <div className="form-grid c4">
                <Field label="证书赋值">
                  <TextField className="mono" value={editing.value} onCommit={(v) => commit({ value: v })} placeholder="例如 25.0002" />
                </Field>
                <Field label="赋值单位">
                  <select value={editing.valueUnit} onChange={(e) => commit({ valueUnit: e.target.value })}>
                    {unitGroups().map((g) => (
                      <optgroup key={g.id} label={g.label}>
                        {g.units.map((x) => (
                          <option key={x.id} value={x.id}>{x.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field label="不确定度形态" hint={BASIS_LABEL[editing.basis]}>
                  <select value={editing.basis} onChange={(e) => commit({ basis: e.target.value as SourceBasis })}>
                    {(['expanded', 'standard', 'halfwidth'] as SourceBasis[]).map((b) => (
                      <option key={b} value={b}>{BASIS_LABEL[b]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="分布形状" hint="决定 u 的除数和 MC 抽样">
                  <select value={editing.distribution} onChange={(e) => commit({ distribution: e.target.value as SourceDistribution })}>
                    {(Object.keys(DISTRIBUTION_LABEL) as SourceDistribution[]).map((d) => (
                      <option key={d} value={d}>{DISTRIBUTION_LABEL[d]}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="form-grid c4">
                <Field label={editing.basis === 'expanded' ? '扩展不确定度 U' : editing.basis === 'halfwidth' ? '半宽 a' : '标准不确定度 u'}>
                  <TextField
                    className="mono"
                    value={editing.magnitude}
                    onCommit={(v) => commit({ magnitude: v })}
                    placeholder="例如 0.003"
                  />
                </Field>
                <Field label="不确定度单位">
                  <select value={editing.uncUnit} onChange={(e) => commit({ uncUnit: e.target.value })}>
                    {unitGroups().map((g) => (
                      <optgroup key={g.id} label={g.label}>
                        {g.units.map((x) => (
                          <option key={x.id} value={x.id}>{x.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field label="包含因子 k" hint={editing.basis === 'expanded' ? '通常为 2' : '仅扩展不确定度使用'}>
                  <TextField
                    className="mono"
                    value={editing.coverageK}
                    disabled={editing.basis !== 'expanded'}
                    onCommit={(v) => commit({ coverageK: v })}
                  />
                </Field>
                <Field label="有效期">
                  <input type="date" value={editing.validUntil} onChange={(e) => commit({ validUntil: e.target.value })} />
                </Field>
              </div>

              <div className="form-grid c3">
                <Field label="实验室">
                  <TextField value={editing.lab} onCommit={(v) => commit({ lab: v })} />
                </Field>
                <Field label="证书编号">
                  <TextField className="mono" value={editing.certificate} onCommit={(v) => commit({ certificate: v })} />
                </Field>
                <Field label="备注">
                  <TextField value={editing.note} onCommit={(v) => commit({ note: v })} />
                </Field>
              </div>

              <div className={`callout ${u?.error ? 'error' : 'info'}`}>
                <span className="ico"><Icon name={u?.error ? 'x' : 'info'} size={15} /></span>
                <div>
                  {u?.error ? (
                    <strong>{u.error}</strong>
                  ) : (
                    <>
                      <strong>
                        标准不确定度 u = {formatValue(u!.uDisplay, 5)} {unitLabel(editing.uncUnit)}
                      </strong>
                      <div className="small" style={{ marginTop: 3 }}>
                        {editing.basis === 'expanded'
                          ? `U = ${editing.magnitude || '—'} / k = ${editing.coverageK || '2'}`
                          : editing.basis === 'halfwidth'
                            ? `a = ${editing.magnitude || '—'}，分布除数 ${
                                editing.distribution === 'rectangular' ? '√3' : editing.distribution === 'triangular' ? '√6' : '1（正态无半宽定义）'
                              }`
                            : '证书直接给出标准不确定度'}
                        {editing.distribution !== 'normal' && editing.basis !== 'standard' ? `（${DISTRIBUTION_LABEL[editing.distribution]}分布）` : ''}
                        。折算到 SI：{formatValue(u!.uSI, 4)}。
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div>
                <div className="hstack small secondary" style={{ marginBottom: 6 }}>
                  <span>引用情况</span>
                  <span className="spacer" />
                  <span className="muted">被多台引用时，相关项会出现在“相关与协方差”</span>
                </div>
                {(usage.get(editing.id)?.instruments.length ?? 0) === 0 ? (
                  <div className="small muted">尚无仪表引用。</div>
                ) : (
                  <div className="hstack">
                    {usage.get(editing.id)!.instruments.map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        className="chip link mono"
                        onClick={() => store.setView('instruments')}
                        title="前往仪表页"
                      >
                        {i.code}
                      </button>
                    ))}
                    <span className="small muted">
                      影响输入量：{[...new Set(usage.get(editing.id)!.inputs)].join('、') || '—'}
                    </span>
                  </div>
                )}
              </div>

              {editing.originSourceId ? (
                <Callout tone="warn" title="这是拆分出的独立副本">
                  数值与原来源相同，但不再与其它仪表共享随机变量。可在“改配与对比”里合并回去。
                </Callout>
              ) : null}
            </div>
          </Card>
        ) : (
          <Card>
            <Empty title="选择一个来源进行编辑">左侧列表中选择，或新增一个校准来源。</Empty>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title="删除校准来源"
        confirmLabel="删除"
        tone="danger"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => deleteId && remove(deleteId)}
      >
        删除后无法恢复（可用撤销）。仍被仪表引用的来源不会被删除。
      </ConfirmDialog>
    </div>
  );
}
