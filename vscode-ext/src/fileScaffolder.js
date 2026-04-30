const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const INVENTORY_TEMPLATE = `[all:vars]
ansible_user=
ansible_password=
ansible_connection=winrm
ansible_winrm_transport=kerberos
ansible_winrm_server_cert_validation=ignore
ansible_port=5985

[windows]
host1.domain.com
host2.domain.com

[linux]
host3.domain.com
`;

function playbookTemplate(playName, hosts) {
  return `---
- name: ${playName}
  hosts: ${hosts}
  gather_facts: true
  tasks:
    - name: Example task
      ansible.windows.win_command:
        cmd: whoami
      register: result

    - name: Show result
      ansible.builtin.debug:
        var: result.stdout
`;
}

function currentFolder() {
  // Prefer the folder of the active editor file
  const editor = vscode.window.activeTextEditor;
  if (editor && !editor.document.isUntitled) {
    return path.dirname(editor.document.fileName);
  }
  // Fall back to the first workspace folder
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return null;
}

async function createAndOpen(dir, fileName, content) {
  const filePath = path.join(dir, fileName);
  if (fs.existsSync(filePath)) {
    const choice = await vscode.window.showWarningMessage(
      `${fileName} already exists in this folder. Overwrite?`,
      'Overwrite',
      'Cancel'
    );
    if (choice !== 'Overwrite') return;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc);
}

async function newInventory() {
  const dir = currentFolder();
  if (!dir) {
    vscode.window.showErrorMessage('Open a folder in VS Code first.');
    return;
  }

  const fileName = await vscode.window.showInputBox({
    prompt: 'Inventory file name',
    value: '.hosts.ini',
  });
  if (!fileName) return;

  await createAndOpen(dir, fileName, INVENTORY_TEMPLATE);
}

async function newPlaybook() {
  const dir = currentFolder();
  if (!dir) {
    vscode.window.showErrorMessage('Open a folder in VS Code first.');
    return;
  }

  const playName = await vscode.window.showInputBox({
    prompt: 'Play name',
    value: 'My Playbook',
  });
  if (playName === undefined) return;

  const hosts = await vscode.window.showInputBox({
    prompt: 'Target hosts pattern',
    value: 'windows',
  });
  if (hosts === undefined) return;

  const fileName = await vscode.window.showInputBox({
    prompt: 'Playbook file name',
    value: 'playbook.yml',
  });
  if (!fileName) return;

  await createAndOpen(dir, fileName, playbookTemplate(playName, hosts));
}

module.exports = { newInventory, newPlaybook };
