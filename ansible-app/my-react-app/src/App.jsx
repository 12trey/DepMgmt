import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import './App.css';

const BASE = 'http://localhost:7000';

function getLanguage(filename) {
  if (!filename) return 'plaintext';
  if (filename.endsWith('.yaml') || filename.endsWith('.yml')) return 'yaml';
  if (filename.endsWith('.ini')) return 'ini';
  return 'plaintext';
}

// ── Default templates for new files ──────────────────────────────────────────

const NEW_YAML_TEMPLATE = `---
- name: New Playbook
  hosts: all
  gather_facts: false
  tasks:

`;

const NEW_INI_TEMPLATE = `[all]
# host1 ansible_host=192.168.1.100

[all:vars]
ansible_user=Administrator
ansible_password=
ansible_connection=winrm
ansible_winrm_transport=kerberos
ansible_winrm_scheme=http
ansible_port=5985
`;

// ── Windows ansible module task scaffolding ───────────────────────────────────
// Snippets use 4-space indent for the task list item (standard Ansible style).
// A leading blank line separates from the previous task.

const WIN_TASKS = [
  {
    name: 'win_acl',
    desc: 'Set access control on a file or directory',
    snippet: `
    - name: Set ACL on path
      ansible.windows.win_acl:
        path: 'C:\\target\\path'
        user: 'DOMAIN\\Username'
        rights: FullControl
        type: allow
        state: present
`,
  },
  {
    name: 'win_command',
    desc: 'Run a command on a Windows host',
    snippet: `
    - name: Run command
      ansible.windows.win_command:
        cmd: whoami
      register: cmd_result
`,
  },
  {
    name: 'win_copy',
    desc: 'Copy a file to a Windows host',
    snippet: `
    - name: Copy file to host
      ansible.windows.win_copy:
        src: /local/path/file.txt
        dest: 'C:\\remote\\path\\file.txt'
`,
  },
  {
    name: 'win_credential',
    desc: 'Manage Windows Credential Manager entries',
    snippet: `
    - name: Add credential
      ansible.windows.win_credential:
        name: server_name
        type: domain_password
        username: 'DOMAIN\\user'
        secret: "{{ credential_password }}"
        state: present
`,
  },
  {
    name: 'win_environment',
    desc: 'Manage environment variables on Windows',
    snippet: `
    - name: Set environment variable
      ansible.windows.win_environment:
        name: MY_VAR
        value: my_value
        level: machine
        state: present
`,
  },
  {
    name: 'win_feature',
    desc: 'Install or remove Windows features',
    snippet: `
    - name: Install Windows feature
      ansible.windows.win_feature:
        name: Web-Server
        state: present
        include_management_tools: true
      register: feature_result
`,
  },
  {
    name: 'win_feature_info',
    desc: 'Get information about Windows features',
    snippet: `
    - name: Get feature info
      ansible.windows.win_feature_info:
        name: Web-Server
      register: feature_info
`,
  },
  {
    name: 'win_file',
    desc: 'Manage files and directories on Windows',
    snippet: `
    - name: Create directory
      ansible.windows.win_file:
        path: 'C:\\path\\to\\directory'
        state: directory
`,
  },
  {
    name: 'win_firewall',
    desc: 'Manage firewall rules on Windows',
    snippet: `
    - name: Add firewall rule
      ansible.windows.win_firewall_rule:
        name: My App Rule
        localport: 8080
        action: allow
        direction: in
        protocol: tcp
        state: present
        enabled: true
`,
  },
  {
    name: 'win_get_url',
    desc: 'Download a file from a URL to Windows',
    snippet: `
    - name: Download file
      ansible.windows.win_get_url:
        url: https://example.com/file.zip
        dest: 'C:\\temp\\file.zip'
`,
  },
  {
    name: 'win_group',
    desc: 'Manage local Windows groups',
    snippet: `
    - name: Create local group
      ansible.windows.win_group:
        name: MyGroup
        description: My local group
        state: present
`,
  },
  {
    name: 'win_group_membership',
    desc: 'Manage Windows local group membership',
    snippet: `
    - name: Add users to group
      ansible.windows.win_group_membership:
        name: Administrators
        members:
          - 'DOMAIN\\user1'
        state: present
`,
  },
  {
    name: 'win_package',
    desc: 'Install or uninstall a Windows package',
    snippet: `
    - name: Install package
      ansible.windows.win_package:
        path: 'C:\\installers\\setup.msi'
        state: present
        arguments: /quiet /norestart
`,
  },
  {
    name: 'win_path',
    desc: 'Manage the Windows PATH environment variable',
    snippet: `
    - name: Add path to PATH
      ansible.windows.win_path:
        elements:
          - 'C:\\new\\bin'
        state: present
`,
  },
  {
    name: 'win_powershell',
    desc: 'Run a PowerShell script on Windows',
    snippet: `
    - name: Run PowerShell script
      ansible.windows.win_powershell:
        script: |
          Write-Host "Hello from PowerShell"
          $result = "done"
          $result
      register: ps_result
`,
  },
  {
    name: 'win_reboot',
    desc: 'Reboot a Windows machine',
    snippet: `
    - name: Reboot host
      ansible.windows.win_reboot:
        reboot_timeout: 300
        msg: Rebooting for maintenance
`,
  },
  {
    name: 'win_reg_stat',
    desc: 'Get information about a Windows registry key',
    snippet: `
    - name: Get registry key info
      ansible.windows.win_reg_stat:
        path: 'HKLM:\\SOFTWARE\\MyApp'
      register: reg_info
`,
  },
  {
    name: 'win_regedit',
    desc: 'Manage Windows registry keys and values',
    snippet: `
    - name: Set registry value
      ansible.windows.win_regedit:
        path: 'HKLM:\\SOFTWARE\\MyApp'
        name: MyValue
        data: my_data
        type: string
        state: present
`,
  },
  {
    name: 'win_service',
    desc: 'Manage Windows services',
    snippet: `
    - name: Manage Windows service
      ansible.windows.win_service:
        name: MyService
        start_mode: auto
        state: started
`,
  },
  {
    name: 'win_shell',
    desc: 'Run a shell command on Windows',
    snippet: `
    - name: Run shell command
      ansible.windows.win_shell: |
        echo Hello World
      register: shell_result
`,
  },
  {
    name: 'win_user',
    desc: 'Manage local Windows user accounts',
    snippet: `
    - name: Manage local user
      ansible.windows.win_user:
        name: myuser
        password: "{{ user_password }}"
        state: present
        groups:
          - Users
`,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const ctxItemStyle = {
  padding: '7px 14px',
  fontSize: '13px',
  color: 'var(--text)',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const ctxLabelStyle = {
  padding: '6px 14px 4px',
  fontSize: '11px',
  color: '#888',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '200px',
};

function CtxItem({ children, onClick }) {
  return (
    <div
      style={ctxItemStyle}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-bg)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function App() {
  // Playbook runner
  const [playResults, setPlayResults] = useState(null);
  const [taskResult, setTaskResult] = useState('No data yet');
  const [selectedIni, setSelectedIni] = useState('');
  const [selectedYaml, setSelectedYaml] = useState('');
  const [playbookStatus, setPlaybookStatus] = useState('');

  // File browser
  const [files, setFiles] = useState(null);
  const [cwd, setCwd] = useState('/');
  const [parentFolder, setParentFolder] = useState('/');
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, file, name, isYaml, isIni }
  const [newFile, setNewFile] = useState(null);  // { type: 'yaml'|'ini', name: '' }
  const [renameFile, setRenameFile] = useState(null); // { item, name }
  const [deleteFile, setDeleteFile] = useState(null); // { item }

  // Editor
  const [activeEditor, setActiveEditor] = useState(null); // { path, language }
  const [editorContent, setEditorContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [showTaskPanel, setShowTaskPanel] = useState(false);

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const newFileInputRef = useRef(null);
  const renameInputRef = useRef(null);

  useEffect(() => {
    getFiles();
    const dismiss = () => setCtxMenu(null);
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, []);

  // Focus the new-file input when it appears
  useEffect(() => {
    if (newFile !== null) newFileInputRef.current?.focus();
  }, [newFile?.type]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renameFile !== null) renameInputRef.current?.focus();
  }, [renameFile?.item]);

  // ── File browser ──────────────────────────────────────────────────────────

  function getFiles(fldr) {
    // Match original behaviour: prepend '/' so the backend's `find .${folder}`
    // becomes `find ./subdir` not `find .subdir` (the latter is a hidden-file search).
    const folder = (fldr && String(fldr).trim().length > 1) ? `/${fldr}` : '/';
    fetch(`${BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    })
      .then(r => r.json())
      .then(data => {
        setFiles(data);
        const dir = data.cwd || '/';
        setCwd(dir);
        const parts = dir.split('/').filter(Boolean);
        setParentFolder(parts.length > 0 ? '/' + parts.slice(0, -1).join('/') : '/');
      })
      .catch(console.error);
  }

  // Build full path consistent with what the backend expects
  function fullPath(item) {
    const name = item.split('/').pop();
    return `${cwd === '/' ? '' : cwd}/${name}`;
  }

  function selectFile(item) {
    const fp = fullPath(item);
    const name = item.split('/').pop();
    if (name.endsWith('.ini'))
      setSelectedIni(prev => prev === fp ? '' : fp);
    else if (name.endsWith('.yaml') || name.endsWith('.yml'))
      setSelectedYaml(prev => prev === fp ? '' : fp);
  }

  function handleContextMenu(e, item) {
    e.preventDefault();
    e.stopPropagation();
    const name = item.split('/').pop();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      item,
      name,
      isYaml: name.endsWith('.yaml') || name.endsWith('.yml'),
      isIni: name.endsWith('.ini'),
    });
  }

  // ── Editor ────────────────────────────────────────────────────────────────

  async function openEditor(item) {
    const fp = fullPath(item);
    const name = item.split('/').pop();
    try {
      const r = await fetch(`${BASE}/getfilecontent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fp }),
      });
      const d = await r.json();
      setActiveEditor({ path: fp, language: getLanguage(name) });
      setEditorContent(d.content);
      setSaveMsg('');
      setShowTaskPanel(false);
    } catch (err) {
      console.error(err);
    }
  }

  async function saveFile() {
    if (!activeEditor) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const r = await fetch(`${BASE}/savefile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: activeEditor.path, content: editorContent }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSaveMsg('Saved.');
    } catch (err) {
      setSaveMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ── New file creation ──────────────────────────────────────────────────────

  async function createFile() {
    if (!newFile?.name?.trim()) return;
    const ext = newFile.type === 'yaml' ? '.yaml' : '.ini';
    const safe = newFile.name.trim().replace(/[^\w.\-]/g, '_');
    const filename = safe.endsWith(ext) ? safe : safe + ext;
    const folder = cwd === '/' ? '' : cwd;
    const filePath = `${folder}/${filename}`;
    const template = newFile.type === 'yaml' ? NEW_YAML_TEMPLATE : NEW_INI_TEMPLATE;

    try {
      const r = await fetch(`${BASE}/savefile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: filePath, content: template }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setNewFile(null);
      getFiles(cwd);
      // Auto-open the new file in the editor
      const fakeCwd = cwd;
      const fakeItem = cwd === '/'
        ? filename
        : `${cwd.replace(/^\//, '')}/${filename}`;
      setTimeout(() => openEditorAbsolute(filePath, getLanguage(filename)), 300);
    } catch (err) {
      console.error(err);
    }
  }

  async function openEditorAbsolute(fp, language) {
    try {
      const r = await fetch(`${BASE}/getfilecontent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fp }),
      });
      const d = await r.json();
      setActiveEditor({ path: fp, language });
      setEditorContent(d.content);
      setSaveMsg('');
      setShowTaskPanel(false);
    } catch (err) {
      console.error(err);
    }
  }

  // ── Rename / Delete ───────────────────────────────────────────────────────

  async function doRename() {
    if (!renameFile?.name?.trim()) return;
    const safe = renameFile.name.trim().replace(/[^\w.\-]/g, '_');
    try {
      const r = await fetch(`${BASE}/renamefile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: renameFile.path, newName: safe }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      // Close editor if the renamed file was open
      if (activeEditor?.path === renameFile.path) setActiveEditor(null);
      setRenameFile(null);
      getFiles(cwd);
    } catch (err) {
      console.error(err);
    }
  }

  async function doDelete() {
    if (!deleteFile?.path) return;
    try {
      const r = await fetch(`${BASE}/deletefile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: deleteFile.path }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      // Close editor if the deleted file was open
      if (activeEditor?.path === deleteFile.path) setActiveEditor(null);
      setDeleteFile(null);
      getFiles(cwd);
    } catch (err) {
      console.error(err);
    }
  }

  // ── Task injection ────────────────────────────────────────────────────────

  function insertTask(snippet) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const pos = editor.getPosition();
    const range = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
    editor.executeEdits('insert-task', [{ range, text: snippet }]);
    editor.focus();
  }

  // ── Playbook runner ───────────────────────────────────────────────────────

  async function SendTask() {
    const elem = document.getElementById('taskoutput');
    if (await GetIsRunning()) {
      setPlaybookStatus('⚠ A playbook is already running. Please wait for it to finish.');
      return;
    }
    setPlaybookStatus('▶ Running…');
    setTaskResult('');
    const response = await fetch(`${BASE}/runplay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ ini: selectedIni, yaml: selectedYaml }),
    });
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      setTaskResult(prev => `${prev}${text}`);
      setTimeout(() => elem?.scrollTo({ top: elem.scrollHeight + 20, behavior: 'smooth' }), 100);
      if (text.startsWith('Process exited with code 0')) {
        const trimmed = text.substring('Process exited with code 0'.length).trim();
        setPlayResults(JSON.parse(trimmed));
        setPlaybookStatus('✔ Playbook execution completed!');
      } else if (text.includes('Process exited with code')) {
        setPlaybookStatus('✗ Playbook exited with errors.');
      }
    }
  }

  async function GetIsRunning() {
    const r = await fetch(`${BASE}/isrunning`);
    return (await r.json()).isRunning;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: ctxMenu.y, left: ctxMenu.x,
            zIndex: 9999, background: 'var(--code-bg)',
            border: '1px solid var(--border)', borderRadius: '6px',
            minWidth: '160px', boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
            overflow: 'hidden',
          }}
        >
          <div style={ctxLabelStyle}>{ctxMenu.name}</div>
          <CtxItem onClick={() => { openEditor(ctxMenu.item); setCtxMenu(null); }}>
            ✏️ Edit
          </CtxItem>
          {ctxMenu.isYaml && (
            <CtxItem onClick={() => {
              const fp = fullPath(ctxMenu.item);
              setSelectedYaml(prev => prev === fp ? '' : fp);
              setCtxMenu(null);
            }}>
              {selectedYaml === fullPath(ctxMenu.item) ? '☑ Deselect Playbook' : '▶ Set as Playbook'}
            </CtxItem>
          )}
          {ctxMenu.isIni && (
            <CtxItem onClick={() => {
              const fp = fullPath(ctxMenu.item);
              setSelectedIni(prev => prev === fp ? '' : fp);
              setCtxMenu(null);
            }}>
              {selectedIni === fullPath(ctxMenu.item) ? '☑ Deselect Hosts' : '🖥 Set as Hosts'}
            </CtxItem>
          )}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: '2px', paddingTop: '2px' }} />
          <CtxItem onClick={() => {
            const name = ctxMenu.item.split('/').pop();
            setRenameFile({ item: ctxMenu.item, path: fullPath(ctxMenu.item), name });
            setCtxMenu(null);
          }}>
            ✏ Rename
          </CtxItem>
          <CtxItem onClick={() => {
            setDeleteFile({ item: ctxMenu.item, path: fullPath(ctxMenu.item) });
            setCtxMenu(null);
          }}>
            <span style={{ color: '#f87171' }}>🗑 Delete</span>
          </CtxItem>
        </div>
      )}

      {/* ── File browser ── */}
      <section id="filebrowser">
        <div className="filebrowser" style={{ textAlign: 'left' }}>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>
            📂 <span title={cwd}>{cwd}</span>
          </div>

          {parentFolder !== cwd && (
            <div className="fileName" onClick={() => getFiles(parentFolder)} title="Go up">
              ↖ ..
            </div>
          )}

          {files?.folders?.map((item, i) => (
            <div key={i} className="fileName" title={item.split('/').pop()}
              onClick={() => getFiles(item)}>
              📁 {item.split('/').pop()}
            </div>
          )) ?? <p>Loading…</p>}

          {files?.files?.map((item, i) => {
            const fp = fullPath(item);
            const name = item.split('/').pop();
            const isSelected = fp === selectedYaml || fp === selectedIni;
            const isRenaming = renameFile?.item === item;
            const isDeleting = deleteFile?.item === item;

            if (isRenaming) {
              return (
                <div key={i} style={{ marginBottom: '8px' }}>
                  <input
                    ref={renameInputRef}
                    value={renameFile.name}
                    onChange={e => setRenameFile(f => ({ ...f, name: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') doRename();
                      if (e.key === 'Escape') setRenameFile(null);
                    }}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: '#0f0f1a', border: '1px solid #6366f1',
                      borderRadius: '4px', padding: '3px 6px',
                      color: 'var(--text)', fontSize: '12px', outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '4px', marginTop: '3px' }}>
                    <button onClick={doRename}
                      style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 0', fontSize: '11px', cursor: 'pointer' }}>
                      Rename
                    </button>
                    <button onClick={() => setRenameFile(null)}
                      style={{ background: 'var(--accent-bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', cursor: 'pointer' }}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            }

            if (isDeleting) {
              return (
                <div key={i} style={{ marginBottom: '8px', padding: '4px 6px', background: '#1f0000', border: '1px solid #7f1d1d', borderRadius: '4px', fontSize: '12px' }}>
                  <div style={{ color: '#fca5a5', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Delete {name}?</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={doDelete}
                      style={{ flex: 1, background: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 0', fontSize: '11px', cursor: 'pointer' }}>
                      Delete
                    </button>
                    <button onClick={() => setDeleteFile(null)}
                      style={{ background: 'var(--accent-bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={i}
                className="fileName"
                title={`Left-click to select · Right-click for options\n${item}`}
                onClick={() => selectFile(item)}
                onContextMenu={e => handleContextMenu(e, item)}
                style={isSelected ? { background: '#2a2a3e', borderColor: '#6366f1' } : {}}
              >
                📄 {name}
                {fp === selectedYaml && <span style={{ float: 'right', fontSize: '10px', color: '#818cf8' }}>▶</span>}
                {fp === selectedIni  && <span style={{ float: 'right', fontSize: '10px', color: '#34d399' }}>H</span>}
              </div>
            );
          }) ?? null}

          {/* New file controls */}
          <div style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '8px', display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setNewFile(f => f?.type === 'yaml' ? null : { type: 'yaml', name: '' })}
              style={{ flex: 1, background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: '4px', padding: '3px 0', fontSize: '11px', cursor: 'pointer' }}
            >+ YAML</button>
            <button
              onClick={() => setNewFile(f => f?.type === 'ini' ? null : { type: 'ini', name: '' })}
              style={{ flex: 1, background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: '4px', padding: '3px 0', fontSize: '11px', cursor: 'pointer' }}
            >+ INI</button>
          </div>

          {newFile && (
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '3px' }}>
                New .{newFile.type} in {cwd}
              </div>
              <input
                ref={newFileInputRef}
                placeholder={`filename.${newFile.type}`}
                value={newFile.name}
                onChange={e => setNewFile(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') createFile();
                  if (e.key === 'Escape') setNewFile(null);
                }}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0f0f1a', border: '1px solid var(--border)',
                  borderRadius: '4px', padding: '4px 6px',
                  color: 'var(--text)', fontSize: '12px', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                <button
                  onClick={createFile}
                  style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 0', fontSize: '11px', cursor: 'pointer' }}
                >Create</button>
                <button
                  onClick={() => setNewFile(null)}
                  style={{ background: 'var(--accent-bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer' }}
                >✕</button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Editor overlay ── */}
      {activeEditor && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setActiveEditor(null)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.55)',
              zIndex: 999,
            }}
          />
          {/* Panel */}
          <div style={{
            position: 'fixed', inset: '16px',
            zIndex: 1000,
            background: '#0f0f1a',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px', borderBottom: '1px solid var(--border)',
              background: '#111827', gap: '8px', flexShrink: 0,
            }}>
              <span style={{ fontSize: '12px', color: '#888', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>
                {activeEditor.path}
              </span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                {activeEditor.language === 'yaml' && (
                  <button
                    onClick={() => setShowTaskPanel(v => !v)}
                    style={{
                      background: showTaskPanel ? '#4f46e5' : '#374151',
                      color: '#fff', border: 'none', borderRadius: '5px',
                      padding: '3px 10px', fontSize: '11px', cursor: 'pointer',
                    }}
                  >
                    {showTaskPanel ? '▴ Tasks' : '▾ Insert Task'}
                  </button>
                )}
                {saveMsg && (
                  <span style={{ fontSize: '11px', color: saveMsg.startsWith('Error') ? '#f87171' : '#86efac' }}>
                    {saveMsg}
                  </span>
                )}
                <button
                  onClick={saveFile}
                  disabled={saving}
                  style={{
                    background: '#3b82f6', color: '#fff', border: 'none',
                    borderRadius: '5px', padding: '3px 12px', fontSize: '12px',
                    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
                  }}
                >{saving ? 'Saving…' : 'Save'}</button>
                <button
                  onClick={() => setActiveEditor(null)}
                  style={{
                    background: 'transparent', color: '#aaa', border: '1px solid var(--border)',
                    borderRadius: '4px', padding: '2px 8px', fontSize: '13px', cursor: 'pointer',
                  }}
                >✕</button>
              </div>
            </div>

            {/* Task injection panel */}
            {showTaskPanel && activeEditor.language === 'yaml' && (
              <div style={{
                padding: '8px 12px',
                background: '#111827',
                borderBottom: '1px solid #1f2937',
                flexShrink: 0,
              }}>
                <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
                  Click a module to scaffold it at the cursor position
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {WIN_TASKS.map(task => (
                    <button
                      key={task.name}
                      title={task.desc}
                      onClick={() => insertTask(task.snippet)}
                      style={{
                        background: '#1e293b', color: '#a5b4fc',
                        border: '1px solid #334155', borderRadius: '4px',
                        padding: '3px 8px', fontSize: '11px',
                        cursor: 'pointer', fontFamily: 'monospace',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#293548')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#1e293b')}
                    >
                      {task.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Editor fills remaining height */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Editor
                height="100%"
                language={activeEditor.language}
                value={editorContent}
                onChange={val => setEditorContent(val ?? '')}
                theme="vs-dark"
                onMount={(editor, monaco) => {
                  editorRef.current = editor;
                  monacoRef.current = monaco;
                }}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                }}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Center panel ── */}
      <section id="center">

        <hr style={{ margin: '20px', backgroundColor: '#252525', border: 'none', borderTop: '1px solid #252525' }} />

        {/* Playbook runner */}
        <div>
          <h3>Ansible playbook results</h3>
          <div style={{ fontSize: '13px', color: '#aaa' }}>
            Playbook: {selectedYaml
              ? <span style={{ color: '#818cf8' }}>{selectedYaml}</span>
              : <span style={{ color: '#555' }}>none selected — right-click a YAML file</span>}
          </div>
          <div style={{ fontSize: '13px', color: '#aaa', marginBottom: '8px' }}>
            Hosts: {selectedIni
              ? <span style={{ color: '#34d399' }}>{selectedIni}</span>
              : <span style={{ color: '#555' }}>none selected — right-click an INI file</span>}
          </div>

          <button
            className="counter"
            onClick={SendTask}
            disabled={!selectedYaml || !selectedIni}
          >
            Run playbook
          </button>
          {playbookStatus && (
            <span style={{
              marginLeft: '12px', fontSize: '13px',
              color: playbookStatus.startsWith('✔') ? '#86efac'
                   : playbookStatus.startsWith('✗') ? '#fca5a5'
                   : '#94a3b8',
            }}>
              {playbookStatus}
            </span>
          )}

          <div id="taskoutput" className="subpanel" style={{ maxHeight: '400px', margin: '20px' }}>
            <div style={{ textAlign: 'left' }}>
              <h4>Task output:</h4>
              <div style={{ font: '12px monospace', margin: '10px' }}>
                {typeof taskResult === 'string' ? <pre>{taskResult}</pre> : JSON.stringify(taskResult)}
              </div>
            </div>
          </div>

          <div className="subpanel" style={{ maxHeight: '400px', margin: '20px' }}>
            <div style={{ textAlign: 'left' }}>
              <h4>Play output:</h4>
              {typeof playResults === 'object' && playResults != null
                ? Object.entries(playResults.msg.plays).map(([key, value]) =>
                    value.tasks
                      ? Object.entries(value.tasks).map(([taskKey, taskValue]) =>
                          taskValue.hosts
                            ? Object.entries(taskValue.hosts).map(([hostKey, hostValue]) => (
                              <div style={{ font: '14px Segoe UI', margin: '10px' }} key={`${key}-${taskKey}-${hostKey}`}>
                                <h4>Task: {taskValue.task.name}</h4>
                                <h4>Host: {hostKey}</h4>
                                <h4>Start: {taskValue.task.duration.start}</h4>
                                <h4>End: {taskValue.task.duration.end}</h4>
                                <hr style={{ margin: '20px', backgroundColor: '#252525' }} />
                                <pre>{hostValue.stdout}</pre>
                              </div>
                            ))
                            : ''
                        )
                      : ''
                  )
                : ''}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export default App;
