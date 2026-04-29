import { useEffect, useState } from 'react';
import { Plus, Trash2, CheckCircle, AlertCircle, Loader, FolderOpen } from 'lucide-react';
import { getConfig, updateConfig, verifyGroup, browseFolder, browseFile } from '../api';
import { useAdCredential } from '../context/AdCredentialContext';
import { useConfigContext } from '../context/ConfigContext';

export default function Config() {
  const { adUsername, adPassword } = useAdCredential();
  const { notifyConfigSaved } = useConfigContext();
  const [config, setConfig] = useState(null);
  const [savedPaths, setSavedPaths] = useState({ repoPath: '', basePath: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('info'); // 'info' | 'error'

  // New group form state
  const [newGroup, setNewGroup] = useState({ name: '', type: 'local' });
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null); // { exists, name, description, error }

  useEffect(() => {
    getConfig().then((c) => {
      setConfig(c);
      setSavedPaths({ repoPath: c.repository?.localPath || '', basePath: c.packages?.basePath || '' });
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const result = await updateConfig(config);
      const newRepoPath = result.repository?.localPath || '';
      const newBasePath = result.packages?.basePath || '';
      const pathsChanged =
        newRepoPath !== savedPaths.repoPath || newBasePath !== savedPaths.basePath;
      setConfig(result);
      setSavedPaths({ repoPath: newRepoPath, basePath: newBasePath });
      setMsg('Configuration saved.');
      setMsgType('info');
      if (pathsChanged) notifyConfigSaved();
    } catch (err) {
      setMsg(`Error: ${err.message}`);
      setMsgType('error');
    } finally {
      setSaving(false);
    }
  };

  const setNested = (section, key, value) =>
    setConfig((c) => ({ ...c, [section]: { ...c[section], [key]: value } }));

  // ── Managed groups helpers ───────────────────────────────────────────────

  const managedGroups = config?.groups?.managedGroups || [];

  const removeGroup = (index) => {
    const updated = managedGroups.filter((_, i) => i !== index);
    setConfig((c) => ({ ...c, groups: { ...c.groups, managedGroups: updated } }));
  };

  const handleVerifyGroup = async () => {
    if (!newGroup.name.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    const credential = adUsername.trim() ? { adUsername: adUsername.trim(), adPassword } : null;
    try {
      const result = await verifyGroup(newGroup.name.trim(), newGroup.type, credential);
      setVerifyResult(result);
    } catch (err) {
      setVerifyResult({ exists: false, error: err.message });
    } finally {
      setVerifying(false);
    }
  };

  const handleAddGroup = () => {
    if (!verifyResult?.exists) return;
    const entry = { name: verifyResult.name, type: newGroup.type };
    // Avoid duplicates
    const already = managedGroups.some(
      (g) => g.name.toLowerCase() === entry.name.toLowerCase() && g.type === entry.type
    );
    if (already) return;
    setConfig((c) => ({
      ...c,
      groups: { ...c.groups, managedGroups: [...managedGroups, entry] },
    }));
    setNewGroup({ name: '', type: 'local' });
    setVerifyResult(null);
  };

  if (!config) return <p className="text-gray-400">Loading...</p>;

  const isDomainGroupSelected = newGroup.type === 'domain';

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {msg && (
        <div
          className={`p-3 rounded text-sm ${
            msgType === 'error'
              ? 'bg-red-50 text-red-700'
              : 'bg-blue-50 text-blue-700'
          }`}
        >
          {msg}
        </div>
      )}

      {/* General settings */}
      <Section title="General">
        <Field
          label="Repository URL"
          value={config.repository?.url || ''}
          onChange={(v) => setNested('repository', 'url', v)}
        />
        <Field
          label="Repository Local Path"
          value={config.repository?.localPath || ''}
          onChange={(v) => setNested('repository', 'localPath', v)}
          onBrowse={async () => {
            const result = await browseFolder(config.repository?.localPath || '');
            if (result.path) setNested('repository', 'localPath', result.path);
          }}
          className="mt-3"
        />
        <Field
          label="Packages Base Path"
          value={config.packages?.basePath || ''}
          onChange={(v) => setNested('packages', 'basePath', v)}
          onBrowse={async () => {
            const result = await browseFolder(config.packages?.basePath || '');
            if (result.path) setNested('packages', 'basePath', result.path);
          }}
          className="mt-3"
        />
        <Field
          label="Server Port"
          value={config.server?.port || ''}
          onChange={(v) => setNested('server', 'port', parseInt(v) || 4000)}
          className="mt-3"
        />
        <Field
          label="PowerShell Path"
          value={config.execution?.powershellPath || ''}
          onChange={(v) => setNested('execution', 'powershellPath', v)}
          className="mt-3"
        />
      </Section>

      {/* Default Files settings */}
      <Section title="Default Files">
        <Field
          label="Default Files Source Path"
          hint="Folder containing Assets, SupportFiles, Strings, and Extensions subfolders to copy into new packages"
          value={config.defaultFiles?.sourcePath || ''}
          onChange={(v) => setNested('defaultFiles', 'sourcePath', v)}
          onBrowse={async () => {
            const result = await browseFolder(config.defaultFiles?.sourcePath || '');
            if (result.path) setNested('defaultFiles', 'sourcePath', result.path);
          }}
        />
        <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={config.defaultFiles?.copyOnCreate ?? false}
            onChange={(e) => setNested('defaultFiles', 'copyOnCreate', e.target.checked)}
            className="rounded"
          />
          <span className="text-sm font-medium text-gray-700">Copy default files when creating new packages</span>
        </label>
      </Section>

      {/* Script Runner settings */}
      <Section title="Script Runner">
        <Field
          label="Scripts Folder"
          hint="Folder containing PowerShell scripts to run from the Script Runner page"
          value={config.scripts?.folderPath || ''}
          onChange={(v) => setNested('scripts', 'folderPath', v)}
          onBrowse={async () => {
            const result = await browseFolder(config.scripts?.folderPath || '');
            if (result.path) setNested('scripts', 'folderPath', result.path);
          }}
        />
      </Section>

      {/* Code Signing Defaults */}
      <Section title="Code Signing Defaults">
        <Field
          label="Default Thumbprint"
          hint="Pre-fills the thumbprint field on Code Signing and MSI Builder pages"
          value={config.signing?.defaultThumbprint || ''}
          onChange={(v) => setNested('signing', 'defaultThumbprint', v)}
          placeholder="a9 09 50 2d d8 2a e4 14 33 e6 f8 38 86 b0 0d 42 77 a3 2a 7b"
          mono
        />
        <Field
          label="Default PFX Path"
          hint="Pre-fills the PFX path on Code Signing and MSI Builder pages (password is never saved)"
          value={config.signing?.defaultPfxPath || ''}
          onChange={(v) => setNested('signing', 'defaultPfxPath', v)}
          onBrowse={async () => {
            const result = await browseFile([{ name: 'PFX Certificate', extensions: ['pfx', 'p12'] }]);
            if (result.path) setNested('signing', 'defaultPfxPath', result.path);
          }}
          className="mt-3"
        />
        <Field
          label="Default Timestamp Server"
          value={config.signing?.defaultTimestamp || ''}
          onChange={(v) => setNested('signing', 'defaultTimestamp', v)}
          placeholder="http://timestamp.digicert.com"
          className="mt-3"
        />
      </Section>

      {/* Group management settings */}
      <Section title="Group Management">
        <Field
          label="Active Directory Domain"
          hint="Required for managing AD groups (e.g. contoso.com or CONTOSO)"
          value={config.groups?.adDomain || ''}
          onChange={(v) => setNested('groups', 'adDomain', v)}
          placeholder="contoso.com"
        />

        {/* Managed groups list */}
        <div className="mt-5">
          <p className="text-sm font-medium text-gray-700 mb-2">Managed Groups</p>
          <p className="text-xs text-gray-400 mb-3">
            These groups will appear on the Manage Groups page for adding/removing users.
          </p>

          {managedGroups.length > 0 ? (
            <div className="border rounded-lg divide-y mb-4">
              {managedGroups.map((g, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                      g.type === 'local'
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {g.type === 'local' ? 'Local' : 'Domain'}
                  </span>
                  <span className="text-sm flex-1">{g.name}</span>
                  <button
                    type="button"
                    onClick={() => removeGroup(i)}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic mb-4">No groups configured yet.</p>
          )}

          {/* Add group form */}
          <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add Group</p>
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <label className="block text-xs text-gray-500 mb-1">Type</label>
                <select
                  className="input text-sm"
                  value={newGroup.type}
                  onChange={(e) => {
                    setNewGroup((g) => ({ ...g, type: e.target.value }));
                    setVerifyResult(null);
                  }}
                >
                  <option value="local">Local</option>
                  <option value="domain">Domain (AD)</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Group Name</label>
                <input
                  className="input w-full text-sm"
                  placeholder={isDomainGroupSelected ? 'Domain Admins' : 'Administrators'}
                  value={newGroup.name}
                  onChange={(e) => {
                    setNewGroup((g) => ({ ...g, name: e.target.value }));
                    setVerifyResult(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyGroup()}
                />
              </div>
            </div>

            {isDomainGroupSelected && !config.groups?.adDomain && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle size={12} /> Set the AD Domain above before adding domain groups.
              </p>
            )}

            {/* Verify result */}
            {verifyResult && (
              <div
                className={`rounded p-3 text-sm ${
                  verifyResult.exists
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                {verifyResult.exists ? (
                  <div className="flex items-start gap-2">
                    <CheckCircle size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-800">{verifyResult.name}</p>
                      {verifyResult.description && (
                        <p className="text-xs text-green-600">{verifyResult.description}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-red-700">{verifyResult.error || 'Group not found.'}</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleVerifyGroup}
                disabled={verifying || !newGroup.name.trim()}
                className="btn-secondary text-sm"
              >
                {verifying ? (
                  <><Loader size={14} className="animate-spin" /> Verifying...</>
                ) : (
                  'Verify Group'
                )}
              </button>
              {verifyResult?.exists && (
                <button
                  type="button"
                  onClick={handleAddGroup}
                  className="btn-primary text-sm"
                >
                  <Plus size={14} /> Add to List
                </button>
              )}
            </div>
          </div>
        </div>
      </Section>

      <button onClick={handleSave} disabled={saving} className="btn-primary">
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>
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

function Field({ label, hint, value, onChange, onBrowse, className = '', placeholder = '', mono = false }) {
  const [browsing, setBrowsing] = useState(false);

  const handleBrowse = async () => {
    setBrowsing(true);
    try { await onBrowse(); } finally { setBrowsing(false); }
  };

  return (
    <div className={`block ${className}`}>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {hint && <span className="text-xs text-gray-400 ml-2">{hint}</span>}
      <div className="flex gap-2 mt-1">
        <input
          className={`input flex-1${mono ? ' font-mono text-xs' : ''}`}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {onBrowse && (
          <button
            type="button"
            onClick={handleBrowse}
            disabled={browsing}
            className="btn-secondary flex-shrink-0 flex items-center gap-1.5 px-3"
            title="Browse for folder"
          >
            {browsing ? <Loader size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            Browse
          </button>
        )}
      </div>
    </div>
  );
}
