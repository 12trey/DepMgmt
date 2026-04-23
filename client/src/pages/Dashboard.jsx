import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Package, Activity, CheckCircle, XCircle,
  PackagePlus, FolderOpen, Play, GitBranch, Archive, UsersRound, Monitor, Wrench, ScrollText, ShieldCheck,
} from 'lucide-react';
import { listPackages, listLogs } from '../api';

const FEATURES = [
  {
    icon: PackagePlus,
    label: 'PSADT Packages',
    color: 'blue',
    to: '/create',
    desc: 'Generate PowerShell App Deployment Toolkit packages (v3 and v4.1.x) from templates. Manage installer files, extensions, assets, and toolkit population.',
  },
  {
    icon: Play,
    label: 'Execution & Logs',
    color: 'green',
    to: '/execution',
    desc: 'Run deployment packages locally or against a remote target. Stream live stdout/stderr output and review historical execution logs.',
  },
  {
    icon: Wrench,
    label: 'MSI Builder',
    color: 'orange',
    to: '/msi-builder',
    desc: 'Author and build MSI installers using the WiX Toolset. Probe existing MSIs to extract product codes and upgrade codes for use in PSADT scripts.',
  },
  {
    icon: Archive,
    label: 'Intune Packager',
    color: 'purple',
    to: '/intune-win',
    desc: 'Wrap any installer into a .intunewin file for upload to Microsoft Intune. The app manages the Win32 Content Prep Tool automatically.',
  },
  {
    icon: ShieldCheck,
    label: 'Code Signing',
    color: 'amber',
    to: '/code-signing',
    desc: 'Authenticode-sign any executable, MSI, DLL, script, or cabinet file using a certificate from the Windows store or a PFX file — no SDK required.',
  },
  {
    icon: GitBranch,
    label: 'Git Integration',
    color: 'gray',
    to: '/git',
    desc: 'Clone, pull, and push a remote package repository. Publish individual packages directly from their detail view to version-control your deployments.',
  },
  {
    icon: UsersRound,
    label: 'Group Management',
    color: 'teal',
    to: '/manage-groups',
    desc: 'Query and manage on-premises Active Directory groups. Verify users, list members, and add or remove group memberships.',
  },
  {
    icon: Monitor,
    label: 'DMT Tools',
    color: 'indigo',
    to: '/dmt-tools',
    desc: 'Run Ansible playbooks against Windows endpoints directly from the browser via WSL. Includes an integrated terminal and one-click sync of app changes.',
  },
  {
    icon: ScrollText,
    label: 'Log Viewer',
    color: 'rose',
    to: '/log-viewer',
    desc: 'View and tail CMTrace, SCCM, and plain-text log files in real time. Includes EVTX event log browsing, Intune diagnostics, DSRegCmd analysis, and a live Ansible playbook log feed.',
  },
];

const FEATURE_COLORS = {
  blue:   { card: 'bg-blue-50',   icon: 'bg-blue-100 text-blue-600',     link: 'text-blue-600' },
  green:  { card: 'bg-green-50',  icon: 'bg-green-100 text-green-600',   link: 'text-green-600' },
  orange: { card: 'bg-orange-50', icon: 'bg-orange-100 text-orange-600', link: 'text-orange-600' },
  purple: { card: 'bg-purple-50', icon: 'bg-purple-100 text-purple-600', link: 'text-purple-600' },
  gray:   { card: 'bg-gray-50',   icon: 'bg-gray-100 text-gray-600',     link: 'text-gray-600' },
  teal:   { card: 'bg-teal-50',   icon: 'bg-teal-100 text-teal-600',     link: 'text-teal-600' },
  indigo: { card: 'bg-indigo-50', icon: 'bg-indigo-100 text-indigo-600', link: 'text-indigo-600' },
  rose:   { card: 'bg-rose-50',   icon: 'bg-rose-100 text-rose-600',     link: 'text-rose-600' },
  amber:  { card: 'bg-amber-50',  icon: 'bg-amber-100 text-amber-600',   link: 'text-amber-600' },
};

export default function Dashboard() {
  const navigate = useNavigate();
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
        <StatCard icon={Package}       label="Total Packages"   value={packages.length} color="blue" />
        <StatCard icon={Activity}      label="Total Executions" value={logs.length}     color="purple" />
        <StatCard icon={CheckCircle}   label="Successful"       value={successCount}    color="green" />
        <StatCard icon={XCircle}       label="Failed"           value={failedCount}     color="red" />
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold text-lg mb-3">Packages</h2>
          {packages.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No packages yet.{' '}
              <Link to="/create" className="text-blue-600 hover:underline">Create one</Link>
            </p>
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

      {/* Feature overview */}
      <div className="mb-2">
        <h2 className="text-lg font-semibold mb-1">Features</h2>
        <p className="text-sm text-gray-500 mb-4">
          Everything available in this app — click any card to open that tool.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {FEATURES.map(({ icon: Icon, label, color, to, desc }) => {
            const c = FEATURE_COLORS[color];
            return (
              <button
                key={to}
                onClick={() => navigate(to)}
                className={`${c.card} rounded-lg p-4 border border-transparent hover:border-gray-200 hover:shadow-sm transition-all group text-left w-full`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`p-2 rounded-lg ${c.icon}`}>
                    <Icon size={18} />
                  </div>
                  <span className={`font-semibold text-sm ${c.link} group-hover:underline`}>{label}</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{desc}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    red:    'bg-red-50 text-red-600',
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
    draft:     'bg-gray-100 text-gray-700',
    ready:     'bg-blue-100 text-blue-700',
    published: 'bg-green-100 text-green-700',
    imported:  'bg-purple-100 text-purple-700',
    Success:   'bg-green-100 text-green-700',
    Failed:    'bg-red-100 text-red-700',
    Running:   'bg-yellow-100 text-yellow-700',
    Pending:   'bg-blue-100 text-blue-700',
    Completed: 'bg-green-100 text-green-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
      {status}
    </span>
  );
}
