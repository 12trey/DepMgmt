import { useState } from 'react';
import {
  PackagePlus, FolderOpen, Play, GitBranch, Settings, Monitor,
  Package, Archive, UsersRound, PuzzleIcon, FileText, Image,
  Code2, FolderOpen as FolderIcon, Wrench, ChevronRight, ScrollText, ShieldCheck, Terminal
} from 'lucide-react';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'packages', label: 'Package Management' },
  { id: 'folders', label: 'Package Folders' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'execution', label: 'Execution' },
  { id: 'msi', label: 'MSI Builder' },
  { id: 'intune', label: 'Intune Packager' },
  { id: 'git', label: 'Git Integration' },
  { id: 'groups', label: 'Group Management' },
  { id: 'dmt',       label: 'DMT Tools' },
  { id: 'logviewer', label: 'Log Viewer' },
  { id: 'signing',   label: 'Code Signing' },
  { id: 'scriptrunner',   label: 'Script Runner' },
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
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    tip: 'bg-green-50 border-green-200 text-green-800',
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
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
                className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-1 transition-colors ${active === s.id
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
              { icon: PackagePlus, label: 'PSADT Packages', desc: 'Generate v3 / v4 deployment packages from templates.' },
              { icon: Play, label: 'Execution', desc: 'Run packages and stream live deployment logs.' },
              { icon: Package, label: 'MSI Builder', desc: 'Author and build MSI installers.' },
              { icon: Archive, label: 'Intune Packager', desc: 'Wrap installers into .intunewin files.' },
              { icon: GitBranch, label: 'Git Integration', desc: 'Version-control your package repository.' },
              { icon: UsersRound, label: 'Group Management', desc: 'Query and manage on-premises Active Directory groups.' },
              { icon: Monitor,      label: 'DMT Tools',    desc: 'Ansible playbook execution via WSL.' },
              { icon: ScrollText,  label: 'Log Viewer',  desc: 'Real-time CMTrace, EVTX, and Ansible log viewing.' },
              { icon: ShieldCheck, label: 'Code Signing', desc: 'Authenticode-sign executables, MSIs, scripts, and more.' },
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
                  ['Entry script', 'Deploy-Application.ps1', 'Invoke-AppDeployToolkit.ps1'],
                  ['Config', 'AppDeployToolkitConfig.xml', 'Config/Config.psd1'],
                  ['Cmdlet prefix', 'None (Execute-Process…)', 'ADT (Start-ADTProcess…)'],
                  ['Module loading', 'Dot-source .ps1 files', 'Import-Module PSAppDeployToolkit'],
                  ['Extensions', 'Not supported', 'PSAppDeployToolkit.Extensions/'],
                  ['Custom assets', 'Assets/ folder', 'Assets/ folder'],
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
            package detail view to manage each one. If you have the PSADT 4.1.x module installed,
            the app can auto-populate the <Code>PSAppDeployToolkit/</Code> folder with the necessary
            .psm1 and .psd1 files for your scripts to work out of the box. Alternatively, you can
            populate that folder manually from the official PSADT GitHub repo or your own custom
            toolkit module.
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
            Query and manage on-premises <strong>Active Directory</strong> groups without leaving the app.
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
            <Step n={1}>Open <strong>DMT Tools</strong> and select your WSL instance from the dropdown. (see NOTE below)</Step>
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
          <Callout type="info">
            <p className="font-semibold">NOTE:</p>
            <p>
              The most current Ubuntu <Code>"Noble Numbat" version 24.04 LTS for WSL</Code> can be downloaded from here:
            </p>
            <p className="mt-2">
              <a href="https://cdimages.ubuntu.com/ubuntu-wsl/noble/daily-live/current/" target="_blank">https://cdimages.ubuntu.com/ubuntu-wsl/noble/daily-live/current/</a>
            </p>
            <p className="mt-2">
              From a powershell terminal, run the following to import the image.
            </p>

            <p className="mt-2">
            <Code>wsl --import MyAnsibleUbuntu $env:userprofile\MyAnsibleUbuntu "&lt;PATH TO&gt;\noble-wsl-amd64.wsl"</Code>
            </p>

            <p className="mt-2">
              This will create a new WSL distribution on your PC named <strong>MyAnsibleUbuntu</strong>, stored in <strong>$env:userprofile\MyAnsibleUbuntu</strong>.
              The default user when importing a base image will be root. You can create the initial WSL user manually or continue using root. If you add a default user (UID 1000), or install the ansible ui to an existing wsl distribution created uses the normal method (wsl --install -d Ubuntu-24.04), you will need to use the "Run as root" checkbox to install the app to your WSL instance.
            </p>
            <p className="mt-2">
              To remove the image if you no longer need it, run the following:
            </p>
            <p className="mt-2">
            <Code>wsl --unregister MyAnsibleUbuntu</Code>
            </p>
          </Callout>
        </Section>

        {/* ── Log Viewer ── */}
        <Section id="logviewer" title="Log Viewer" icon={ScrollText}>
          <p>
            The <strong>Log Viewer</strong> is a real-time log analysis tool embedded directly in
            Deployment Manager. It can open and tail CMTrace-format logs, plain-text logs, and
            Windows Event Log (<Code>.evtx</Code>) files, and includes dedicated tabs for Intune
            diagnostics and DSRegCmd analysis.
          </p>

          <h3 className="font-semibold mt-4 mb-1">Log Viewer tab</h3>
          <div className="space-y-1.5">
            <Step n={1}>Click <strong>Open File</strong> to browse the server's filesystem. Drives, directories, and supported log files are listed in the left sidebar.</Step>
            <Step n={2}>Click a <Code>.log</Code>, <Code>.txt</Code>, or <Code>.evtx</Code> file to open it. The viewer parses the file and displays entries in a colour-coded table.</Step>
            <Step n={3}>Once open, the viewer <strong>automatically tails</strong> the file — new lines appear live as they are written.</Step>
            <Step n={4}>Use the severity filter buttons (<em>All / Info / Warn / Error</em>) and the filter input to narrow down entries. Regex is supported.</Step>
            <Step n={5}>Press <strong>Ctrl+F</strong> to open the find bar and jump between matching entries.</Step>
          </div>

          <h3 className="font-semibold mt-4 mb-1">Ansible Playbook Log</h3>
          <p>
            The sidebar's <strong>Quick Links</strong> section contains a pinned{' '}
            <strong>Ansible Playbook Log</strong> entry. Clicking it connects to the live CMTrace
            log generated by the Ansible callback plugin at{' '}
            <Code>/tmp/ansible_cmtrace.log</Code> on the ansible-app server. New entries stream in
            automatically every 3 seconds while a playbook is running — no file browsing required.
          </p>
          <Callout type="tip">
            Keep the Log Viewer open in its own tab while running a playbook in DMT Tools. Both
            tabs stay live simultaneously — the Log Viewer socket stays connected even when you
            switch to another tab.
          </Callout>

          <h3 className="font-semibold mt-4 mb-1">Intune Diagnostics tab</h3>
          <p>
            Load an Intune Management Extension log (<Code>IntuneManagementExtension.log</Code>)
            to see a parsed timeline of app installations, policy evaluations, and errors.
            Typical path on a managed device:
          </p>
          <Code>C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\IntuneManagementExtension.log</Code>

          <h3 className="font-semibold mt-4 mb-1">DSRegCmd tab</h3>
          <p>
            Paste the output of <Code>dsregcmd /status</Code> (run on a Windows endpoint) into
            the text area and click <strong>Analyze</strong>. The tool parses Azure AD join
            state, device compliance, SSO tokens, and PRT status into a structured report.
          </p>

          <h3 className="font-semibold mt-4 mb-1">Supported log formats</h3>
          <div className="overflow-x-auto">
            <table className="text-xs w-full border border-gray-200 rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 border-b">Format</th>
                  <th className="text-left p-2 border-b">Detection</th>
                  <th className="text-left p-2 border-b">Notes</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['CMTrace', 'Automatic', 'Full structured parsing: time, date, component, thread, severity.'],
                  ['SCCM Simple ($$<)', 'Automatic', 'Compact single-line SCCM format.'],
                  ['Plain text', 'Automatic', 'Severity inferred from keywords (error, warn, fail…).'],
                  ['EVTX', '.evtx extension', 'Parsed via wevtutil.exe — snapshot only, no live tail.'],
                ].map(([fmt, det, note]) => (
                  <tr key={fmt} className="border-b last:border-0">
                    <td className="p-2 font-medium text-gray-700">{fmt}</td>
                    <td className="p-2">{det}</td>
                    <td className="p-2 text-gray-600">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Callout type="info">
            Column widths in the log table are resizable — drag the column dividers in the header
            row. Width preferences are saved to <Code>localStorage</Code> per browser.
          </Callout>
        </Section>

        {/* ── Code Signing ── */}
        <Section id="signing" title="Code Signing" icon={ShieldCheck}>
          <p>
            The <strong>Code Signing</strong> page applies an Authenticode digital signature to any
            supported file using PowerShell's built-in <Code>Set-AuthenticodeSignature</Code> cmdlet.
            No Windows SDK or <Code>signtool.exe</Code> is required.
          </p>

          <h3 className="font-semibold mt-4 mb-1">Supported file types</h3>
          <p className="text-xs text-gray-500 mb-2">Any file accepted by Authenticode, including:</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {['.exe', '.dll', '.msi', '.cab', '.sys', '.ocx', '.cat', '.ps1', '.psm1', '.psd1', '.appx', '.msix'].map(ext => (
              <Code key={ext}>{ext}</Code>
            ))}
          </div>

          <h3 className="font-semibold mt-4 mb-1">Signing with a certificate store thumbprint</h3>
          <div className="space-y-1.5">
            <Step n={1}>Open <strong>certmgr.msc</strong> (or <Code>certlm.msc</Code> for the machine store), find your code-signing certificate, and copy the thumbprint from the Details tab.</Step>
            <Step n={2}>Go to <strong>Code Signing</strong>, drop or browse for the file to sign, and select <strong>Certificate Store</strong>.</Step>
            <Step n={3}>Paste the thumbprint — spaces and colons are ignored automatically. The app searches both <Code>LocalMachine\My</Code> and <Code>CurrentUser\My</Code>.</Step>
            <Step n={4}>Optionally set a timestamp server URL, then click <strong>Sign &amp; Download</strong>.</Step>
          </div>

          <h3 className="font-semibold mt-4 mb-1">Signing with a PFX file</h3>
          <div className="space-y-1.5">
            <Step n={1}>Select <strong>PFX File</strong> and click <strong>Browse…</strong> to pick your <Code>.pfx</Code> or <Code>.p12</Code> file.</Step>
            <Step n={2}>Enter the PFX password (leave blank if the file has no password).</Step>
            <Step n={3}>Drop or browse for the file to sign, then click <strong>Sign &amp; Download</strong>.</Step>
          </div>
          <Callout type="info">
            The PFX file is uploaded to the server only for the duration of the signing operation and
            is deleted immediately afterward — it is never written to disk permanently.
          </Callout>

          <h3 className="font-semibold mt-4 mb-1">Timestamp servers</h3>
          <p>
            A timestamp server embeds a trusted time token in the signature so the signature
            remains valid after the signing certificate expires. The default is DigiCert's TSA.
            Other common choices:
          </p>
          <div className="overflow-x-auto mt-2">
            <table className="text-xs w-full border border-gray-200 rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 border-b">Provider</th>
                  <th className="text-left p-2 border-b">URL</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['DigiCert', 'http://timestamp.digicert.com'],
                  ['Sectigo', 'http://timestamp.sectigo.com'],
                  ['GlobalSign', 'http://timestamp.globalsign.com/tsa/r6advanced1'],
                  ['Comodo', 'http://timestamp.comodoca.com'],
                ].map(([provider, url]) => (
                  <tr key={provider} className="border-b last:border-0">
                    <td className="p-2 font-medium text-gray-700">{provider}</td>
                    <td className="p-2 font-mono">{url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Callout type="tip">
            The MSI Builder page also has an optional <strong>Code Signing</strong> section that
            signs the compiled MSI immediately after the WiX build — useful if you always sign your
            MSIs and want to do it in one step.
          </Callout>
        </Section>

        {/* ── Script Runner ── */}
        <Section id="scriptrunner" title="Script Runner" icon={Terminal}>
          <p>
            Script Runner turns any PowerShell script into a point-and-click UI. It reads the
            script's <Code>param()</Code> block, renders the appropriate input controls, streams
            live output, and displays pipeline return values as a structured, sortable table.
            The scripts folder is configured in <strong>Settings</strong>.
          </p>

          <h3 className="font-semibold mt-4 mb-1">Running a script</h3>
          <div className="space-y-1.5">
            <Step n={1}>Browse the left panel to find a <Code>.ps1</Code> file and click it.</Step>
            <Step n={2}>Fill in any auto-detected parameters, then click <strong>Run Script</strong>.</Step>
            <Step n={3}>Output streams live in the <strong>Console</strong> tab. When the script finishes, pipeline objects appear in the <strong>Output</strong> tab.</Step>
            <Step n={4}>Click <strong>Stop</strong> at any time to kill the process.</Step>
          </div>

          <h3 className="font-semibold mt-4 mb-1">Auto-detected parameter types</h3>
          <div className="overflow-x-auto">
            <table className="text-xs w-full border border-gray-200 rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 border-b">PS type / attribute</th>
                  <th className="text-left p-2 border-b">Rendered as</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['[string]', 'Text input'],
                  ['[switch] / [bool]', 'Checkbox'],
                  ['[int] / [int32] / [int64]', 'Number input (step 1)'],
                  ['[double] / [float]', 'Number input (step 0.01)'],
                  ['[datetime]', 'Date/time picker'],
                  ['[ValidateSet(...)]', 'Dropdown (select only)'],
                  ['Name contains password/secret/key/token', 'Password input (masked)'],
                  ['Sibling .json file defines options', 'Combobox (free text + preset list)'],
                ].map(([ps, ui]) => (
                  <tr key={ps} className="border-b last:border-0">
                    <td className="p-2 font-mono text-gray-700">{ps}</td>
                    <td className="p-2">{ui}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2">
            Parameters decorated with <Code>Mandatory=$true</Code> are marked with a red asterisk and must be filled before the script will run.
            The <Code>HelpMessage</Code> attribute value is shown as a hint below the field.
          </p>

          <h3 className="font-semibold mt-4 mb-1">Parameter options file (.json)</h3>
          <p>
            Place a <Code>.json</Code> file with the <strong>same base name</strong> as your script in the same folder.
            Any parameter name that appears as a key in that file gets a <strong>combobox</strong> — a
            free-text input with a dropdown of preset values.
          </p>
          <p className="mt-2 font-medium">Simple list of options:</p>
          <pre className="bg-gray-950 text-gray-100 rounded p-3 text-xs font-mono overflow-x-auto mt-1">{`{
  "ResourceGroupName": [
    "prod-rg-eastus-01",
    "staging-rg-eastus-01"
  ],
  "HostPoolName": [
    "prod-hostpool-01",
    "staging-hostpool-01"
  ]
}`}</pre>

          <p className="mt-3 font-medium">Options that auto-fill other parameters:</p>
          <p className="mt-1">
            Replace a plain string with an object that has a <Code>"value"</Code> key plus any number of other
            parameter names as keys. When the user picks that option, the linked parameters are filled automatically.
            Hovering over the option in the dropdown shows a tooltip listing what will be set.
          </p>
          <pre className="bg-gray-950 text-gray-100 rounded p-3 text-xs font-mono overflow-x-auto mt-1">{`{
  "ResourceGroupName": [
    "staging-rg-eastus-01",
    {
      "value": "prod-rg-eastus-01",
      "HostPoolName": "prod-hostpool-01"
    }
  ],
  "HostPoolName": [
    "staging-hostpool-01",
    {
      "value": "prod-hostpool-01",
      "ResourceGroupName": "prod-rg-eastus-01"
    }
  ]
}`}</pre>
          <Callout type="tip">
            Trailing commas in the JSON are allowed — the parser strips them automatically, so
            you can format the file the same way you would a JavaScript object.
          </Callout>

          <h3 className="font-semibold mt-4 mb-1">Structured output table</h3>
          <p>
            When a script returns objects through the pipeline (e.g. <Code>Get-AzWvdSessionHost | Select-Object ...</Code>),
            they are captured and displayed as a table in the <strong>Output</strong> tab after the run completes.
            Column widths are resizable — drag the right edge of any column header.
          </p>

          <h3 className="font-semibold mt-4 mb-1">Microsoft Graph integration</h3>
          <p>
            Expand the <strong>Microsoft Graph</strong> panel to install the{' '}
            <Code>Microsoft.Graph</Code> PowerShell module (CurrentUser scope) and authenticate
            interactively via browser. Once connected, enable <strong>Use Graph in scripts</strong>
            to automatically import and connect the module before each script run.
          </p>

          <h3 className="font-semibold mt-4 mb-1">Azure (Az) integration</h3>
          <p>
            Expand the <strong>Azure PowerShell (Az)</strong> panel to install the{' '}
            <Code>Az</Code> module and connect via <Code>Connect-AzAccount</Code>.
            Optionally pre-fill your account email, subscription ID, or subscription name
            to skip prompts. Enable <strong>Use Az in scripts</strong> to verify (or establish)
            an Az context before each run.
          </p>
          <Callout type="info">
            The Azure login dialog requires a visible window — the process is spawned without
            the <Code>windowsHide</Code> flag so the WAM/browser prompt can appear.
          </Callout>
        </Section>
      </div>
    </div>
  );
}
