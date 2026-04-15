import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Trash2, Play, Download } from 'lucide-react';
import { listPackages, deletePackage, runPackage } from '../api';

export default function ManagePackages() {
  const [packages, setPackages] = useState([]);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => listPackages().then(setPackages).catch(() => {});
  useEffect(() => { load(); }, []);

  const filtered = packages.filter(
    (p) => p.appName?.toLowerCase().includes(search.toLowerCase()) || p.vendor?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (appName, version) => {
    if (!confirm(`Delete ${appName} v${version}?`)) return;
    await deletePackage(appName, version);
    load();
  };

  const handleRun = async (appName, version) => {
    try {
      const result = await runPackage(appName, version, 'Silent');
      setMsg(`Execution started: ${result.id}`);
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Manage Packages</h1>
      {msg && <div className="bg-blue-50 text-blue-700 p-3 rounded mb-4">{msg}</div>}

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
    </div>
  );
}
