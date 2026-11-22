import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Card({
  title,
  subtitle,
  actions,
  children,
  flush,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section className="card" id={id}>
      {title ? (
        <header className="card-head">
          <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle ? <div className="small muted" style={{ marginTop: 2 }}>{subtitle}</div> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
  icon = true,
}: {
  tone?: 'info' | 'warn' | 'error' | 'good';
  title?: string;
  children: ReactNode;
  icon?: boolean;
}) {
  const iconName = tone === 'error' ? 'x' : tone === 'warn' ? 'alert' : tone === 'good' ? 'check' : 'info';
  return (
    <div className={`callout ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {icon ? <span className="ico"><Icon name={iconName} size={15} /></span> : null}
      <div>
        {title ? <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  span,
  help,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  span?: 'span-2' | 'span-3' | 'span-all';
  help?: string;
}) {
  return (
    <label className={`field ${span ?? ''}`}>
      <span className="lbl">
        {label}
        {help ? <span className="help" title={help}>?</span> : null}
      </span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</div>
      {children ? <div className="small" style={{ maxWidth: '48ch' }}>{children}</div> : null}
      {action}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="hstack" style={{ marginBottom: 10 }}>
      <h3>{children}</h3>
      <span className="spacer" />
      {right}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
  dot,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`badge ${tone}`}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = '确认',
  tone = 'primary',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dialog-head"><h2>{title}</h2></div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>取消</button>
          <button type="button" className={`btn ${tone === 'danger' ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: `var(--${tone === 'bad' ? 'critical-ink' : tone === 'warn' ? 'warning-ink' : 'good-ink'})` } : undefined}>
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function InlineNumber({ v, digits = 4, unit }: { v: number; digits?: number; unit?: string }) {
  const [open, setOpen] = useState(false);
  if (!Number.isFinite(v)) return <span className="muted">—</span>;
  const text = Math.abs(v) >= 1e-3 && Math.abs(v) < 1e6 ? Number(v.toPrecision(digits)).toString() : v.toExponential(3);
  return (
    <span className="tabular" title={open ? undefined : '点击查看完整精度'} onClick={() => setOpen((x) => !x)} style={{ cursor: 'pointer' }}>
      {open ? v.toPrecision(12) : text}{unit ? ` ${unit}` : ''}
    </span>
  );
}


/**
 * 文本输入框：本地保留原始文本（允许输入 "1."、"-"、空串等中间态），
 * 失焦时把解析后的值确认回项目；外部值变化（撤销、切换项目）时同步。
 */
export function TextField({
  value,
  onCommit,
  parse,
  allowEmpty = false,
  live = true,
  ...rest
}: {
  value: string;
  onCommit: (v: string) => void;
  parse?: (raw: string) => string | null;
  allowEmpty?: boolean;
  /** false 时只在失焦提交，适合需要整词输入（符号、读数）的字段 */
  live?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <input
      {...rest}
      value={focused ? draft : value}
      onFocus={(e) => {
        setDraft(value);
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (!live) return;
        if (raw === '' && allowEmpty) {
          onCommit('');
          return;
        }
        if (parse) {
          const next = parse(raw);
          if (next !== null) onCommit(next);
        } else {
          onCommit(raw);
        }
      }}
      onBlur={(e) => {
        setFocused(false);
        if (!live) {
          if (draft === '' && allowEmpty) onCommit('');
          else if (parse) {
            const next = parse(draft);
            if (next !== null) onCommit(next);
          } else onCommit(draft);
        }
        rest.onBlur?.(e);
      }}
    />
  );
}
