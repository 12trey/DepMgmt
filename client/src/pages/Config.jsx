import { useEffect, useState } from 'react';
import { getConfig, updateConfig } from '../api';

export default function Config() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getConfig().then(setConfig).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const result = await updateConfig(config);
      setConfig(result);
      setMsg('Configuration saved.');
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!config) return <p>Loading...</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      {msg && <div className="bg-blue-50 text-blue-700 p-3 rounded mb-4">{msg}</div>}

      <div className="bg-white rounded-lg shadow p-5 space-y-4">
        <Field label="Repository URL" value={config.repository?.url || ''} onChange={(v) => setConfig({ ...config, repository: { ...config.repository, url: v } })} />
        <Field label="Repository Local Path" value={config.repository?.localPath || ''} onChange={(v) => setConfig({ ...config, repository: { ...config.repository, localPath: v } })} />
        <Field label="Packages Base Path" value={config.packages?.basePath || ''} onChange={(v) => setConfig({ ...config, packages: { ...config.packages, basePath: v } })} />
        <Field label="Server Port" value={config.server?.port || ''} onChange={(v) => setConfig({ ...config, server: { ...config.server, port: parseInt(v) || 4000 } })} />
        <Field label="PowerShell Path" value={config.execution?.powershellPath || ''} onChange={(v) => setConfig({ ...config, execution: { ...config.execution, powershellPath: v } })} />

        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
