import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { runEngine, type EngineResult } from '../core/engine';
import type { Project } from '../core/types';
import { demoProject, emptyProject } from '../data/demo';
import { cloneProject, touch } from '../data/operations';

export type ViewId =
  | 'overview'
  | 'sources'
  | 'instruments'
  | 'inputs'
  | 'results'
  | 'correlation'
  | 'trace'
  | 'compare';

const STORAGE_KEY = 'tracelab.project.v1';
const THEME_KEY = 'tracelab.theme';

/** 兼容早期草稿：补齐后来加入的字段。 */
export function migrate(p: Project): Project {
  return {
    ...p,
    correlation: p.correlation ?? { mode: 'derived', entries: [] },
    settings: {
      seed: p.settings?.seed ?? 20261122,
      draws: p.settings?.draws ?? 20000,
      nearZeroRel: p.settings?.nearZeroRel ?? 1e-4,
    },
    inputs: p.inputs.map((q) => ({
      ...q,
      constantUncertainty: q.constantUncertainty ?? '',
      constantDistribution: q.constantDistribution ?? 'normal',
      resolution: q.resolution ?? '',
    })),
    sources: p.sources.map((s) => ({
      ...s,
      valueUnit: s.valueUnit ?? s.uncUnit ?? '',
      uncUnit: s.uncUnit ?? 'mm',
    })),
  };
}

function loadProject(): { project: Project; note: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Project;
      if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.inputs)) {
        return { project: migrate(parsed), note: null };
      }
      return { project: demoProject(), note: '本地项目格式不兼容，已载入演示数据。' };
    }
  } catch {
    return { project: demoProject(), note: '本地项目读取失败，已载入演示数据。' };
  }
  return { project: demoProject(), note: null };
}

interface Toast {
  id: number;
  message: string;
  tone: 'good' | 'warn' | 'bad';
}

export interface StoreValue {
  project: Project;
  engine: EngineResult;
  /** 输入仍在更新中（useDeferredValue），用于淡化旧结果 */
  isStale: boolean;
  view: ViewId;
  selectedResult: string | null;
  theme: 'light' | 'dark';
  loadNote: string | null;
  lastSaved: Date | null;
  canUndo: boolean;
  canRedo: boolean;
  setView: (v: ViewId) => void;
  setSelectedResult: (symbol: string | null) => void;
  updateProject: (fn: (p: Project) => Project, options?: { select?: string | null; silent?: boolean }) => void;
  replaceProject: (p: Project, note?: string) => void;
  resetDemo: () => void;
  resetEmpty: () => void;
  newFromCurrent: () => void;
  setTheme: (t: 'light' | 'dark') => void;
  exportJson: () => void;
  importJson: (text: string) => { ok: boolean; message: string };
  undo: () => void;
  redo: () => void;
  toast: (message: string, tone?: Toast['tone']) => void;
}

const StoreContext = createContext<StoreValue | null>(null);
const HISTORY_LIMIT = 40;

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(loadProject, []);
  const [project, setProject] = useState<Project>(initial.project);
  const [view, setViewState] = useState<ViewId>('overview');
  const [selectedResult, setSelectedResult] = useState<string | null>(
    initial.project.results[0]?.symbol ?? null,
  );
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [loadNote] = useState<string | null>(initial.note);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  const deferredProject = useDeferredValue(project);
  const engine = useMemo(() => runEngine(deferredProject), [deferredProject]);
  const isStale = deferredProject !== project;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.body.dataset.stale = isStale ? 'true' : 'false';
  }, [isStale]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        setLastSaved(new Date());
      } catch {
        // 存储配额或隐私模式：忽略
      }
    }, 450);
    return () => window.clearTimeout(handle);
  }, [project]);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const pushHistory = useCallback((p: Project) => {
    past.current = [...past.current.slice(-HISTORY_LIMIT), p];
    future.current = [];
    setHistoryTick((x) => x + 1);
  }, []);

  const updateProject = useCallback(
    (fn: (p: Project) => Project, options?: { select?: string | null; silent?: boolean }) => {
      setProject((p) => {
        if (!options?.silent) pushHistory(p);
        return touch(fn(p));
      });
      if (options?.select !== undefined) setSelectedResult(options.select);
    },
    [pushHistory],
  );

  const replaceProject = useCallback(
    (p: Project, note?: string) => {
      setProject((prev) => {
        pushHistory(prev);
        return { ...p, updatedAt: new Date().toISOString() };
      });
      setSelectedResult(p.results[0]?.symbol ?? null);
      if (note) toast(note);
    },
    [pushHistory, toast],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    setProject((cur) => {
      future.current.push(cur);
      return prev;
    });
    setHistoryTick((x) => x + 1);
    toast('已撤销', 'warn');
  }, [toast]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setProject((cur) => {
      past.current.push(cur);
      return next;
    });
    setHistoryTick((x) => x + 1);
    toast('已重做', 'warn');
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const setTheme = useCallback((t: 'light' | 'dark') => setThemeState(t), []);
  const setView = useCallback((v: ViewId) => {
    setViewState(v);
    const main = document.querySelector<HTMLElement>('.main');
    if (typeof main?.scrollTo === 'function') main.scrollTo({ top: 0 });
  }, []);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\w一-龥-]+/g, '_')}.tracelab.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出项目 JSON');
  }, [project, toast]);

  const importJson = useCallback(
    (text: string) => {
      try {
        const parsed = JSON.parse(text) as Project;
        if (
          !parsed ||
          parsed.schemaVersion !== 1 ||
          !Array.isArray(parsed.inputs) ||
          !Array.isArray(parsed.results) ||
          !Array.isArray(parsed.sources)
        ) {
          return { ok: false, message: '不是有效的 TraceLab 项目文件（缺少 schemaVersion / sources / inputs / results）。' };
        }
        replaceProject(migrate(parsed), '项目已导入');
        return { ok: true, message: '导入成功' };
      } catch (err) {
        return { ok: false, message: `解析失败：${(err as Error).message}` };
      }
    },
    [replaceProject],
  );

  const value: StoreValue = {
    project,
    engine,
    isStale,
    view,
    selectedResult,
    theme,
    loadNote,
    lastSaved,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    setView,
    setSelectedResult,
    updateProject,
    replaceProject,
    resetDemo: () => replaceProject(demoProject(), '已恢复演示数据'),
    resetEmpty: () => {
      replaceProject(emptyProject(), '已新建空白项目');
      setView('sources');
    },
    newFromCurrent: () => replaceProject(cloneProject(project), '已创建副本'),
    setTheme,
    exportJson,
    importJson,
    undo,
    redo,
    toast,
  };
  void historyTick;

  return (
    <StoreContext.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </StoreContext.Provider>
  );
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
