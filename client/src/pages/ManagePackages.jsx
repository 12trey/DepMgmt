import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Trash2, Play, Download, FolderInput, FolderOpen } from 'lucide-react';
import { listPackages, deletePackage, importPackage } from '../api';
import { useConfigContext } from '../context/ConfigContext';
import { usePackageChange } from '../context/PackageChangeContext'

export default function ManagePackages() {
  const [packages, setPackages] = useState([]);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null); // { appName, version }
  const navigate = useNavigate();
  const isElectron = !!window.electronAPI?.isElectron;


  const { changedPackage, setChangedPackage } = usePackageChange();

  const { configVersion } = useConfigContext();
  const load = () => listPackages().then(setPackages).catch(() => {});
  useEffect(() => { load(); }, [configVersion]);
  useEffect(() => { load(); }, [changedPackage]);

  const filtered = packages.filter(
    (p) => p.appName?.toLowerCase().includes(search.toLowerCase()) || p.vendor?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = (appName, version) => {
    setConfirmDialog({ appName, version });
  };

  const confirmDelete = async () => {
    const { appName, version } = confirmDialog;
    setConfirmDialog(null);
    await deletePackage(appName, version);
    load();
    setChangedPackage({appName: appName, changeTime: Date.now()});
  };

  const handleRun = (appName, version) => {
    navigate('/execution', { state: { appName, version } });
  };

  const handleImport = async () => {
    setError(''); setMsg('');
    let sourcePath = null;
    if (isElectron) {
      sourcePath = await window.electronAPI.pickFolder();
      if (!sourcePath) return;
    } else {
      sourcePath = prompt('Enter the full path to the PSADT package folder:');
      if (!sourcePath) return;
    }
    setImporting(true);
    try {
      const result = await importPackage(sourcePath);
      setMsg(`Imported: ${result.appName} v${result.version}`);
      load();
      navigate(`/packages/${result.appName}/${result.version}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
      configVersion();
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 mb-6">
        <FolderOpen size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold">Manage Packages</h1>
      </div>
        <button onClick={handleImport} disabled={importing} className="btn-secondary">
          <FolderInput size={16} /> {importing ? 'Importing…' : 'Import Package'}
        </button>
      </div>
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded mb-4">{msg}</div>}
      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
        <input
          className="input pl-10 w-full max-w-md"
          placeholder="Search packages..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Application</th>
              <th className="px-4 py-3 font-medium">Version</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">PSADT</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((p, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link to={`/packages/${p.appName}/${p.version}`} className="text-blue-600 hover:underline">
                    {p.appName}
                  </Link>
                </td>
                <td className="px-4 py-3">{p.version}</td>
                <td className="px-4 py-3">{p.vendor || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.psadtVersion === 'v4' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {p.psadtVersion === 'v4' ? 'v4.1.x' : 'v3'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{p.status || 'draft'}</span>
                </td>
                <td className="px-4 py-3 flex gap-2">
                  <button onClick={() => handleRun(p.appName, p.version)} className="text-green-600 hover:text-green-800" title="Run">
                    <Play size={16} />
                  </button>
                  <a href={`/api/packages/${p.appName}/${p.version}/download`} className="text-blue-600 hover:text-blue-800" title="Download ZIP">
                    <Download size={16} />
                  </a>
                  <button onClick={() => handleDelete(p.appName, p.version)} className="text-red-500 hover:text-red-700" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No packages found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">Delete Package</h2>
            <p className="text-gray-600 mb-6">
              Delete <span className="font-medium text-gray-900">{confirmDialog.appName}</span> v{confirmDialog.version}? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDialog(null)} className="btn-secondary">Cancel</button>
              <button onClick={confirmDelete} className="btn-danger">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
