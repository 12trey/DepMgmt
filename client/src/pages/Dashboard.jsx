import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Activity, CheckCircle, XCircle } from 'lucide-react';
import { listPackages, listLogs } from '../api';

export default function Dashboard() {
  const [packages, setPackages] = useState([]);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    listPackages().then(setPackages).catch(() => {});
    listLogs().then(setLogs).catch(() => {});
  }, []);

  const recent = logs.slice(0, 5);
  const successCount = logs.filter((l) => l.status === 'Success').length;
  const failedCount = logs.filter((l) => l.status === 'Failed').length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Package} label="Total Packages" value={packages.length} color="blue" />
        <StatCard icon={Activity} label="Total Executions" value={logs.length} color="purple" />
        <StatCard icon={CheckCircle} label="Successful" value={successCount} color="green" />
        <StatCard icon={XCircle} label="Failed" value={failedCount} color="red" />
      </div>

      {/* Recent packages */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold text-lg mb-3">Packages</h2>
          {packages.length === 0 ? (
            <p className="text-gray-500 text-sm">No packages yet. <Link to="/create" className="text-blue-600 hover:underline">Create one</Link></p>
          ) : (
            <ul className="divide-y">
              {packages.slice(0, 8).map((p, i) => (
                <li key={i} className="py-2 flex justify-between">
                  <Link to={`/packages/${p.appName}/${p.version}`} className="text-blue-600 hover:underline">
                    {p.appName} v{p.version}
                  </Link>
                  <StatusBadge status={p.status || 'draft'} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold text-lg mb-3">Recent Executions</h2>
          {recent.length === 0 ? (
            <p className="text-gray-500 text-sm">No executions yet.</p>
          ) : (
            <ul className="divide-y">
              {recent.map((l) => (
                <li key={l.id} className="py-2 flex justify-between text-sm">
                  <span>{l.appName} v{l.version}</span>
                  <StatusBadge status={l.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${colors[color]}`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    draft: 'bg-gray-100 text-gray-700',
    Success: 'bg-green-100 text-green-700',
    Failed: 'bg-red-100 text-red-700',
    Running: 'bg-yellow-100 text-yellow-700',
    Pending: 'bg-blue-100 text-blue-700',
    Completed: 'bg-green-100 text-green-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
      {status}
    </span>
  );
}
