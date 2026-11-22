import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Callout, Card, ConfirmDialog, Empty, Field, TextField } from '../components/ui';
import { Icon } from '../components/Icon';
import {
  INSTRUMENT_KIND_LABEL,
  LINK_MODE_LABEL,
  type Instrument,
  type InstrumentKind,
  type LinkMode,
} from '../core/types';
import { sourceUncertaintySI } from '../core/engine';
import { formatValue } from '../components/format';
import { unitLabel } from '../core/units';

function newInstrument(existing: Instrument[]): Instrument {
  let n = 1;
  let code = 'INS-001';
  while (existing.some((i) => i.code === code)) {
    n += 1;
    code = `INS-${String(n).padStart(3, '0')}`;
  }
  return {
    id: `ins-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    code,
    name: '新仪表',
    kind: 'caliper',
    serial: '',
    sourceLinks: [],
    note: '',
  };
}

export function InstrumentsView() {
  const store = useStore();
  const { project, engine } = store;
  const [editingId, setEditingId] = useState<string | null>(project.instruments[0]?.id ?? null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const editing = project.instruments.find((i) => i.id === editingId) ?? project.instruments[0] ?? null;

  /** 来源 → 使用它的仪表（判断共用） */
  const sourceUsers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const inst of project.instruments) {
      for (const l of inst.sourceLinks) {
        const arr = map.get(l.sourceId) ?? [];
        arr.push(inst.code);
        map.set(l.sourceId, arr);
      }
    }
    return map;
  }, [project.instruments]);

  const inputUsage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const q of project.inputs) {
      if (!q.instrumentId) continue;
      const arr = map.get(q.instrumentId) ?? [];
      arr.push(q.symbol);
      map.set(q.instrumentId, arr);
    }
    return map;
  }, [project.inputs]);

  const commit = (patch: Partial<Instrument>) => {
    if (!editing) return;
    store.updateProject((p) => ({
      ...p,
      instruments: p.instruments.map((i) => (i.id === editing.id ? { ...i, ...patch } : i)),
    }));
  };

  const add = () => {
    const inst = newInstrument(project.instruments);
    store.updateProject((p) => ({ ...p, instruments: [...p.instruments, inst] }));
    setEditingId(inst.id);
  };

  const remove = (id: string) => {
    if ((inputUsage.get(id)?.length ?? 0) > 0) {
      store.toast('仍有输入量使用该仪表，请先改绑输入量', 'bad');
      return;
    }
    store.updateProject((p) => ({ ...p, instruments: p.instruments.filter((i) => i.id !== id) }));
    if (editingId === id) setEditingId(null);
    setDeleteId(null);
    store.toast('已删除仪表', 'warn');
  };

  const addLink = () => {
    if (!editing) return;
    const unused = project.sources.find((s) => !editing.sourceLinks.some((l) => l.sourceId === s.id));
    if (!unused) {
      if (project.sources.length === 0) store.toast('还没有校准来源，请先在“校准来源”登记', 'warn');
      else store.toast('该仪表已引用全部来源', 'warn');
      return;
    }
    commit({ sourceLinks: [...editing.sourceLinks, { sourceId: unused.id, mode: 'additive' }] });
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>仪表</h1>
          <p>
            仪表引用校准来源。引用方式是“加性”时来源的不确定度按同量纲偏差直接叠加；是“相对”时按读数的比例叠加。
            多台仪表引用同一来源，它们的不确定度就会相关——这是建模中共享随机变量的唯一入口。
          </p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={add}>
          <Icon name="plus" size={14} /> 新增仪表
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 330px) minmax(0, 1fr)' }}>
        <Card title="仪表清单" flush actions={<span className="small muted">{project.instruments.length} 台</span>}>
          {project.instruments.length === 0 ? (
            <Empty title="还没有仪表">先在“校准来源”登记证书，再回到这里建立仪表。</Empty>
          ) : (
            <div className="result-list">
              {project.instruments.map((inst) => {
                const shared = inst.sourceLinks.some(
                  (l) => (sourceUsers.get(l.sourceId)?.length ?? 0) > 1,
                );
                const codes = inst.sourceLinks
                  .map((l) => project.sources.find((s) => s.id === l.sourceId)?.code)
                  .filter(Boolean);
                return (
                  <button
                    key={inst.id}
                    type="button"
                    className="result-row"
                    aria-current={editing?.id === inst.id}
                    onClick={() => setEditingId(inst.id)}
                  >
                    <span className="rr-sym mono" style={{ minWidth: 92 }}>{inst.code}</span>
                    <span className="rr-main">
                      <span className="rr-name">{inst.name}</span>
                      <span className="rr-formula">
                        {INSTRUMENT_KIND_LABEL[inst.kind]}
                        {codes.length ? ` · ${codes.join(' + ')}` : ' · 未引用来源'}
                      </span>
                    </span>
                    {shared ? <Badge tone="info">来源共用</Badge> : null}
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
                编辑仪表 <span className="chip mono">{editing.code}</span>
              </span>
            }
            actions={
              <button type="button" className="btn danger sm" onClick={() => setDeleteId(editing.id)}>
                <Icon name="trash" size={13} /> 删除
              </button>
            }
          >
            <div className="stack" style={{ gap: 16 }}>
              <div className="form-grid c4">
                <Field label="仪表编号">
                  <TextField className="mono" value={editing.code}
                  live={false} onCommit={(v) => commit({ code: v })} />
                </Field>
                <Field label="名称" span="span-2">
                  <TextField value={editing.name} onCommit={(v) => commit({ name: v })} />
                </Field>
                <Field label="类型">
                  <select value={editing.kind} onChange={(e) => commit({ kind: e.target.value as InstrumentKind })}>
                    {(Object.keys(INSTRUMENT_KIND_LABEL) as InstrumentKind[]).map((k) => (
                      <option key={k} value={k}>{INSTRUMENT_KIND_LABEL[k]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="序列号" hint="虚构编号即可">
                  <TextField className="mono" value={editing.serial} onCommit={(v) => commit({ serial: v })} />
                </Field>
                <Field label="使用该仪表的输入量" span="span-3">
                  <div className="hstack" style={{ minHeight: 32 }}>
                    {(inputUsage.get(editing.id) ?? []).length === 0 ? (
                      <span className="small muted">暂无输入量引用</span>
                    ) : (
                      (inputUsage.get(editing.id) ?? []).map((sym) => (
                        <span key={sym} className="chip mono">{sym}</span>
                      ))
                    )}
                  </div>
                </Field>
              </div>

              <div>
                <div className="hstack" style={{ marginBottom: 8 }}>
                  <h3>校准来源链接</h3>
                  <span className="spacer" />
                  <button type="button" className="btn sm" onClick={addLink}>
                    <Icon name="plus" size={12} /> 添加引用
                  </button>
                </div>
                {editing.sourceLinks.length === 0 ? (
                  <div className="callout info">
                    <span className="ico"><Icon name="info" size={15} /></span>
                    <div className="small">该仪表没有引用任何校准来源，其不确定度只包含重复性、分辨率与自身 B 类分量。</div>
                  </div>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    {editing.sourceLinks.map((link, idx) => {
                      const source = project.sources.find((s) => s.id === link.sourceId);
                      const users = sourceUsers.get(link.sourceId) ?? [];
                      const comp = source ? sourceUncertaintySI(source) : null;
                      const shared = users.length > 1;
                      return (
                        <div
                          key={idx}
                          className="hstack"
                          style={{
                            gap: 10,
                            padding: '9px 11px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--surface-2)',
                          }}
                        >
                          <select
                            aria-label="校准来源"
                            value={link.sourceId}
                            style={{ width: 'auto', minWidth: 190 }}
                            onChange={(e) => {
                              const next = editing.sourceLinks.map((l, i) =>
                                i === idx ? { ...l, sourceId: e.target.value } : l,
                              );
                              commit({ sourceLinks: next });
                            }}
                          >
                            {project.sources.map((s) => (
                              <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                            ))}
                          </select>
                          <select
                            aria-label="引用方式"
                            value={link.mode}
                            style={{ width: 'auto' }}
                            onChange={(e) => {
                              const next = editing.sourceLinks.map((l, i) =>
                                i === idx ? { ...l, mode: e.target.value as LinkMode } : l,
                              );
                              commit({ sourceLinks: next });
                            }}
                          >
                            {(['additive', 'relative'] as LinkMode[]).map((m) => (
                              <option key={m} value={m}>{LINK_MODE_LABEL[m]}</option>
                            ))}
                          </select>
                          <span className="small secondary">
                            {comp && !comp.error
                              ? `u = ${formatValue(comp.uDisplay, 4)} ${unitLabel(source!.uncUnit)}`
                              : comp?.error ?? '—'}
                          </span>
                          <span className="spacer" />
                          {shared ? (
                            <Badge tone="info">与 {users.filter((u) => u !== editing.code).join('、')} 共用</Badge>
                          ) : (
                            <Badge>独用</Badge>
                          )}
                          <button
                            type="button"
                            className="btn ghost sm"
                            aria-label="移除引用"
                            onClick={() => commit({ sourceLinks: editing.sourceLinks.filter((_, i) => i !== idx) })}
                          >
                            <Icon name="x" size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Field label="备注">
                <TextField value={editing.note} onCommit={(v) => commit({ note: v })} />
              </Field>

              {editing.sourceLinks.some((l) => (sourceUsers.get(l.sourceId)?.length ?? 0) > 1) ? (
                <Callout tone="info" title="这台仪表与其它仪表共享校准来源">
                  共享来源只生成一个随机变量：在结果中，它带来的偏差会同时出现在这些输入量上。
                  若要改为独立标准件，请到“改配与对比”拆分来源。
                </Callout>
              ) : null}

              <div>
                <div className="hstack small secondary" style={{ marginBottom: 6 }}>
                  <span>相关影响（当前模型的输入量相关系数）</span>
                  <span className="spacer" />
                  <button type="button" className="btn ghost sm" onClick={() => store.setView('correlation')}>
                    查看相关矩阵 <Icon name="arrow" size={12} />
                  </button>
                </div>
                <ul className="mini-list">
                  {engine.links
                    .filter((l) => l.sourceId && editing.sourceLinks.some((x) => x.sourceId === l.sourceId))
                    .slice(0, 6)
                    .map((l, i) => (
                      <li key={i}>
                        <span className="dotmark" style={{ background: 'var(--orange)' }} />
                        <span className="small">
                          <span className="mono">{l.inputSymbol}</span> 经由 <span className="mono">{l.sourceCode}</span>{' '}
                          引入{sourceUsersOf(project, l.sourceId).length > 1 ? '共享' : '独用'}分量
                          {l.mode === 'relative' ? '（相对模式）' : ''}
                        </span>
                      </li>
                    ))}
                  {(engine.links.filter((l) => editing.sourceLinks.some((x) => x.sourceId === l.sourceId)).length === 0) ? (
                    <li className="small muted">尚无输入量通过本仪表的来源获得分量。</li>
                  ) : null}
                </ul>
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <Empty title="选择一台仪表">左侧列表中选择，或新增仪表。</Empty>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title="删除仪表"
        confirmLabel="删除"
        tone="danger"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => deleteId && remove(deleteId)}
      >
        删除后无法恢复（可用撤销）。仍有输入量引用时不会被删除。
      </ConfirmDialog>
    </div>
  );
}

function sourceUsersOf(project: { instruments: Instrument[] }, sourceId: string): string[] {
  return project.instruments
    .filter((i) => i.sourceLinks.some((l) => l.sourceId === sourceId))
    .map((i) => i.code);
}
