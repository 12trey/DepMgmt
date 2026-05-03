const vscode = require('vscode');
const path = require('path');
const WIN_TASKS = require('./src/winTasks');
const SnippetTreeProvider = require('./src/snippetTreeProvider');
const playbookRunner = require('./src/playbookRunner');
const kerberos = require('./src/kerberosService');
const { newInventory, newPlaybook } = require('./src/fileScaffolder');
const krb5Editor = require('./src/krb5Editor');
const ansiblePanel = require('./src/ansiblePanel');

let outputChannel;
let statusBarItem;       // Kerberos
let playbookBarItem;     // shows selected playbook, click to clear
let hostsBarItem;        // shows selected hosts, click to clear
let playBarItem;         // run button, shown when both are set
let treeProvider;

let activePlaybook = null; // { wslPath, name }
let activeHosts = null;    // { wslPath, name }

async function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Ansible');
  ansiblePanel.init(context);

  // Kerberos status bar (priority 10)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.command = 'ansible.kerberosStatus';
  statusBarItem.tooltip = 'Kerberos ticket status — click for details';
  context.subscriptions.push(statusBarItem);

  // Playbook indicator (priority 14) — click to clear
  playbookBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 14);
  playbookBarItem.command = 'ansible.clearPlaybook';
  playbookBarItem.tooltip = 'Active playbook — click to clear';
  context.subscriptions.push(playbookBarItem);

  // Hosts indicator (priority 13) — click to clear
  hostsBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 13);
  hostsBarItem.command = 'ansible.clearHosts';
  hostsBarItem.tooltip = 'Active hosts file — click to clear';
  context.subscriptions.push(hostsBarItem);

  // Play button (priority 12) — shown only when both are set
  playBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
  playBarItem.command = 'ansible.runSelected';
  playBarItem.text = '$(play) Run Ansible';
  context.subscriptions.push(playBarItem);

  treeProvider = new SnippetTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ansibleSnippets', treeProvider)
  );

  // ── Commands ────────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.refreshSnippets', () => {
      treeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.insertSnippet', async (snippetContent) => {
      if (!snippetContent) {
        snippetContent = await pickSnippet();
        if (!snippetContent) return;
      }
      insertSnippetAtCursor(snippetContent);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.setPlaybook', async (uri) => {
      const winPath = uri ? uri.fsPath : vscode.window.activeTextEditor?.document.fileName;
      if (!winPath) {
        vscode.window.showWarningMessage('No YAML file selected.');
        return;
      }
      activePlaybook = { wslPath: winToWslPath(winPath), name: path.basename(winPath) };
      vscode.window.showInformationMessage(`Ansible playbook set: ${activePlaybook.name}`);
      updateRunnerUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.setHosts', async (uri) => {
      let winPath = uri ? uri.fsPath : null;
      if (!winPath) {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { 'Inventory files': ['ini', 'cfg', 'txt'], 'All files': ['*'] },
          title: 'Select Ansible Hosts / Inventory File',
        });
        if (!picked || picked.length === 0) return;
        winPath = picked[0].fsPath;
      }
      activeHosts = { wslPath: winToWslPath(winPath), name: path.basename(winPath) };
      vscode.window.showInformationMessage(`Ansible hosts set: ${activeHosts.name}`);
      updateRunnerUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.clearPlaybook', () => {
      activePlaybook = null;
      updateRunnerUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.clearHosts', () => {
      activeHosts = null;
      updateRunnerUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.clearRunner', () => {
      activePlaybook = null;
      activeHosts = null;
      updateRunnerUI();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.runSelected', async () => {
      if (!activePlaybook || !activeHosts) {
        vscode.window.showWarningMessage(
          'Set both a playbook (right-click YAML) and a hosts file (right-click .ini) first.'
        );
        return;
      }

      if (playbookRunner.isRunning()) {
        const choice = await vscode.window.showWarningMessage(
          'A playbook is already running.',
          'Stop and Re-run',
          'Cancel'
        );
        if (choice !== 'Stop and Re-run') return;
        playbookRunner.stop();
      }

      const cfg = vscode.workspace.getConfiguration('ansible');
      // Snapshot paths before clearing them
      const playbookPath = activePlaybook.wslPath;
      const inventoryPath = activeHosts.wslPath;

      ansiblePanel.show();
      ansiblePanel.clear();

      playbookRunner.run(
        {
          playbookPath,
          inventoryPath,
          ansibleConfig: cfg.get('defaultAnsibleConfig') || '',
          repoFolder: cfg.get('repoFolder'),
          ansibleBin: cfg.get('ansiblePlaybookPath'),
          distro: cfg.get('wslDistro') || '',
          verbosity: cfg.get('verbosity'),
        },
        outputChannel,
        {
          onData: ansiblePanel.append,
          onFinish: () => {
            activePlaybook = null;
            activeHosts = null;
            updateRunnerUI();
          },
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.runPlaybook', async () => {
      if (playbookRunner.isRunning()) {
        const choice = await vscode.window.showWarningMessage(
          'A playbook is already running.',
          'Stop and Re-run',
          'Cancel'
        );
        if (choice !== 'Stop and Re-run') return;
        playbookRunner.stop();
      }

      const cfg = vscode.workspace.getConfiguration('ansible');
      const repoFolder = cfg.get('repoFolder');
      const ansibleBin = cfg.get('ansiblePlaybookPath');
      const distro = cfg.get('wslDistro') || '';
      const verbosity = cfg.get('verbosity');

      let playbookPath = getActiveYamlPath();
      if (!playbookPath) {
        playbookPath = await vscode.window.showInputBox({
          prompt: 'WSL path to playbook YAML file',
          placeHolder: `${repoFolder}/site.yml`,
        });
        if (!playbookPath) return;
      }

      const inventoryPath = await vscode.window.showInputBox({
        prompt: 'Inventory file path (relative to repo folder or absolute WSL path)',
        value: cfg.get('defaultInventory') || '.hosts.ini',
      });
      if (!inventoryPath) return;

      ansiblePanel.show();
      ansiblePanel.clear();

      playbookRunner.run(
        {
          playbookPath,
          inventoryPath,
          ansibleConfig: cfg.get('defaultAnsibleConfig') || '',
          repoFolder,
          ansibleBin,
          distro,
          verbosity,
        },
        outputChannel,
        { onData: ansiblePanel.append }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.stopPlaybook', () => {
      if (!playbookRunner.isRunning()) {
        vscode.window.showInformationMessage('No playbook is currently running.');
        return;
      }
      playbookRunner.stop();
      outputChannel.appendLine('[ansible-helper] Playbook stopped by user.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.kerberosStatus', async () => {
      const cfg = vscode.workspace.getConfiguration('ansible');
      const distro = cfg.get('wslDistro') || '';
      try {
        const s = await kerberos.status(distro);
        if (s.valid) {
          vscode.window.showInformationMessage(
            `Kerberos: ${s.principal}${s.expires ? ' — expires ' + s.expires : ''}`
          );
        } else {
          const choice = await vscode.window.showWarningMessage(
            'No valid Kerberos ticket.',
            'Login (kinit)'
          );
          if (choice === 'Login (kinit)') {
            vscode.commands.executeCommand('ansible.kerberosInit');
          }
        }
        updateStatusBar(s);
      } catch (e) {
        vscode.window.showErrorMessage(`Kerberos check failed: ${e.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.kerberosInit', async () => {
      const username = await vscode.window.showInputBox({
        prompt: 'Kerberos principal (e.g. user@REALM.COM)',
        placeHolder: 'user@REALM.COM',
      });
      if (!username) return;

      const password = await vscode.window.showInputBox({
        prompt: `Password for ${username}`,
        password: true,
      });
      if (!password) return;

      const cfg = vscode.workspace.getConfiguration('ansible');
      const distro = cfg.get('wslDistro') || '';

      try {
        await kerberos.kinit(distro, username, password);
        vscode.window.showInformationMessage(`Kerberos: logged in as ${username}`);
        const s = await kerberos.status(distro);
        updateStatusBar(s);
      } catch (e) {
        vscode.window.showErrorMessage(`kinit failed: ${e.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.kerberosDestroy', async () => {
      const cfg = vscode.workspace.getConfiguration('ansible');
      const distro = cfg.get('wslDistro') || '';
      try {
        await kerberos.kdestroy(distro);
        vscode.window.showInformationMessage('Kerberos ticket destroyed.');
        updateStatusBar({ valid: false });
      } catch (e) {
        vscode.window.showErrorMessage(`kdestroy failed: ${e.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.newInventory', () => newInventory())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.newPlaybook', () => newPlaybook())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible.editKrb5Conf', async () => {
      const cfg = vscode.workspace.getConfiguration('ansible');
      try {
        await krb5Editor.openKrb5Conf(cfg.get('wslDistro') || '');
      } catch (e) {
        vscode.window.showErrorMessage(`Could not open krb5.conf: ${e.message}`);
      }
    })
  );

  // ── Init ────────────────────────────────────────────────────────────────────

  await treeProvider.refresh();
  refreshKerberosStatus();
}

function deactivate() {
  playbookRunner.stop();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function winToWslPath(winPath) {
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
}

function updateRunnerUI() {
  if (activePlaybook) {
    playbookBarItem.text = `$(file-code) ${activePlaybook.name}`;
    playbookBarItem.show();
  } else {
    playbookBarItem.hide();
  }

  if (activeHosts) {
    hostsBarItem.text = `$(list-tree) ${activeHosts.name}`;
    hostsBarItem.show();
  } else {
    hostsBarItem.hide();
  }

  if (activePlaybook && activeHosts) {
    playBarItem.tooltip = `Playbook: ${activePlaybook.name}\nHosts: ${activeHosts.name}\nClick to run`;
    playBarItem.show();
  } else {
    playBarItem.hide();
  }
}

function insertSnippetAtCursor(content) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a YAML file to insert a snippet.');
    return;
  }
  const lines = content.split('\n');
  const trimmed = lines.slice(
    lines.findIndex(l => l.trim() !== ''),
    lines.length - [...lines].reverse().findIndex(l => l.trim() !== '')
  );

  const indented = trimmed.map(line => '    ' + line).join('\n');
  const escaped = indented.replace(/\$/g, '\\$');
  editor.insertSnippet(new vscode.SnippetString('\n' + escaped + '\n'));
}

async function pickSnippet() {
  const cfg = vscode.workspace.getConfiguration('ansible');
  const { loadCustomSnippets } = require('./src/customSnippets');
  const custom = await loadCustomSnippets(
    cfg.get('customSnippetsPath'),
    cfg.get('wslDistro')
  );

  const items = [
    ...WIN_TASKS.map(t => ({
      label: t.name,
      description: t.desc,
      detail: '$(symbol-snippet) Built-in',
      snippet: t.snippet,
    })),
    ...custom.map(t => ({
      label: t.name,
      description: t.desc || '',
      detail: '$(file-code) Custom',
      snippet: t.snippet,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    placeHolder: 'Search snippets…',
  });
  return picked ? picked.snippet : null;
}

function getActiveYamlPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const ext = editor.document.fileName.split('.').pop().toLowerCase();
  if (ext !== 'yaml' && ext !== 'yml') return null;
  return winToWslPath(editor.document.fileName);
}

function updateStatusBar(s) {
  if (s.valid) {
    statusBarItem.text = `$(key) ${s.principal || 'Kerberos OK'}`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = `$(key) No Kerberos ticket`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  statusBarItem.show();
}

async function refreshKerberosStatus() {
  const cfg = vscode.workspace.getConfiguration('ansible');
  const distro = cfg.get('wslDistro') || '';
  try {
    const s = await kerberos.status(distro);
    updateStatusBar(s);
  } catch {
    statusBarItem.text = '$(key) Kerberos (WSL unavailable)';
    statusBarItem.show();
  }
}

module.exports = { activate, deactivate };
