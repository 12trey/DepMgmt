import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, Trash2, FileText, Download, RefreshCw, Pencil, GitBranch, AlertTriangle } from 'lucide-react';
import { getPackage, listFiles, uploadFiles, deleteFile, regeneratePackage, checkMissingFiles, gitPublish, updatePackage } from '../api';

export default function PackageDetail() {
  const { appName, version } = useParams();
  const navigate = useNavigate();
  const [pkg, setPkg] = useState(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [missingFiles, setMissingFiles] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const fileInputRef = useRef();

  const load = async () => {
    try {
      const [p, f, m] = await Promise.all([
        getPackage(appName, version),
        listFiles(appName, version),
        checkMissingFiles(appName, version),
      ]);
      setPkg(p);
      setFiles(f);
      setMissingFiles(m.missing || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, [appName, version]);

  const handleUpload = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    try {
      await uploadFiles(appName, version, selected);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteFile = async (filename) => {
    await deleteFile(appName, version, filename);
    load();
  };

  const handleRegenerate = async () => {
    setMsg('');
    try {
      await regeneratePackage(appName, version);
      setMsg('Scripts regenerated from current templates.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleStatus = async () => {
    const next = pkg.status === 'ready' ? 'draft' : 'ready';
    try {
      const updated = await updatePackage(appName, version, { status: next });
      setPkg(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePublish = async () => {
    setMsg(''); setError('');
    setPublishing(true);
    try {
      const result = await gitPublish(appName, version);
      setMsg(result.message);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  if (error) return <div className="bg-red-50 text-red-700 p-4 rounded">{error}</div>;
  if (!pkg) return <p>Loading...</p>;

  return (
    <div className="max-w-3xl">
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded mb-4">{msg}</div>}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">{pkg.appName}</h1>
          <div className="flex items-center gap-2 text-gray-500">
            <span>Version {pkg.version} {pkg.vendor && `by ${pkg.vendor}`}</span>
            <StatusBadge status={pkg.status || 'draft'} onClick={pkg.status !== 'published' ? handleToggleStatus : undefined} />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate(`/packages/${appName}/${version}/edit`)} className="btn-secondary" title="Edit package settings">
            <Pencil size={16} /> Edit
          </button>
          <button onClick={handleRegenerate} className="btn-secondary" title="Regenerate scripts from current templates">
            <RefreshCw size={16} /> Regenerate Scripts
          </button>
          <button onClick={handlePublish} disabled={publishing} className="btn-secondary" title="Commit package to Git repository">
            <GitBranch size={16} /> {publishing ? 'Publishing…' : 'Publish to Repo'}
          </button>
          <a
            href={`/api/packages/${appName}/${version}/download`}
            className="btn-primary"
          >
            <Download size={16} /> Download ZIP
          </a>
        </div>
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <h2 className="font-semibold mb-3">Package Details</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">PSADT Version</dt>
          <dd>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${pkg.psadtVersion === 'v4' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
              {pkg.psadtVersion === 'v4' ? 'v4.1.x' : 'v3'}
            </span>
          </dd>
          <dt className="text-gray-500">Architecture</dt><dd>{pkg.architecture || 'x64'}</dd>
          <dt className="text-gray-500">Entry Script</dt><dd className="font-mono text-xs">{pkg.psadtVersion === 'v4' ? 'Invoke-AppDeployToolkit.ps1' : 'Deploy-Application.ps1'}</dd>
          <dt className="text-gray-500">Install Command</dt><dd className="font-mono text-xs">{pkg.installCommand || '—'}</dd>
          <dt className="text-gray-500">Uninstall Command</dt><dd className="font-mono text-xs">{pkg.uninstallCommand || '—'}</dd>
          <dt className="text-gray-500">Detection</dt><dd>{pkg.detection?.type || '—'}</dd>
          <dt className="text-gray-500">Created</dt><dd>{pkg.createdAt ? new Date(pkg.createdAt).toLocaleString() : '—'}</dd>
        </dl>
      </div>

      {/* Missing files warning */}
      {missingFiles.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-amber-800 font-medium mb-2">
            <AlertTriangle size={16} /> Required installer files are missing
          </div>
          <p className="text-sm text-amber-700 mb-2">This package was published to the Git repository but the following installer files are not present in the <span className="font-mono">Files/</span> folder. The package cannot be deployed until they are uploaded.</p>
          <ul className="text-sm text-amber-800 space-y-1">
            {missingFiles.map((f) => (
              <li key={f.name} className="flex items-center gap-3 font-mono">
                <span>{f.name}</span>
                <span className="text-amber-500 font-sans">{(f.size / 1048576).toFixed(1)} MB</span>
                <span className="text-amber-400 font-sans text-xs truncate">{f.sha256}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Files */}
      <div className="bg-white rounded-lg shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Installer Files</h2>
          <button onClick={() => fileInputRef.current.click()} className="btn-secondary text-sm">
            <Upload size={16} /> Upload Files
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
        </div>
        {files.length === 0 ? (
          <p className="text-gray-500 text-sm">No files uploaded yet.</p>
        ) : (
          <ul className="divide-y">
            {files.map((f) => (
              <li key={f} className="py-2 flex justify-between items-center text-sm">
                <span className="flex items-center gap-2"><FileText size={16} className="text-gray-400" /> {f}</span>
                <button onClick={() => handleDeleteFile(f)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, onClick }) {
  const styles = {
    draft:      'bg-gray-100 text-gray-700',
    ready:      'bg-blue-100 text-blue-700',
    published:  'bg-green-100 text-green-700',
    imported:   'bg-purple-100 text-purple-700',
  };
  const style = styles[status] || styles.draft;
  const title = onClick ? (status === 'ready' ? 'Click to revert to draft' : 'Click to mark as ready') : undefined;
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${style} ${onClick ? 'cursor-pointer hover:opacity-75' : ''}`}
      onClick={onClick}
      title={title}
    >
      {status}
    </span>
  );
}
