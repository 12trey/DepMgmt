import { Routes, Route, NavLink } from 'react-router-dom';
import { LayoutDashboard, PackagePlus, FolderOpen, Play, GitBranch, Settings, Monitor, Package, Archive, UsersRound, HelpCircle } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import CreatePackage from './pages/CreatePackage';
import ManagePackages from './pages/ManagePackages';
import PackageDetail from './pages/PackageDetail';
import EditPackage from './pages/EditPackage';
import Execution from './pages/Execution';
import GitPanel from './pages/GitPanel';
import Config from './pages/Config';
import DMTTools from './pages/DMTTools';
import MsiBuilder from './pages/MsiBuilder';
import IntuneWin from './pages/IntuneWin';
import ManageGroups from './pages/ManageGroups';
import Help from './pages/Help';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/create', icon: PackagePlus, label: 'Create Package' },
  { to: '/packages', icon: FolderOpen, label: 'Manage Packages' },
  { to: '/execution', icon: Play, label: 'Execution / Logs' },
  { to: '/msi-builder', icon: Package, label: 'MSI Builder' },
  { to: '/intune-win', icon: Archive, label: 'Intune Packager' },
  { to: '/manage-groups', icon: UsersRound, label: 'Manage Groups' },
  { to: '/git', icon: GitBranch, label: 'Git' },
  { to: '/config', icon: Settings, label: 'Settings' },
  { divider: true },
  { to: '/dmt-tools', icon: Monitor, label: 'DMT Tools' },
  { divider: true },
  { to: '/help', icon: HelpCircle, label: 'Help' },
];

export default function App() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="w-56 bg-gray-900 text-gray-300 flex flex-col">
        <div className="px-4 py-5 text-white font-bold text-lg border-b border-gray-700">
          Deployment Manager
        </div>
        <div className="flex-1 py-3">
          {/* {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-800 ${isActive ? 'bg-gray-800 text-white border-l-2 border-blue-500' : ''}`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))} */}

          {navItems.map((item, index) => {
            if (item.divider) {
              return <div key={`divider-${index}`} className="my-2 border-t border-gray-700" />;
            }

            const { to, icon: Icon, label } = item;

            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-800 ${isActive ? 'bg-gray-800 text-white border-l-2 border-blue-500' : ''
                  }`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-50 p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/create" element={<CreatePackage />} />
          <Route path="/packages" element={<ManagePackages />} />
          <Route path="/packages/:appName/:version" element={<PackageDetail />} />
          <Route path="/packages/:appName/:version/edit" element={<EditPackage />} />
          <Route path="/execution" element={<Execution />} />
          <Route path="/git" element={<GitPanel />} />
          <Route path="/config" element={<Config />} />
          <Route path="/dmt-tools" element={<DMTTools />} />
          <Route path="/msi-builder" element={<MsiBuilder />} />
          <Route path="/intune-win" element={<IntuneWin />} />
          <Route path="/manage-groups" element={<ManageGroups />} />
          <Route path="/help" element={<Help />} />
        </Routes>
      </main>
    </div>
  );
}
