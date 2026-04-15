import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { createPackage } from '../api';

const emptyStep = () => ({ description: '', command: '' });

export default function CreatePackage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    appName: '',
    version: '',
    vendor: '',
    architecture: 'x64',
    psadtVersion: 'v3',
    installCommand: '',
    uninstallCommand: '',
    repairCommand: '',
    closeApps: '',
    defaultMode: 'Silent',
    detection: { type: 'file', path: '', valueName: '', productCode: '', script: '' },
    preInstallSteps: [],
    postInstallSteps: [],
    conditions: [],
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createPackage(form);
      navigate('/packages');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Create Package</h1>
      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* PSADT Version */}
        <Section title="PSADT Version">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="psadtVersion" value="v3" checked={form.psadtVersion === 'v3'} onChange={() => set('psadtVersion', 'v3')} className="accent-blue-600" />
              <span className="text-sm font-medium">PSADT v3</span>
              <span className="text-xs text-gray-400">Deploy-Application.ps1 + XML config</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="psadtVersion" value="v4" checked={form.psadtVersion === 'v4'} onChange={() => set('psadtVersion', 'v4')} className="accent-blue-600" />
              <span className="text-sm font-medium">PSADT v4.1.x</span>
              <span className="text-xs text-gray-400">Invoke-AppDeployToolkit.ps1 + PSD1 config</span>
            </label>
          </div>
        </Section>

        {/* Basic Info */}
        <Section title="Application Info">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Application Name" required value={form.appName} onChange={(v) => set('appName', v)} />
            <Input label="Version" required value={form.version} onChange={(v) => set('version', v)} />
            <Input label="Vendor" value={form.vendor} onChange={(v) => set('vendor', v)} />
            <Select label="Architecture" value={form.architecture} onChange={(v) => set('architecture', v)} options={['x64', 'x86', 'ARM64']} />
          </div>
        </Section>

        {/* Commands */}
        <Section title="Commands">
          <Input
            label="Install Command"
            value={form.installCommand}
            onChange={(v) => set('installCommand', v)}
            placeholder={form.psadtVersion === 'v4'
              ? 'e.g. Start-ADTProcess -FilePath "$dirFiles\\setup.exe" -ArgumentList "/S" -WaitForMsiExec'
              : 'e.g. Execute-Process -Path "$dirFiles\\setup.exe" -Parameters "/S" -WaitForMsiExec'}
          />
          <Input label="Uninstall Command" value={form.uninstallCommand} onChange={(v) => set('uninstallCommand', v)} className="mt-3" />
          <Input label="Repair Command" value={form.repairCommand} onChange={(v) => set('repairCommand', v)} className="mt-3" />
          <Input label="Close Applications" value={form.closeApps} onChange={(v) => set('closeApps', v)} className="mt-3" placeholder="Comma-separated process names, e.g. iexplore,firefox,chrome" />
          <Select label="Default Deploy Mode" value={form.defaultMode} onChange={(v) => set('defaultMode', v)} options={['Silent', 'Interactive', 'NonInteractive']} className="mt-3" />
        </Section>

        {/* Detection */}
        <Section title="Detection">
          <Select label="Detection Type" value={form.detection.type} onChange={(v) => set('detection', { ...form.detection, type: v })} options={['file', 'registry', 'msi', 'custom']} />
          {form.detection.type === 'file' && (
            <Input label="File Path" value={form.detection.path} onChange={(v) => set('detection', { ...form.detection, path: v })} className="mt-3" />
          )}
          {form.detection.type === 'registry' && (
            <div className="grid grid-cols-2 gap-4 mt-3">
              <Input label="Registry Path" value={form.detection.path} onChange={(v) => set('detection', { ...form.detection, path: v })} />
              <Input label="Value Name" value={form.detection.valueName} onChange={(v) => set('detection', { ...form.detection, valueName: v })} />
            </div>
          )}
          {form.detection.type === 'msi' && (
            <Input label="Product Code" value={form.detection.productCode} onChange={(v) => set('detection', { ...form.detection, productCode: v })} className="mt-3" />
          )}
          {form.detection.type === 'custom' && (
            <Textarea label="Custom Detection Script" value={form.detection.script} onChange={(v) => set('detection', { ...form.detection, script: v })} className="mt-3" />
          )}
        </Section>

        {/* Steps */}
        <StepsList label="Pre-Install Steps" steps={form.preInstallSteps} onChange={(v) => set('preInstallSteps', v)} />
        <StepsList label="Post-Install Steps" steps={form.postInstallSteps} onChange={(v) => set('postInstallSteps', v)} />

        {/* Conditions */}
        <Section title="Conditions">
          {form.conditions.map((c, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <select className="input w-40" value={c.type} onChange={(e) => { const arr = [...form.conditions]; arr[i] = { ...c, type: e.target.value }; set('conditions', arr); }}>
                <option value="os">OS Version</option>
                <option value="arch">Architecture</option>
                <option value="custom">Custom</option>
              </select>
              <input className="input flex-1" value={c.value} onChange={(e) => { const arr = [...form.conditions]; arr[i] = { ...c, value: e.target.value }; set('conditions', arr); }} />
              <button type="button" onClick={() => set('conditions', form.conditions.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700"><Trash2 size={18} /></button>
            </div>
          ))}
          <button type="button" onClick={() => set('conditions', [...form.conditions, { type: 'os', value: '' }])} className="btn-secondary text-sm mt-1">
            <Plus size={16} /> Add Condition
          </button>
        </Section>

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Creating...' : 'Create Package'}
        </button>
      </form>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h2 className="font-semibold text-lg mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Input({ label, className = '', ...props }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input className="input mt-1" {...props} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function Textarea({ label, className = '', ...props }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <textarea className="input mt-1 h-24" {...props} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function Select({ label, options, className = '', ...props }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <select className="input mt-1" {...props} onChange={(e) => props.onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function StepsList({ label, steps, onChange }) {
  return (
    <Section title={label}>
      {steps.map((s, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <input className="input w-48" placeholder="Description" value={s.description} onChange={(e) => { const arr = [...steps]; arr[i] = { ...s, description: e.target.value }; onChange(arr); }} />
          <input className="input flex-1" placeholder="PowerShell command" value={s.command} onChange={(e) => { const arr = [...steps]; arr[i] = { ...s, command: e.target.value }; onChange(arr); }} />
          <button type="button" onClick={() => onChange(steps.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700"><Trash2 size={18} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...steps, emptyStep()])} className="btn-secondary text-sm mt-1">
        <Plus size={16} /> Add Step
      </button>
    </Section>
  );
}
