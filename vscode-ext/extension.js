const vscode = require('vscode');
const WIN_TASKS = require('./src/winTasks');
const SnippetTreeProvider = require('./src/snippetTreeProvider');
const playbookRunner = require('./src/playbookRunner');
const kerberos = require('./src/kerberosService');
const { newInventory, newPlaybook } = require('./src/fileScaffolder');
const krb5Editor = require('./src/krb5Editor');

let outputChannel;
let statusBarItem;
let treeProvider;

async function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Ansible');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.command = 'ansible.kerberosStatus';
  statusBarItem.tooltip = 'Kerberos ticket status — click for details';
  context.subscriptions.push(statusBarItem);

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
      // Called from TreeView click (snippetContent provided) or command palette (show QuickPick)
      if (!snippetContent) {
        snippetContent = await pickSnippet();
        if (!snippetContent) return;
      }
      insertSnippetAtCursor(snippetContent);
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

      // Resolve playbook path
      let playbookPath = getActiveYamlPath();
      if (!playbookPath) {
        playbookPath = await vscode.window.showInputBox({
          prompt: 'WSL path to playbook YAML file',
          placeHolder: `${repoFolder}/site.yml`,
        });
        if (!playbookPath) return;
      }

      // Resolve inventory path
      const inventoryPath = await vscode.window.showInputBox({
        prompt: 'Inventory file path (relative to repo folder or absolute WSL path)',
        value: cfg.get('defaultInventory') || '.hosts.ini',
      });
      if (!inventoryPath) return;

      const ansibleConfig = cfg.get('defaultAnsibleConfig') || '';

      playbookRunner.run(
        { playbookPath, inventoryPath, ansibleConfig, repoFolder, ansibleBin, distro, verbosity },
        outputChannel
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

function insertSnippetAtCursor(content) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a YAML file to insert a snippet.');
    return;
  }
  // Normalize: trim leading/trailing blank lines, ensure trailing newline
  const lines = content.split('\n');
  const trimmed = lines
    .slice(
      lines.findIndex(l => l.trim() !== ''),
      lines.length - [...lines].reverse().findIndex(l => l.trim() !== '')
    )
    .join('\n');
  editor.insertSnippet(new vscode.SnippetString(trimmed + '\n'));
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
  // Convert Windows path to WSL path
  const winPath = editor.document.fileName;
  const wslPath = winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
  return wslPath;
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
