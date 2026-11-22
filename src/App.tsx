import { useMemo, useState } from 'react';
import { Icon, type IconName } from './components/Icon';
import { StoreProvider, useStore, type ViewId } from './state/store';
import { Badge } from './components/ui';
import { OverviewView } from './views/Overview';
import { SourcesView } from './views/Sources';
import { InstrumentsView } from './views/Instruments';
import { InputsView } from './views/Inputs';
import { ResultsView } from './views/Results';
import { CorrelationView } from './views/Correlation';
import { TraceView } from './views/Trace';
import { CompareView } from './views/Compare';
import { ImportDialog } from './views/ImportDialog';

const NAV: { group: string; items: { id: ViewId; label: string; icon: IconName }[] }[] = [
  {
    group: '数据管理',
    items: [
      { id: 'overview', label: '概览', icon: 'grid' },
      { id: 'sources', label: '校准来源', icon: 'source' },
      { id: 'instruments', label: '仪表', icon: 'instrument' },
      { id: 'inputs', label: '输入量', icon: 'input' },
    ],
  },
  {
    group: '计算',
    items: [
      { id: 'results', label: '结果与公式', icon: 'formula' },
      { id: 'correlation', label: '相关与协方差', icon: 'matrix' },
      { id: 'trace', label: '溯源链', icon: 'trace' },
      { id: 'compare', label: '改配与对比', icon: 'compare' },
    ],
  },
];

function AppShell() {
  const store = useStore();
  const { project, engine, view } = store;
  const [importOpen, setImportOpen] = useState(false);
  const counts = useMemo(
    () => ({
      overview: 0,
      sources: project.sources.length,
      instruments: project.instruments.length,
      inputs: project.inputs.length,
      results: project.results.length,
      correlation: 0,
      trace: 0,
      compare: 0,
    }),
    [project],
  );
  const errorCount = engine.issues.filter((i) => i.severity === 'error').length;
  const warnCount = engine.issues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden>TL</div>
          <div>
            <div className="brand-name">TraceLab</div>
            <div className="brand-sub">测量不确定度溯源</div>
          </div>
        </div>
        <div className="header-project">
          <input
            aria-label="项目名称"
            value={project.name}
            onChange={(e) => store.updateProject((p) => ({ ...p, name: e.target.value }), { silent: true })}
            spellCheck={false}
          />
          {engine.blocked ? (
            <Badge tone="bad" dot>计算被阻断</Badge>
          ) : errorCount > 0 ? (
            <Badge tone="bad">错误 {errorCount}</Badge>
          ) : warnCount > 0 ? (
            <Badge tone="warn">警告 {warnCount}</Badge>
          ) : (
            <Badge tone="good" dot>模型有效</Badge>
          )}
        </div>
        <div className="header-actions">
          <button type="button" className="btn ghost sm" onClick={store.undo} disabled={!store.canUndo} title="撤销 (Ctrl+Z)">
            <Icon name="reset" size={14} /> 撤销
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={14} /> 导入
          </button>
          <button type="button" className="btn ghost sm" onClick={store.exportJson}>
            <Icon name="download" size={14} /> 导出
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => store.setTheme(store.theme === 'dark' ? 'light' : 'dark')}
            aria-label={store.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            title="切换主题"
          >
            <Icon name={store.theme === 'dark' ? 'sun' : 'moon'} size={14} />
          </button>
        </div>
      </header>

      <nav className="sidebar" aria-label="工作区">
        {NAV.map((g) => (
          <div key={g.group} style={{ display: 'contents' }}>
            <div className="nav-group-label">{g.group}</div>
            {g.items.map((it) => (
              <button
                key={it.id}
                type="button"
                className="nav-item"
                aria-current={view === it.id ? 'page' : undefined}
                onClick={() => store.setView(it.id)}
              >
                <span className="nav-icon"><Icon name={it.icon} size={16} /></span>
                <span>{it.label}</span>
                {counts[it.id] ? <span className="nav-count">{counts[it.id]}</span> : null}
                {it.id === 'correlation' && engine.correlation.status === 'invalid' ? (
                  <span className="badge bad" style={{ marginLeft: 'auto', padding: '0 5px' }}>!</span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
        <div className="sidebar-footer">
          <div>固定种子蒙特卡洛 · {project.settings.draws.toLocaleString('zh-CN')} 次抽样</div>
          <div style={{ marginTop: 4 }}>
            数据保存在本浏览器；全部数值为虚构演示。
          </div>
        </div>
      </nav>

      <main className="main">
        <div className="main-inner">
          {store.loadNote ? (
            <div className="callout warn" style={{ marginBottom: 16 }}>
              <span className="ico"><Icon name="alert" size={15} /></span>
              <div>{store.loadNote}</div>
            </div>
          ) : null}
          {view === 'overview' && <OverviewView />}
          {view === 'sources' && <SourcesView />}
          {view === 'instruments' && <InstrumentsView />}
          {view === 'inputs' && <InputsView />}
          {view === 'results' && <ResultsView />}
          {view === 'correlation' && <CorrelationView />}
          {view === 'trace' && <TraceView />}
          {view === 'compare' && <CompareView />}
        </div>
      </main>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <AppShell />
    </StoreProvider>
  );
}
