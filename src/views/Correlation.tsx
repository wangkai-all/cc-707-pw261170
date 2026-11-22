import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Callout, Card, Empty, Tabs } from '../components/ui';
import { Icon } from '../components/Icon';
import { SegmentedBar } from '../charts/primitives';
import { formatNumber } from '../core/stats';
import { formatDimension } from '../core/units';
import { formatValue } from '../components/format';
import type { CorrelationEntry } from '../core/types';

type Mode = 'derived' | 'manual';

export function CorrelationView() {
  const store = useStore();
  const { project, engine } = store;
  const { correlation, inputs } = engine;
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  // 输入过程中保留原始文本，避免 "1." 被 number 化后立刻变成 "1"
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const mode = project.correlation.mode;

  const activeRows = useMemo(
    () => inputs.map((_, i) => i).filter((i) => correlation.matrix[i][i] > 0),
    [inputs, correlation],
  );
  /** 相关矩阵（无论模式，都从协方差归一化） */
  const rho = useMemo(() => {
    return activeRows.map((i) =>
      activeRows.map((j) => {
        const denom = Math.sqrt(correlation.matrix[i][i] * correlation.matrix[j][j]);
        return denom > 0 ? correlation.matrix[i][j] / denom : 0;
      }),
    );
  }, [activeRows, correlation]);

  const sharedPairs = useMemo(() => {
    const out: { i: number; j: number; rho: number; via: string[] }[] = [];
    for (let a = 0; a < activeRows.length; a += 1) {
      for (let b = a + 1; b < activeRows.length; b += 1) {
        const i = activeRows[a];
        const j = activeRows[b];
        const r = rho[a][b];
        if (Math.abs(r) < 1e-12) continue;
        const shared = new Set<string>();
        for (const si of inputs[i].sensitivities) {
          for (const sj of inputs[j].sensitivities) {
            if (si.varId === sj.varId) {
              const v = engine.variables.find((x) => x.id === si.varId);
              if (v) shared.add(v.kind === 'source' ? v.sourceCode ?? v.label : v.label);
            }
          }
        }
        out.push({ i, j, rho: r, via: [...shared] });
      }
    }
    return out.sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho));
  }, [activeRows, rho, inputs, engine.variables]);

  const setMode = (next: Mode) => {
    store.updateProject((p) => ({
      ...p,
      correlation: { ...p.correlation, mode: next },
    }));
  };

  const setEntry = (aId: string, bId: string, value: number) => {
    store.updateProject((p) => {
      const entries: CorrelationEntry[] = p.correlation.entries.filter(
        (e) => !((e.aId === aId && e.bId === bId) || (e.aId === bId && e.bId === aId)),
      );
      if (value !== 0) entries.push({ aId, bId, value });
      return { ...p, correlation: { ...p.correlation, entries } };
    });
  };

  const getEntry = (aId: string, bId: string): string => {
    const e = project.correlation.entries.find(
      (x) => (x.aId === aId && x.bId === bId) || (x.aId === bId && x.bId === aId),
    );
    return e ? String(e.value) : '0';
  };

  const cellColor = (r: number): string => {
    if (!Number.isFinite(r)) return 'transparent';
    const a = Math.min(1, Math.abs(r));
    const tint = r >= 0 ? 'var(--blue)' : 'var(--orange)';
    return `color-mix(in srgb, ${tint} ${Math.round(a * 42) + 4}%, var(--surface-1))`;
  };

  const usedInputs = activeRows.map((i) => inputs[i]);
  const n = usedInputs.length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>相关与协方差</h1>
          <p>
            相关性不是手工“加”上去的：每台仪表引用的校准来源对应一个潜变量，同一来源被多处引用时产生协方差。
            切换到手动模式可直接给相关系数；不合法的矩阵会阻断计算，工具不会把它悄悄改成另一张矩阵。
          </p>
        </div>
        <span className="spacer" />
        <Tabs
          ariaLabel="相关模型"
          value={mode}
          onChange={(v) => setMode(v)}
          items={[
            { id: 'derived', label: '由共享来源推导' },
            { id: 'manual', label: '手动指定相关系数' },
          ]}
        />
      </div>

      {correlation.status === 'invalid' ? (
        <Callout tone="error" title="协方差矩阵不合法：计算已阻断">
          <div className="small">
            最小特征值 {formatNumber(correlation.diagnostics.minEigenvalue)}（容差{' '}
            {formatNumber(correlation.diagnostics.tolerance)}）。矩阵含有负方差方向，无法对应任何真实随机变量。
            请修正超出 [-1, 1] 的系数或相互矛盾的约束；本工具不会自动裁剪或替换矩阵。
          </div>
          {correlation.issues.filter((i) => i.code !== 'covariance-not-psd').length > 0 ? (
            <ul className="mini-list" style={{ marginTop: 8 }}>
              {correlation.issues
                .filter((i) => i.code !== 'covariance-not-psd')
                .map((i, idx) => (
                  <li key={idx}>
                    <span className="dotmark" style={{ background: i.severity === 'error' ? 'var(--critical)' : 'var(--warning)' }} />
                    <span className="small">{i.message}</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </Callout>
      ) : correlation.status === 'singular' ? (
        <Callout tone="warn" title="矩阵接近奇异">
          存在接近 ±1 的相关，一阶总量仍可计算，但逐项贡献不再唯一。
        </Callout>
      ) : (
        <Callout tone={mode === 'manual' ? 'info' : 'good'} title={mode === 'manual' ? '手动相关模式' : '由共享来源推导的相关结构'}>
          <div className="small">
            {mode === 'manual'
              ? '相关系数原样使用；对角方差仍来自各输入量的自身分量。非法值不会被裁剪。'
              : '对角方差来自每条测量的重复性、分辨率与 B 类分量；非对角项来自共享的校准来源。'}
            {' '}正定检查针对实际参与计算的非零方差输入量，并归一化为相关矩阵后进行。
          </div>
        </Callout>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', marginTop: 14 }}>
        <Card
          title={mode === 'manual' ? '相关系数矩阵（可编辑）' : '相关系数矩阵（只读）'}
          subtitle={
            mode === 'manual'
              ? '编辑非对角元素；超出 [-1,1] 的值会被标记并阻断'
              : '数值来自共享随机变量，不可直接编辑'
          }
          actions={<Badge tone={correlation.status === 'invalid' ? 'bad' : 'good'}>n = {n}</Badge>}
        >
          {n === 0 ? (
            <Empty title="没有参与计算的输入量">添加输入量并填写读数或常量后，这里会出现相关矩阵。</Empty>
          ) : (
            <div className="table-wrap">
              <div
                className="matrix-grid"
                style={{ gridTemplateColumns: `96px repeat(${n}, minmax(52px, 1fr))`, minWidth: 96 + n * 56 }}
                onPointerLeave={() => setHover(null)}
              >
                <div className="matrix-head" />
                {usedInputs.map((m, j) => (
                  <div key={`h${j}`} className="matrix-head mono" title={m.input.name}>
                    {m.input.symbol}
                  </div>
                ))}
                {usedInputs.map((rowM, a) => {
                  const i = activeRows[a];
                  return (
                    <div key={`r${a}`} style={{ display: 'contents' }}>
                      <div className="matrix-head" style={{ textAlign: 'right', paddingRight: 8 }} title={rowM.input.name}>
                        <span className="mono">{rowM.input.symbol}</span>
                        <div className="tiny muted" style={{ fontFamily: 'var(--font)' }}>
                          {formatDimension(rowM.dim)}
                        </div>
                      </div>
                      {usedInputs.map((_, b) => {
                        const j = activeRows[b];
                        const isDiag = a === b;
                        const canEdit =
                          mode === 'manual' &&
                          !isDiag &&
                          formatDimension(inputs[i].dim) === formatDimension(inputs[j].dim);
                        const r = rho[a][b];
                        const invalid = !Number.isFinite(r) || Math.abs(r) > 1 + 1e-12;
                        const hl = hover && (hover.i === a || hover.j === b);
                        if (canEdit) {
                          const pairKey = `${rowM.input.id}|${usedInputs[b].input.id}`;
                          const stored = getEntry(rowM.input.id, usedInputs[b].input.id);
                          const shown = drafts[pairKey] ?? (stored === '0' ? '' : stored);
                          return (
                            <label
                              key={`c${a}-${b}`}
                              className="matrix-cell"
                              style={{
                                background: cellColor(Number(shown || 0)),
                                outline: hl ? '2px solid var(--blue)' : 'none',
                                padding: 2,
                              }}
                              title={`${rowM.input.symbol} ↔ ${usedInputs[b].input.symbol}：编辑相关系数；超出 [-1,1] 会被标记并阻断`}
                            >
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label={`${rowM.input.symbol} 与 ${usedInputs[b].input.symbol} 的相关系数`}
                                value={shown}
                                placeholder="0"
                                onFocus={() => setDrafts((d) => ({ ...d, [pairKey]: shown }))}
                                onBlur={() =>
                                  setDrafts((d) => {
                                    const next = { ...d };
                                    delete next[pairKey];
                                    return next;
                                  })
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setDrafts((d) => ({ ...d, [pairKey]: raw }));
                                  const text = raw.trim();
                                  // 故意不裁剪：非法值交由引擎标记并阻断
                                  if (text === '' || text === '-' || text === '.') {
                                    setEntry(rowM.input.id, usedInputs[b].input.id, 0);
                                    return;
                                  }
                                  const v = Number(text);
                                  setEntry(
                                    rowM.input.id,
                                    usedInputs[b].input.id,
                                    Number.isFinite(v) ? v : Number.NaN,
                                  );
                                }}
                                onPointerEnter={() => setHover({ i: a, j: b })}
                                style={{
                                  width: '100%',
                                  minWidth: 0,
                                  height: 30,
                                  textAlign: 'center',
                                  padding: '0 2px',
                                  background: 'color-mix(in srgb, var(--surface-1) 55%, transparent)',
                                  border: '1px solid transparent',
                                  fontFamily: 'var(--mono)',
                                  fontSize: 11.5,
                                }}
                              />
                            </label>
                          );
                        }
                        return (
                          <div
                            key={`c${a}-${b}`}
                            className="matrix-cell tabular"
                            onPointerEnter={() => setHover({ i: a, j: b })}
                            style={{
                              background: cellColor(r),
                              outline: hl ? '2px solid var(--blue)' : 'none',
                              border: isDiag ? '1px solid var(--border)' : '1px solid transparent',
                              fontWeight: isDiag ? 600 : 400,
                              color: invalid ? 'var(--critical-ink)' : undefined,
                            }}
                            title={`${rowM.input.symbol} ↔ ${usedInputs[b].input.symbol}：ρ = ${formatNumber(r, 3)}`}
                          >
                            {formatNumber(r, 3)}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {n > 0 ? (
            <div className="legend" style={{ marginTop: 10 }}>
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: 'var(--blue)' }} />正相关
              </span>
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: 'var(--orange)' }} />负相关
              </span>
              {mode === 'manual' ? (
                <span className="legend-item small muted">空格或 0 表示独立</span>
              ) : null}
            </div>
          ) : null}

          {correlation.issues.length > 0 ? (
            <div className="stack" style={{ gap: 6, marginTop: 12 }}>
              {correlation.issues.map((i, idx) => (
                <div key={idx} className="small" style={{ color: i.severity === 'error' ? 'var(--critical-ink)' : 'var(--warning-ink)' }}>
                  · {i.severity === 'error' ? '已阻断：' : ''}
                  {i.message}
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <div className="stack">
          <Card title="特征值诊断" subtitle="相关矩阵的谱：出现负特征值即不是合法协方差">
            {n === 0 ? (
              <div className="small muted">—</div>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                <div className="hstack">
                  <div className="stat" style={{ padding: 0 }}>
                    <div className="label small">最小特征值</div>
                    <div
                      className="value sm tabular"
                      style={{ color: correlation.diagnostics.psd ? undefined : 'var(--critical-ink)' }}
                    >
                      {formatNumber(correlation.diagnostics.minEigenvalue, 5)}
                    </div>
                  </div>
                  <span className="spacer" />
                  <Badge tone={correlation.diagnostics.psd ? 'good' : 'bad'}>
                    {correlation.diagnostics.psd
                      ? correlation.diagnostics.singular
                        ? '半正定（奇异）'
                        : '正定'
                      : '不是半正定'}
                  </Badge>
                </div>
                <SegmentedBar
                  ariaLabel="特征值分布"
                  height={10}
                  parts={correlation.diagnostics.eigenvalues.map((e, i) => ({
                    key: String(i),
                    label: `λ${i + 1} = ${formatNumber(e, 3)}`,
                    value: Math.max(0, e),
                    color: e < -correlation.diagnostics.tolerance ? 'var(--critical)' : i === 0 ? 'var(--blue)' : 'var(--violet)',
                  }))}
                />
                <div className="small secondary">
                  容差 {formatNumber(correlation.diagnostics.tolerance)}；尺度 {formatNumber(correlation.diagnostics.scale)}。
                  负特征值小于容差时视为舍入，抽样阶段会截为零并给出提醒；超过容差则阻断。
                </div>
              </div>
            )}
          </Card>

          <Card title="相关对与共同来源" subtitle={mode === 'derived' ? '直接对应共享的潜变量' : '手动模式下仅显示设定的系数'}>
            {sharedPairs.length === 0 ? (
              <div className="small muted">没有非零相关。所有输入量在当前模型下独立。</div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {sharedPairs.slice(0, 12).map((p, idx) => (
                  <div key={idx} className="hstack" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <span className="chip mono" style={{ flex: 'none' }}>
                      {inputs[p.i].input.symbol} · {inputs[p.j].input.symbol}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="small">
                        ρ = <span className="tabular" style={{ fontWeight: 600 }}>{formatNumber(p.rho, 3)}</span>
                        {mode === 'derived' && p.via.length ? (
                          <span className="muted"> ，共同来源：{p.via.join('、')}</span>
                        ) : null}
                      </div>
                      {mode === 'derived' ? (
                        <div className="tiny muted">独立假设下 ρ = 0；两个输入量共享同一编号的随机变量</div>
                      ) : null}
                    </div>
                    <span
                      className="dotmark"
                      style={{
                        background: p.rho >= 0 ? 'var(--blue)' : 'var(--orange)',
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        marginTop: 6,
                        flex: 'none',
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>

          {mode === 'manual' ? (
            <Card title="输入量协方差（SI²）" subtitle="由相关系数与各自方差构造，未被裁剪">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>输入量</th>
                      <th className="num">u</th>
                      <th className="num">方差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usedInputs.map((m, a) => (
                      <tr key={m.input.id}>
                        <td className="mono">{m.input.symbol}</td>
                        <td className="num">{formatValue(Math.sqrt(correlation.matrix[activeRows[a]][activeRows[a]]), 4)}</td>
                        <td className="num">{formatValue(correlation.matrix[activeRows[a]][activeRows[a]], 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                手动模式下相关系数只替换非对角项；单位不同的输入量之间不允许设定相关系数。
              </div>
            </Card>
          ) : (
            <Card title="为什么不能简单相加" subtitle="共享来源使方差不是简单求和">
              <div className="small secondary">
                共享来源 S 同时进入输入量 A 和 B。若 A、B 在结果中以同号出现，协方差项 2·c<sub>A</sub>c<sub>B</sub>u<sub>S</sub>²
                使结果不确定度大于独立假设；若以相反符号出现（如差值、比值），该项为负，独立相加反而高估。
                到“改配与对比”可以把共用标准件拆成独立副本，观察均值不变而区间改变。
              </div>
            </Card>
          )}
        </div>
      </div>

      {mode === 'manual' && n > 0 ? (
        <Card title="手动相关矩阵说明" subtitle="非法输入的处理">
          <div className="grid cols-2" style={{ gap: 16 }}>
            <div className="small secondary">
              <strong>不会被自动修复：</strong>输入 1.4 就是 1.4，引擎会将其标记为超出范围并做半正定检查；
              若矩阵因此不是半正定，整站阻断一阶与蒙特卡洛计算，直到用户改正。
            </div>
            <div className="small secondary">
              <strong>重置：</strong>切回“由共享来源推导”会忽略所有手填系数，但会保留在项目中，
              再次切换回来时仍可使用。
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={() =>
                    store.updateProject((p) => ({
                      ...p,
                      correlation: { ...p.correlation, entries: [] },
                    }))
                  }
                  disabled={project.correlation.entries.length === 0}
                >
                  <Icon name="trash" size={12} /> 清空手填系数（{project.correlation.entries.length}）
                </button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
