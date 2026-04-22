import { useState, useCallback } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import FindBar from './components/FindBar';
import {
  LayoutDashboard, PackagePlus, FolderOpen, Play, GitBranch, Settings,
  Monitor, Package, Archive, UsersRound, HelpCircle, ScrollText, X,
} from 'lucide-react';
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
import LogViewer from './pages/LogViewer';

// ── Nav definition ────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { to: '/',              icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/create',        icon: PackagePlus,     label: 'Create Package' },
  { to: '/packages',      icon: FolderOpen,      label: 'Manage Packages' },
  { to: '/execution',     icon: Play,            label: 'Execution / Logs' },
  { to: '/msi-builder',   icon: Package,         label: 'MSI Builder' },
  { to: '/intune-win',    icon: Archive,         label: 'Intune Packager' },
  { to: '/manage-groups', icon: UsersRound,      label: 'Manage Groups' },
  { to: '/git',           icon: GitBranch,       label: 'Git' },
  { to: '/config',        icon: Settings,        label: 'Settings' },
  { divider: true },
  { to: '/dmt-tools',    icon: Monitor,          label: 'DMT Tools' },
  { to: '/log-viewer',   icon: ScrollText,       label: 'Log Viewer' },
  { divider: true },
  { to: '/help',         icon: HelpCircle,       label: 'Help' },
];

const PAGE_COMPONENTS = {
  '/':              Dashboard,
  '/create':        CreatePackage,
  '/packages':      ManagePackages,
  '/execution':     Execution,
  '/msi-builder':   MsiBuilder,
  '/intune-win':    IntuneWin,
  '/manage-groups': ManageGroups,
  '/git':           GitPanel,
  '/config':        Config,
  '/dmt-tools':     DMTTools,
  '/log-viewer':    LogViewer,
  '/help':          Help,
};

// Resolve any URL to its top-level nav path
function topLevelOf(pathname) {
  if (pathname.startsWith('/packages')) return '/packages';
  const match = Object.keys(PAGE_COMPONENTS).find(p => p !== '/' && pathname.startsWith(p));
  return match || '/';
}

function getNavItem(to) {
  return NAV_ITEMS.find(item => !item.divider && item.to === to);
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const location = useLocation();
  const navigate  = useNavigate();

  // Which top-level path owns the current URL
  const activeTo = topLevelOf(location.pathname);

  // True when on a PackageDetail / EditPackage sub-route
  const isSubRoute = location.pathname.startsWith('/packages/') &&
                     location.pathname !== '/packages';

  // Open tabs: start with Dashboard + whatever page the URL is on
  const [openTabs, setOpenTabs] = useState(() => {
    const initial = new Set(['/']);
    initial.add(activeTo);
    return [...initial];
  });

  const openTab = useCallback((to) => {
    setOpenTabs(prev => prev.includes(to) ? prev : [...prev, to]);
    navigate(to);
  }, [navigate]);

  const closeTab = useCallback((to, e) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const next = prev.filter(t => t !== to);
      if (next.length === 0) return ['/'];
      if (activeTo === to) {
        const idx = prev.indexOf(to);
        navigate(next[Math.min(idx, next.length - 1)]);
      }
      return next;
    });
  }, [activeTo, navigate]);

  return (
    <div className="flex h-screen overflow-hidden">
      <FindBar />

      {/* ── Sidebar ── */}
      <nav className="w-56 bg-gray-900 text-gray-300 flex flex-col shrink-0">
        <div className="px-4 py-5 text-white font-bold text-lg border-b border-gray-700">
          Deployment Manager
        </div>
        <div className="flex-1 py-3 overflow-y-auto">
          {NAV_ITEMS.map((item, index) => {
            if (item.divider) {
              return <div key={`divider-${index}`} className="my-2 border-t border-gray-700" />;
            }
            const { to, icon: Icon, label } = item;
            const isActive = activeTo === to;
            const isOpen   = openTabs.includes(to);
            return (
              <button
                key={to}
                onClick={() => openTab(to)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-800 ${
                  isActive ? 'bg-gray-800 text-white border-l-2 border-blue-500' : ''
                }`}
              >
                <Icon size={18} />
                <span className="flex-1">{label}</span>
                {/* Dot indicator: tab is open but not active */}
                {isOpen && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Right side: tab bar + content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Tab bar */}
        <div className="flex bg-gray-800 border-b border-gray-600 overflow-x-auto shrink-0">
          {openTabs.map(to => {
            const item = getNavItem(to);
            if (!item) return null;
            const { icon: Icon, label } = item;
            const isActive = activeTo === to;
            return (
              <div
                key={to}
                onClick={() => navigate(to)}
                className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer border-r border-gray-600 shrink-0 select-none ${
                  isActive
                    ? 'bg-gray-50 text-gray-900 border-t-2 border-t-blue-500'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                <Icon size={14} />
                <span className="max-w-[140px] truncate">{label}</span>
                {openTabs.length > 1 && (
                  <button
                    onClick={(e) => closeTab(to, e)}
                    className={`ml-1 rounded p-0.5 ${
                      isActive
                        ? 'hover:bg-gray-300 text-gray-600 hover:text-gray-900'
                        : 'hover:bg-gray-600 text-gray-500 hover:text-gray-200'
                    }`}
                    title="Close tab"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-hidden relative">

          {/* All open tab pages — only the active one is visible, others are display:none */}
          {openTabs.map(to => {
            const Component = PAGE_COMPONENTS[to];
            const isActive    = activeTo === to && !isSubRoute;
            const isLogViewer = to === '/log-viewer';
            return (
              <div
                key={to}
                style={{ display: isActive ? 'block' : 'none' }}
                className={`absolute inset-0 ${isLogViewer ? '' : 'overflow-auto p-6 bg-gray-50'}`}
              >
                <Component />
              </div>
            );
          })}

          {/* Sub-route overlay: PackageDetail / EditPackage render on top when URL matches */}
          {isSubRoute && (
            <div className="absolute inset-0 overflow-auto p-6 bg-gray-50">
              <Routes>
                <Route path="/packages/:appName/:version/edit" element={<EditPackage />} />
                <Route path="/packages/:appName/:version"      element={<PackageDetail />} />
              </Routes>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
