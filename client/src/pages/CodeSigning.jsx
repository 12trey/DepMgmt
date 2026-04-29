import { useRef, useState, useEffect } from 'react';
import { ShieldCheck, Upload, X, AlertCircle, CheckCircle, FileText } from 'lucide-react';
import { getConfig } from '../api';

const SIGNABLE_EXTS = new Set([
  '.msi', '.exe', '.dll', '.cab', '.sys', '.ocx', '.cat',
  '.ps1', '.psm1', '.psd1', '.appx', '.appxbundle', '.msix',
]);

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export default function CodeSigning() {
  // Target file
  const [targetFile, setTargetFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCount = useRef(0);
  const fileInputRef = useRef();

  // Signing options
  const [method, setMethod] = useState('thumbprint'); // 'thumbprint' | 'pfx'
  const [thumbprint, setThumbprint] = useState('');
  const [pfxFile, setPfxFile] = useState(null);   // File object when user picks locally
  const [pfxPath, setPfxPath] = useState('');     // path shown in UI (default or filename)
  const [pfxPassword, setPfxPassword] = useState('');
  const [timestamp, setTimestamp] = useState('http://timestamp.digicert.com');
  const pfxInputRef = useRef();

  useEffect(() => {
    getConfig().then(cfg => {
      const s = cfg.signing || {};
      if (s.defaultThumbprint) setThumbprint(s.defaultThumbprint);
      if (s.defaultPfxPath)    { setPfxPath(s.defaultPfxPath); }
      if (s.defaultTimestamp)  setTimestamp(s.defaultTimestamp);
    }).catch(() => {});
  }, []);

  // Status
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const extOf = f => f ? ('.' + f.name.split('.').pop()).toLowerCase() : '';
  const isKnownSignable = f => SIGNABLE_EXTS.has(extOf(f));

  const pickTarget = (file) => {
    if (!file) return;
    setTargetFile(file);
    setError('');
    setSuccess(false);
  };

  const handleDrop = e => {
    e.preventDefault();
    dragCount.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickTarget(file);
  };

  const canSign = targetFile &&
    (method === 'thumbprint' ? thumbprint.trim() : pfxPath.trim());

  const handleSign = async () => {
    setError(''); setSuccess(false); setSigning(true);
    try {
      const signingPayload = {
        method,
        timestamp: timestamp.trim() || undefined,
        ...(method === 'thumbprint'
          ? { thumbprint: thumbprint.trim() }
          : { pfxPassword, ...(pfxFile ? {} : { pfxPath }) }),
      };

      const formData = new FormData();
      formData.append('file', targetFile);
      formData.append('signing', JSON.stringify(signingPayload));
      if (method === 'pfx' && pfxFile) {
        formData.append('pfxFile', pfxFile);
      }

      const res = await fetch('/api/sign/file', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Signing failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), {
        href: url, download: targetFile.name,
      });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold">Code Signing</h1>
      </div>

      {/* Drop zone */}
      <div
        className={`rounded-lg border-2 border-dashed transition-colors mb-5 cursor-pointer
          ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400'}`}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDragEnter={e => { e.preventDefault(); dragCount.current++; setDragOver(true); }}
        onDragLeave={e => {
          e.preventDefault();
          dragCount.current = Math.max(0, dragCount.current - 1);
          if (dragCount.current === 0) setDragOver(false);
        }}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={e => pickTarget(e.target.files?.[0])}
        />

        {targetFile ? (
          <div className="flex items-center gap-3 p-5">
            <FileText size={32} className="text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{targetFile.name}</p>
              <p className="text-sm text-gray-500">{formatBytes(targetFile.size)}</p>
              {!isKnownSignable(targetFile) && (
                <p className="text-xs text-amber-600 mt-0.5">
                  Unrecognised extension — Authenticode signing may not apply to this file type.
                </p>
              )}
            </div>
            <button
              className="text-gray-400 hover:text-gray-700 flex-shrink-0 p-1"
              onClick={e => { e.stopPropagation(); setTargetFile(null); setSuccess(false); setError(''); }}
              title="Remove file"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Upload size={28} className="text-gray-400" />
            <p className="text-sm font-medium text-gray-700">Drop a file here, or click to browse</p>
            <p className="text-xs text-gray-400">
              .exe, .dll, .msi, .cab, .ps1, .psm1, .sys, .appx, .msix and more
            </p>
          </div>
        )}
      </div>

      {/* Certificate */}
      <div className="bg-white rounded-lg shadow p-5 mb-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Certificate</h2>

        <div className="flex gap-6">
          {[['thumbprint', 'Certificate Store (thumbprint)'], ['pfx', 'PFX File']].map(([val, label]) => (
            <label key={val} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="method"
                checked={method === val}
                onChange={() => setMethod(val)}
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>

        {method === 'thumbprint' && (
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Thumbprint <span className="text-red-500">*</span></span>
            <input
              className="input mt-1 w-full font-mono text-xs"
              placeholder="e.g. a9 09 50 2d d8 2a e4 14 33 e6 f8 38 86 b0 0d 42 77 a3 2a 7b"
              value={thumbprint}
              onChange={e => setThumbprint(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-0.5">
              Paste from certmgr.msc — spaces and colons are ignored. Searches both
              LocalMachine\My and CurrentUser\My.
            </p>
          </label>
        )}

        {method === 'pfx' && (
          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium text-gray-700 block mb-1">PFX File <span className="text-red-500">*</span></span>
              <div className="flex items-center gap-2">
                <input
                  ref={pfxInputRef}
                  type="file"
                  accept=".pfx,.p12"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setPfxFile(f);
                    setPfxPath(f ? f.name : '');
                  }}
                />
                <button className="btn-secondary text-sm" onClick={() => pfxInputRef.current?.click()}>
                  Browse…
                </button>
                {pfxPath
                  ? <span className="text-sm text-gray-700 font-mono">{pfxPath}</span>
                  : <span className="text-sm text-gray-400">No file selected</span>
                }
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Set a default PFX path in Settings to avoid re-browsing each session.
              </p>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">PFX Password</span>
              <input
                type="password"
                className="input mt-1 w-64"
                autoComplete="off"
                value={pfxPassword}
                onChange={e => setPfxPassword(e.target.value)}
                placeholder="Leave blank if no password"
              />
              <p className="text-xs text-gray-400 mt-0.5">Password is never saved.</p>
            </label>
          </div>
        )}

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Timestamp Server</span>
          <input
            className="input mt-1 w-full"
            value={timestamp}
            onChange={e => setTimestamp(e.target.value)}
            placeholder="http://timestamp.digicert.com"
          />
          <p className="text-xs text-gray-400 mt-0.5">
            Recommended — prevents the signature from expiring when the certificate does.
            Leave blank to skip.
          </p>
        </label>
      </div>

      {/* Action */}
      <div className="bg-white rounded-lg shadow p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Sign File</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {targetFile
                ? `Ready to sign ${targetFile.name}`
                : 'Select a file above to continue'}
            </p>
          </div>
          <button
            onClick={handleSign}
            disabled={signing || !canSign}
            className="btn-primary"
          >
            <ShieldCheck size={15} />
            {signing ? 'Signing…' : 'Sign & Download'}
          </button>
        </div>

        {success && !error && (
          <div className="flex items-center gap-2 mt-4 text-green-700 bg-green-50 border border-green-200 rounded p-3 text-sm">
            <CheckCircle size={15} /> File signed and downloaded successfully.
          </div>
        )}
        {error && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-red-700 text-sm font-medium mb-1">
              <AlertCircle size={15} /> Signing failed
            </div>
            <pre className="bg-gray-900 text-red-300 text-xs rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap font-mono">{error}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
