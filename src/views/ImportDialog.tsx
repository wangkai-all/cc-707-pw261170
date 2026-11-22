import { useState } from 'react';
import { useStore } from '../state/store';
import { ConfirmDialog } from '../components/ui';

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const res = store.importJson(text);
    if (res.ok) {
      setText('');
      setError(null);
      onClose();
    } else {
      setError(res.message);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title="导入项目 JSON"
      confirmLabel="导入"
      onCancel={() => {
        setError(null);
        onClose();
      }}
      onConfirm={submit}
    >
      <div className="stack">
        <p className="small secondary">
          粘贴由本应用导出的项目 JSON。导入会替换当前项目，可用撤销恢复。
        </p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => setText(String(reader.result ?? ''));
            reader.readAsText(file);
          }}
        />
        <textarea
          className="mono"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{"schemaVersion":1,...}'
          aria-label="项目 JSON"
        />
        {error ? <div className="callout error">{error}</div> : null}
      </div>
    </ConfirmDialog>
  );
}
