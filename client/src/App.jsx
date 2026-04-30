import { useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import FindBar from './components/FindBar';
import {
  LayoutDashboard, PackagePlus, FolderOpen, Play, GitBranch, Settings,
  Monitor, Package, Archive, UsersRound, HelpCircle, ScrollText, X, ShieldCheck, Terminal, FileCode,
  ChevronsLeft, ChevronsRight, Moon, Sun,
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
import CodeSigning from './pages/CodeSigning';
import IntuneWin from './pages/IntuneWin';
import ManageGroups from './pages/ManageGroups';
import Help from './pages/Help';
import LogViewer from './pages/LogViewer';
import ScriptRunner from './pages/ScriptRunner';
import TemplateEditor from './pages/TemplateEditor';
import { TabGuardContext } from './context/TabGuardContext';

// ── Nav definition ────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { to: '/',              icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/create',        icon: PackagePlus,     label: 'Create Package' },
  { to: '/packages',      icon: FolderOpen,      label: 'Manage Packages' },
  { to: '/execution',     icon: Play,            label: 'Execution / Logs' },
  { to: '/msi-builder',   icon: Package,         label: 'MSI Builder' },
  { to: '/code-signing',  icon: ShieldCheck,     label: 'Code Signing' },
  { to: '/intune-win',    icon: Archive,         label: 'Intune Packager' },
  { to: '/manage-groups', icon: UsersRound,      label: 'Manage Groups' },
  { to: '/script-runner', icon: Terminal,         label: 'Script Runner' },
  { to: '/git',           icon: GitBranch,       label: 'Git' },
  { to: '/config',        icon: Settings,        label: 'Settings' },
  { to: '/templates',     icon: FileCode,        label: 'Template Editor' },
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
  '/code-signing':  CodeSigning,
  '/intune-win':    IntuneWin,
  '/manage-groups': ManageGroups,
  '/script-runner': ScriptRunner,
  '/templates':     TemplateEditor,
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

  // Auto-add a tab whenever the URL changes via any means (Link, navigate, browser back/forward)
  useEffect(() => {
    if (!isSubRoute) {
      setOpenTabs(prev => prev.includes(activeTo) ? prev : [...prev, activeTo]);
    }
  }, [activeTo, isSubRoute]);

  // Tab guard — pages register a fn that returns true when they have unsaved state
  const guardsRef = useRef(new Map());
  const registerGuard = useCallback((path, isDirtyFn) => {
    guardsRef.current.set(path, isDirtyFn);
    return () => guardsRef.current.delete(path);
  }, []);
  const canClose = useCallback((path) => {
    const fn = guardsRef.current.get(path);
    return !fn || !fn();
  }, []);

  // Scroll active tab into view whenever it changes
  const tabBarRef = useRef(null);
  const tabEls = useRef({});
  useEffect(() => {
    tabEls.current[activeTo]?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeTo]);

  // Pending close confirmation (replaces window.confirm to avoid breaking keyboard input)
  const [pendingClose, setPendingClose] = useState(null);

  const doClose = useCallback((to) => {
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

  const openTab = useCallback((to) => {
    setOpenTabs(prev => prev.includes(to) ? prev : [...prev, to]);
    navigate(to);
  }, [navigate]);

  const closeTab = useCallback((to, e) => {
    e.stopPropagation();
    if (!canClose(to)) {
      setPendingClose(to);
    } else {
      doClose(to);
    }
  }, [canClose, doClose]);

  const [navCollapsed, setNavCollapsed] = useState(
    () => localStorage.getItem('navCollapsed') === 'true'
  );
  const toggleNav = () => setNavCollapsed(c => {
    const next = !c;
    localStorage.setItem('navCollapsed', String(next));
    return next;
  });

  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
    document.querySelectorAll('iframe').forEach(frame => {
      try { frame.contentWindow.postMessage({ type: 'theme', theme }, '*'); } catch {}
    });
  }, [theme]);
  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  return (
    <TabGuardContext.Provider value={registerGuard}>
    <div className="flex h-screen overflow-hidden">
      <FindBar />

      {/* ── Sidebar ── */}
      <nav className={`${navCollapsed ? 'w-14' : 'w-56'} bg-gray-900 text-gray-300 flex flex-col shrink-0 transition-[width] duration-200 overflow-hidden`}>
        {/* Header */}
        {navCollapsed ? (
          <div className="flex flex-col items-center gap-1 py-3 border-b border-gray-700">
            <span className="text-white font-bold text-sm tracking-wide">DM</span>
            <button
              onClick={toggleNav}
              title="Expand sidebar"
              className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
            >
              <ChevronsRight size={15} />
            </button>
          </div>
        ) : (
          <div className="px-4 py-4 border-b border-gray-700 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-white font-bold text-base leading-tight truncate" style={{ fontSize: ".9rem" }}>Deployment Manager</div>
              <div className="text-gray-500 text-xs mt-0.5">v{__APP_VERSION__}</div>
            </div>
            <button
              onClick={toggleNav}
              title="Collapse sidebar"
              className="shrink-0 p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white mt-0.5"
            >
              <ChevronsLeft size={15} />
            </button>
          </div>
        )}

        {/* Nav items */}
        <div className="flex-1 py-2 overflow-y-auto min-h-0">
          {NAV_ITEMS.map((item, index) => {
            if (item.divider) {
              return <div key={`divider-${index}`} className="my-2 border-t border-gray-700" />;
            }
            const { to, icon: Icon, label } = item;
            const isActive = activeTo === to;
            const isOpen   = openTabs.includes(to);
            return navCollapsed ? (
              <button
                key={to}
                onClick={() => openTab(to)}
                title={label}
                className={`relative w-full flex items-center justify-center py-2.5 hover:bg-gray-800 ${
                  isActive ? 'bg-gray-800 text-white border-l-2 border-blue-500' : ''
                }`}
              >
                <Icon size={18} />
                {isOpen && !isActive && (
                  <span className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full bg-blue-400" />
                )}
              </button>
            ) : (
              <button
                key={to}
                onClick={() => openTab(to)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-800 ${
                  isActive ? 'bg-gray-800 text-white border-l-2 border-blue-500' : ''
                }`}
              >
                <Icon size={18} />
                <span className="flex-1">{label}</span>
                {isOpen && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Theme toggle */}
        <div className={`border-t border-gray-700 shrink-0 ${navCollapsed ? 'p-2 flex justify-center' : 'px-3 py-2 flex items-center justify-between'}`}>
          {!navCollapsed && <span className="text-xs text-gray-500"></span>}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </nav>

      {/* ── Right side: tab bar + content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Tab bar */}
        <div ref={tabBarRef} className="flex bg-gray-800 border-b border-gray-600 overflow-x-auto shrink-0">
          {openTabs.map(to => {
            const item = getNavItem(to);
            if (!item) return null;
            const { icon: Icon, label } = item;
            const isActive = activeTo === to;
            return (
              <div
                key={to}
                ref={el => { tabEls.current[to] = el; }}
                onClick={() => navigate(to)}
                style={isActive ? { background: 'var(--tab-active-bg)', color: 'var(--tab-active-text)' } : {}}
                className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer border-r border-gray-600 shrink-0 select-none ${
                  isActive
                    ? 'border-t-2 border-t-blue-500'
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
                        ? 'hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
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
                style={{ display: isActive ? 'block' : 'none', ...(isLogViewer ? {} : { background: 'var(--content-bg)' }) }}
                className={`absolute inset-0 ${isLogViewer ? '' : 'overflow-auto p-6'}`}
              >
                <Component />
              </div>
            );
          })}

          {/* Sub-route overlay: PackageDetail / EditPackage render on top when URL matches */}
          {isSubRoute && (
            <div className="absolute inset-0 overflow-auto p-6" style={{ background: 'var(--content-bg)' }}>
              <Routes>
                <Route path="/packages/:appName/:version/edit" element={<EditPackage />} />
                <Route path="/packages/:appName/:version"      element={<PackageDetail />} />
              </Routes>
            </div>
          )}

        </div>
      </div>
    </div>

    {/* Tab close confirmation modal */}
    {pendingClose && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="rounded-lg shadow-xl p-6 w-80 flex flex-col gap-4" style={{ background: 'var(--panel-bg)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-h)' }}>Close this tab?</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Credentials entered in this tab will be lost.
          </p>
          <div className="flex justify-end gap-2">
            <button
              autoFocus
              onClick={() => setPendingClose(null)}
              className="px-3 py-1.5 text-sm rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => { doClose(pendingClose); setPendingClose(null); }}
              className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700"
            >
              Close anyway
            </button>
          </div>
        </div>
      </div>
    )}
    </TabGuardContext.Provider>
  );
}
