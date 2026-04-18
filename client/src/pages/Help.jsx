import { useState } from 'react';
import {
  PackagePlus, FolderOpen, Play, GitBranch, Settings, Monitor,
  Package, Archive, UsersRound, PuzzleIcon, FileText, Image,
  Code2, FolderOpen as FolderIcon, Wrench, ChevronRight,
} from 'lucide-react';

const SECTIONS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'packages',     label: 'Package Management' },
  { id: 'folders',      label: 'Package Folders' },
  { id: 'extensions',   label: 'Extensions' },
  { id: 'execution',    label: 'Execution' },
  { id: 'msi',          label: 'MSI Builder' },
  { id: 'intune',       label: 'Intune Packager' },
  { id: 'git',          label: 'Git Integration' },
  { id: 'groups',       label: 'Group Management' },
  { id: 'dmt',          label: 'DMT Tools' },
];

function Section({ id, title, icon: Icon, children }) {
  return (
    <section id={id} className="mb-10 scroll-mt-4">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-200">
        {Icon && <Icon size={20} className="text-blue-600" />}
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function Callout({ type = 'info', children }) {
  const styles = {
    info:  'bg-blue-50 border-blue-200 text-blue-800',
    tip:   'bg-green-50 border-green-200 text-green-800',
    warn:  'bg-amber-50 border-amber-200 text-amber-800',
  };
  return (
    <div className={`border rounded-lg p-3 text-xs ${styles[type]}`}>
      {children}
    </div>
  );
}

function Step({ n, children }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">{n}</span>
      <span>{children}</span>
    </div>
  );
}

function Code({ children }) {
  return <code className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded font-mono text-xs">{children}</code>;
}

export default function Help() {
  const [active, setActive] = useState('overview');

  const scrollTo = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex gap-6 max-w-5xl">
      {/* Sticky table of contents */}
      <aside className="w-44 shrink-0">
        <div className="sticky top-0 bg-white rounded-lg shadow p-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Contents</p>
          <nav className="space-y-0.5">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
                  active === s.id
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <ChevronRight size={10} className={active === s.id ? 'text-blue-500' : 'text-gray-300'} />
                {s.label}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-bold mb-6">Help &amp; Reference</h1>

        {/* ── Overview ── */}
        <Section id="overview" title="Overview">
          <p>
            <strong>Deployment Manager</strong> is a browser-based tool for building, managing, and
            deploying Windows application packages. It replaces the manual PSADT "Master Wrapper"
            workflow with a guided UI, and also bundles tools for MSI authoring, Intune packaging,
            group management, and Ansible-based deployments via WSL.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {[
              { icon: PackagePlus,  label: 'PSADT Packages',   desc: 'Generate v3 / v4 deployment packages from templates.' },
              { icon: Play,         label: 'Execution',         desc: 'Run packages and stream live deployment logs.' },
              { icon: Package,      label: 'MSI Builder',       desc: 'Author and build MSI installers.' },
              { icon: Archive,      label: 'Intune Packager',   desc: 'Wrap installers into .intunewin files.' },
              { icon: GitBranch,    label: 'Git Integration',   desc: 'Version-control your package repository.' },
              { icon: UsersRound,   label: 'Group Management',  desc: 'Query and manage AD / Azure AD groups.' },
              { icon: Monitor,      label: 'DMT Tools',         desc: 'Ansible playbook execution via WSL.' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex gap-2 p-2 bg-gray-50 rounded border border-gray-100">
                <Icon size={16} className="text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-xs">{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Package Management ── */}
        <Section id="packages" title="Package Management" icon={PackagePlus}>
          <p>
            Packages are generated from Handlebars templates and stored under the configured
            packages directory. Each package has an <strong>app name</strong>, a <strong>version</strong>,
            and a <strong>PSADT version</strong> (v3 or v4.1.x).
          </p>

          <h3 className="font-semibold mt-4 mb-1">Creating a package</h3>
          <div className="space-y-1.5">
            <Step n={1}>Go to <strong>Create Package</strong> and fill in the app name, version, vendor, and architecture.</Step>
            <Step n={2}>Select <strong>PSADT Version</strong>. Use v4.1.x for new packages — it offers a richer API and automatic module loading.</Step>
            <Step n={3}>Optionally drag-and-drop an installer (.msi or .exe). The app auto-generates install/uninstall commands based on the file type.</Step>
            <Step n={4}>Click <strong>Create Package</strong>. The entry script and config are written from templates.</Step>
            <Step n={5}>Open the package and use the tabs to upload files, populate the toolkit, and edit extensions.</Step>
          </div>

          <h3 className="font-semibold mt-4 mb-1">PSADT v3 vs v4</h3>
          <div className="overflow-x-auto">
            <table className="text-xs w-full border border-gray-200 rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 border-b">Feature</th>
                  <th className="text-left p-2 border-b">v3</th>
                  <th className="text-left p-2 border-b">v4.1.x</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Entry script',    'Deploy-Application.ps1',     'Invoke-AppDeployToolkit.ps1'],
                  ['Config',          'AppDeployToolkitConfig.xml', 'Config/Config.psd1'],
                  ['Cmdlet prefix',   'None (Execute-Process…)',    'ADT (Start-ADTProcess…)'],
                  ['Module loading',  'Dot-source .ps1 files',      'Import-Module PSAppDeployToolkit'],
                  ['Extensions',      'Not supported',               'PSAppDeployToolkit.Extensions/'],
                  ['Custom assets',   'Assets/ folder',             'Assets/ folder'],
                ].map(([feature, v3, v4]) => (
                  <tr key={feature} className="border-b last:border-0">
                    <td className="p-2 font-medium text-gray-600">{feature}</td>
                    <td className="p-2">{v3}</td>
                    <td className="p-2 text-purple-700">{v4}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="font-semibold mt-4 mb-1">Package statuses</h3>
          <ul className="space-y-1 text-xs">
            <li><strong>draft</strong> — work in progress, not yet ready to deploy.</li>
            <li><strong>ready</strong> — marked ready; click the badge in the detail view to toggle.</li>
            <li><strong>published</strong> — committed to the Git repository.</li>
            <li><strong>imported</strong> — brought in via <em>Import from path</em>.</li>
          </ul>
        </Section>

        {/* ── Package Folders ── */}
        <Section id="folders" title="Package Folders" icon={FolderIcon}>
          <p>
            Every v4 package contains the following subfolders. Click the corresponding tab in the
            package detail view to manage each one.
          </p>
          {[
            {
              name: 'Files/',
              var: '$dirFiles',
              icon: FileText,
              desc: 'Installer files (.msi, .exe, etc.). Reference them in scripts as',
              extra: '. Upload via the Installer Files tab.',
            },
            {
              name: 'SupportFiles/',
              var: '$dirSupportFiles',
              icon: FileText,
              desc: 'Helper files: registry (.reg), config XMLs/INIs, batch scripts, license files. Reference as',
              extra: '.',
            },
            {
              name: 'Assets/',
              var: null,
              icon: Image,
              desc: 'Custom branding PNGs and ICO for toolkit dialogs. Leave empty to use toolkit defaults from PSAppDeployToolkit/Assets/.',
              extra: '',
            },
            {
              name: 'PSAppDeployToolkit.Extensions/',
              var: null,
              icon: PuzzleIcon,
              desc: 'Custom PowerShell module auto-loaded by the toolkit. Add functions to the .psm1 and export them in the .psd1.',
              extra: '',
            },
            {
              name: 'PSAppDeployToolkit/',
              var: null,
              icon: Code2,
              desc: 'Core toolkit module files. Populate from the installed PowerShell module via the Toolkit tab.',
              extra: '',
            },
            {
              name: 'Config/',
              var: null,
              icon: Settings,
              desc: 'Contains Config.psd1 — generated from the template. Edit via Regenerate Scripts after changing package metadata.',
              extra: '',
            },
          ].map(f => (
            <div key={f.name} className="flex gap-3 p-3 bg-gray-50 rounded border border-gray-100">
              <f.icon size={16} className="text-gray-400 shrink-0 mt-0.5" />
              <div>
                <Code>{f.name}</Code>
                {f.var && <> — referenced in scripts as <Code>{f.var}</Code></>}
                <p className="mt-0.5 text-gray-600">{f.desc}{f.var && f.extra}</p>
              </div>
            </div>
          ))}
          <Callout type="tip">
            v3 packages only have <Code>Files/</Code>. The extra folders are v4-only.
          </Callout>
        </Section>

        {/* ── Extensions ── */}
        <Section id="extensions" title="Extensions" icon={PuzzleIcon}>
          <p>
            The <Code>PSAppDeployToolkit.Extensions/</Code> folder lets you add custom PowerShell
            functions that the toolkit loads automatically — no dot-sourcing or manual imports needed.
          </p>
          <h3 className="font-semibold mt-3 mb-1">Editing an extension</h3>
          <div className="space-y-1.5">
            <Step n={1}>Open the package → <strong>Extensions</strong> tab.</Step>
            <Step n={2}>If the folder is empty (e.g. an older package), click <strong>Create stub files</strong> in the info banner.</Step>
            <Step n={3}>Click the <strong>pencil icon</strong> on <Code>PSAppDeployToolkit.Extensions.psm1</Code>.</Step>
            <Step n={4}>Write your function(s) in the editor and click <strong>Save</strong>.</Step>
            <Step n={5}>If you want to call the function from the main script, open <Code>PSAppDeployToolkit.Extensions.psd1</Code> and add the function name to <Code>FunctionsToExport</Code>.</Step>
          </div>
          <Callout type="info">
            <strong>Tip:</strong> Use <Code>Write-ADTLogEntry</Code> inside extension functions for consistent logging in the PSADT log file.
          </Callout>
          <h3 className="font-semibold mt-3 mb-1">Example extension function</h3>
          <pre className="bg-gray-950 text-gray-100 rounded p-3 text-xs font-mono overflow-x-auto">{`function Invoke-MyCustomAction {
    [CmdletBinding()]
    param(
        [string]$Message = 'Running custom action...'
    )
    Write-ADTLogEntry -Message $Message
    # your logic here
}`}</pre>
        </Section>

        {/* ── Execution ── */}
        <Section id="execution" title="Execution" icon={Play}>
          <p>
            The <strong>Execution</strong> page runs a PSADT package on a target machine and
            streams stdout/stderr in real time over WebSocket.
          </p>
          <h3 className="font-semibold mt-3 mb-1">Running a package</h3>
          <div className="space-y-1.5">
            <Step n={1}>Select the package and version.</Step>
            <Step n={2}>Choose <strong>Deploy Mode</strong> (Silent, Interactive, NonInteractive).</Step>
            <Step n={3}>Choose <strong>Deployment Type</strong> (Install, Uninstall, Repair).</Step>
            <Step n={4}>Optionally specify a remote target, username, and password for remote execution.</Step>
            <Step n={5}>Click <strong>Run</strong>. Output streams live; all runs are saved to the execution log.</Step>
          </div>
          <Callout type="warn">
            Remote execution uses PowerShell remoting (WinRM). Ensure the target has remoting enabled
            and the provided credentials have sufficient rights.
          </Callout>
        </Section>

        {/* ── MSI Builder ── */}
        <Section id="msi" title="MSI Builder" icon={Package}>
          <p>
            Build an MSI installer from a source directory without writing WiX XML by hand.
            The app wraps <Code>candle.exe</Code> / <Code>light.exe</Code> (WiX Toolset) or
            another configured MSI tool.
          </p>
          <div className="space-y-1.5">
            <Step n={1}>Go to <strong>MSI Builder</strong> and check tool availability with the <em>Detect Tools</em> status.</Step>
            <Step n={2}>Fill in product name, version, manufacturer, and the source folder to package.</Step>
            <Step n={3}>Click <strong>Build MSI</strong>. Progress streams live; the finished <Code>.msi</Code> is available for download.</Step>
          </div>
          <Callout type="tip">
            Use the <strong>Probe MSI</strong> feature on an existing MSI to extract product code,
            upgrade code, and version for use in your PSADT install/uninstall commands.
          </Callout>
        </Section>

        {/* ── Intune Packager ── */}
        <Section id="intune" title="Intune Packager" icon={Archive}>
          <p>
            Wraps any installer into a <Code>.intunewin</Code> file for upload to Microsoft Intune.
            Uses Microsoft's <strong>Win32 Content Prep Tool</strong>
            (<Code>IntuneWinAppUtil.exe</Code>).
          </p>
          <div className="space-y-1.5">
            <Step n={1}>Go to <strong>Intune Packager</strong>. The app checks whether the tool is present and can download it automatically.</Step>
            <Step n={2}>Specify the source folder, setup file, and output folder.</Step>
            <Step n={3}>Click <strong>Build</strong>. The <Code>.intunewin</Code> file is saved to the output folder.</Step>
          </div>
          <Callout type="info">
            The typical workflow is: build your PSADT package → download the ZIP → wrap the ZIP
            root as the source folder so Intune receives the full deployment package.
          </Callout>
        </Section>

        {/* ── Git Integration ── */}
        <Section id="git" title="Git Integration" icon={GitBranch}>
          <p>
            The <strong>Git</strong> page connects to a remote package repository so you can
            version-control and distribute PSADT packages across your team.
          </p>
          <div className="space-y-1.5">
            <Step n={1}>Go to <strong>Settings</strong> and configure the repository URL, base packages path, and optionally a branch name.</Step>
            <Step n={2}>On the <strong>Git</strong> page, click <strong>Clone</strong> to pull the repository locally.</Step>
            <Step n={3}>Use <strong>Pull</strong> to fetch updates and <strong>Push</strong> to upload committed changes.</Step>
            <Step n={4}>From a package's detail page, click <strong>Publish to Repo</strong> to stage and commit that package's files automatically.</Step>
          </div>
          <Callout type="warn">
            Large installer files (.msi, .exe) in <Code>Files/</Code> are not tracked by Git — only
            the deployment scripts and metadata are committed. The <em>Missing Files</em> warning
            in the package detail view flags any files that were published but are not currently
            present on disk.
          </Callout>
        </Section>

        {/* ── Group Management ── */}
        <Section id="groups" title="Group Management" icon={UsersRound}>
          <p>
            Query and manage Active Directory (on-prem) or Azure AD / Entra ID groups without
            leaving the app.
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Verify whether a group or user exists.</li>
            <li>List group members.</li>
            <li>Add or remove users from a group.</li>
          </ul>
          <Callout type="tip">
            Credentials entered in the Group Management page are used only for that session and
            are not persisted to disk.
          </Callout>
        </Section>

        {/* ── DMT Tools ── */}
        <Section id="dmt" title="DMT Tools" icon={Monitor}>
          <p>
            DMT Tools embeds the <strong>Ansible DMT Tools</strong> web app (running inside WSL)
            directly in this UI. It lets you run Ansible playbooks against Windows endpoints via
            a browser interface without switching to a terminal.
          </p>
          <h3 className="font-semibold mt-3 mb-1">First-time setup</h3>
          <div className="space-y-1.5">
            <Step n={1}>Open <strong>DMT Tools</strong> and select your WSL instance from the dropdown.</Step>
            <Step n={2}>The app checks whether the required tools (Node.js, Ansible, Python venv) are installed. If not, click <strong>Run Setup</strong>.</Step>
            <Step n={3}>Once setup completes, the Ansible UI loads in an embedded frame.</Step>
          </div>
          <h3 className="font-semibold mt-3 mb-1">Syncing changes</h3>
          <p>
            When you edit the <Code>ansible-app/</Code> source on the Windows side, click{' '}
            <strong>Sync to WSL</strong> in the header bar. This rsyncs the files, rebuilds the
            embedded React app, and restarts the Node server — the frame reloads automatically.
          </p>
          <Callout type="info">
            Use the <strong>Terminal</strong> button in the DMT Tools header to open an integrated
            terminal directly inside the WSL instance without leaving the app.
          </Callout>
        </Section>
      </div>
    </div>
  );
}
