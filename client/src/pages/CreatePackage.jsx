import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Upload, FileText } from 'lucide-react';
import { createPackage, uploadFiles, getConfig, copyDefaultFiles } from '../api';

const emptyStep = () => ({ description: '', command: '' });

// Generate PSADT install/uninstall commands from a dropped installer file
function generateCommands(filename, type, psadtVersion) {
  if (psadtVersion === 'v4') {
    if (type === 'msi') {
      return {
        install:   `Start-AdtMsiProcess -Action 'Install' -FilePath "$dirFiles\\${filename}" -ArgumentList '/QN'`,
        uninstall: `Start-AdtMsiProcess -Action 'Uninstall' -FilePath "$dirFiles\\${filename}" -ArgumentList '/QN'`,
      };
    }
    // exe
    return {
      install:   `Start-AdtProcess -FilePath "$dirFiles\\${filename}" -ArgumentList '/S'`,
      uninstall: '',
    };
  }

  // v3
  if (type === 'msi') {
    return {
      install:   `Execute-MSI -Action 'Install' -Path "$dirFiles\\${filename}" -Parameters '/QN'`,
      uninstall: `Execute-MSI -Action 'Uninstall' -Path "$dirFiles\\${filename}" -Parameters '/QN'`,
    };
  }
  // exe
  return {
    install:   `Execute-Process -Path "$dirFiles\\${filename}" -Parameters '/S'`,
    uninstall: '',
  };
}

export default function CreatePackage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    appName: '',
    version: '',
    vendor: '',
    architecture: 'x64',
    psadtVersion: 'v4',
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

  const [droppedFile, setDroppedFile] = useState(null);
  const [cmdDragOver, setCmdDragOver] = useState(false);
  const cmdDragCount = useRef(0);

  const [defaultFilesCfg, setDefaultFilesCfg] = useState(null);
  const [copyDefaults, setCopyDefaults] = useState(false);

  useEffect(() => {
    getConfig().then(cfg => {
      const df = cfg.defaultFiles || {};
      setDefaultFilesCfg(df);
      setCopyDefaults(df.copyOnCreate ?? false);
    }).catch(() => {});
  }, []);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Regenerate commands whenever the PSADT version changes while a file is still attached
  useEffect(() => {
    if (!droppedFile) return;
    const type = droppedFile.name.toLowerCase().endsWith('.msi') ? 'msi' : 'exe';
    const { install, uninstall } = generateCommands(droppedFile.name, type, form.psadtVersion);
    setForm(f => ({ ...f, installCommand: install, uninstallCommand: uninstall }));
  }, [form.psadtVersion, droppedFile]);

  const handleInstallerDrop = (e) => {
    e.preventDefault();
    cmdDragCount.current = 0;
    setCmdDragOver(false);
    const file = Array.from(e.dataTransfer.files)[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'msi' && ext !== 'exe') return;
    setDroppedFile(file);
    // commands will be set by the useEffect above
  };

  const clearDroppedFile = () => {
    setDroppedFile(null);
    set('installCommand', '');
    set('uninstallCommand', '');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createPackage(form);
      if (droppedFile) {
        await uploadFiles(form.appName, form.version, [droppedFile]);
      }
      if (copyDefaults && defaultFilesCfg?.sourcePath) {
        await copyDefaultFiles(form.appName, form.version).catch(() => {});
      }
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
              <input type="radio" name="psadtVersion" value="v4" checked={form.psadtVersion === 'v4'} onChange={() => set('psadtVersion', 'v4')} className="accent-blue-600" />
              <span className="text-sm font-medium">PSADT v4.1.x</span>
              <span className="text-xs text-gray-400">Invoke-AppDeployToolkit.ps1 + PSD1 config</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="psadtVersion" value="v3" checked={form.psadtVersion === 'v3'} onChange={() => set('psadtVersion', 'v3')} className="accent-blue-600" />
              <span className="text-sm font-medium">PSADT v3</span>
              <span className="text-xs text-gray-400">Deploy-Application.ps1 + XML config</span>
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

        {/* Commands — drag-drop zone */}
        <div
          className={`bg-white rounded-lg shadow p-5 relative transition-all ${cmdDragOver ? 'ring-2 ring-blue-400' : ''}`}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDragEnter={e => { e.preventDefault(); cmdDragCount.current++; setCmdDragOver(true); }}
          onDragLeave={e => {
            e.preventDefault();
            cmdDragCount.current = Math.max(0, cmdDragCount.current - 1);
            if (cmdDragCount.current === 0) setCmdDragOver(false);
          }}
          onDrop={handleInstallerDrop}
        >
          {cmdDragOver && (
            <div className="absolute inset-0 bg-blue-50/90 rounded-lg z-10 pointer-events-none flex items-center justify-center">
              <div className="flex items-center gap-2 text-blue-600 font-medium text-sm">
                <Upload size={18} /> Drop .msi or .exe to auto-fill commands
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Commands</h2>
            <span className="text-xs text-gray-400 select-none">Drop an installer (.msi / .exe) to auto-fill ↓</span>
          </div>

          {/* Dropped file chip */}
          {droppedFile && (
            <div className="flex items-center gap-2 mb-4 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <FileText size={14} className="text-blue-600 flex-shrink-0" />
              <span className="text-sm text-blue-700 font-medium flex-1 truncate">{droppedFile.name}</span>
              <span className="text-xs text-blue-500 flex-shrink-0">
                {droppedFile.size < 1024 ** 2
                  ? `${(droppedFile.size / 1024).toFixed(0)} KB`
                  : `${(droppedFile.size / 1024 ** 2).toFixed(1)} MB`}
              </span>
              <span className="text-xs text-blue-500 flex-shrink-0 ml-1">— will be uploaded to Files\</span>
              <button
                type="button"
                onClick={clearDroppedFile}
                className="text-blue-400 hover:text-blue-700 ml-2 flex-shrink-0"
                title="Remove"
              >
                ✕
              </button>
            </div>
          )}

          <Textarea
            label="Install Command"
            value={form.installCommand}
            onChange={(v) => set('installCommand', v)}
            placeholder={form.psadtVersion === 'v4'
              ? "e.g. Start-AdtProcess -FilePath \"$dirFiles\\setup.exe\" -ArgumentList '/S'"
              : "e.g. Execute-Process -Path \"$dirFiles\\setup.exe\" -Parameters '/S'"}
          />
          <Textarea label="Uninstall Command" value={form.uninstallCommand} onChange={(v) => set('uninstallCommand', v)} className="mt-3" />
          <Textarea label="Repair Command" value={form.repairCommand} onChange={(v) => set('repairCommand', v)} className="mt-3" />
          <Input label="Close Applications" value={form.closeApps} onChange={(v) => set('closeApps', v)} className="mt-3" placeholder="Comma-separated process names, e.g. iexplore,firefox,chrome" />
          <Select label="Default Deploy Mode" value={form.defaultMode} onChange={(v) => set('defaultMode', v)} options={['Silent', 'Interactive', 'NonInteractive']} className="mt-3" />
          {defaultFilesCfg?.sourcePath && (
            <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={copyDefaults}
                onChange={(e) => setCopyDefaults(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-700">Copy default files (Assets, SupportFiles, Strings, Extensions)</span>
            </label>
          )}
        </div>

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
        <div key={i} className="flex gap-2 mb-3 items-start">
          <input className="input w-48 flex-shrink-0" placeholder="Description" value={s.description} onChange={(e) => { const arr = [...steps]; arr[i] = { ...s, description: e.target.value }; onChange(arr); }} />
          <textarea className="input flex-1 h-20 font-mono text-sm resize-y" placeholder="PowerShell command(s)" value={s.command} onChange={(e) => { const arr = [...steps]; arr[i] = { ...s, command: e.target.value }; onChange(arr); }} />
          <button type="button" onClick={() => onChange(steps.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700 mt-1 flex-shrink-0"><Trash2 size={18} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...steps, emptyStep()])} className="btn-secondary text-sm mt-1">
        <Plus size={16} /> Add Step
      </button>
    </Section>
  );
}
