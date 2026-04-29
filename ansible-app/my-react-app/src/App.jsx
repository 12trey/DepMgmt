import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Folder, FileText, ChevronUp, Play, Server } from 'lucide-react';
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

const clearBtnStyle = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: '#9ca3af',
  fontSize: '11px',
  lineHeight: 1,
  padding: '2px 4px',
  borderRadius: '3px',
  flexShrink: 0,
};

const ctxItemStyle = {
  padding: '6px 12px',
  fontSize: '13px',
  color: '#374151',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const ctxLabelStyle = {
  padding: '6px 12px 5px',
  fontSize: '11px',
  color: '#6b7280',
  borderBottom: '1px solid #e5e7eb',
  fontFamily: 'ui-monospace, Consolas, monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '220px',
  background: '#f9fafb',
};

function CtxItem({ children, onClick }) {
  return (
    <div
      style={ctxItemStyle}
      onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
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
  const [selectedAnsibleCfg, setSelectedAnsibleCfg] = useState('');
  const [playbookStatus, setPlaybookStatus] = useState('');

  // ansible.cfg file picker
  const [showCfgPicker, setShowCfgPicker] = useState(false);
  const [cfgPickerFiles, setCfgPickerFiles] = useState(null);
  const [cfgPickerCwd, setCfgPickerCwd] = useState('/');

  // File browser
  const [files, setFiles] = useState(null);
  const [cwd, setCwd] = useState('/');
  const [parentFolder, setParentFolder] = useState('/');
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, file, name, isYaml, isIni }
  const [newFile, setNewFile] = useState(null);  // { type: 'yaml'|'ini', name: '' }
  const [newDir, setNewDir] = useState(null);    // { name: '' }
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
  const newDirInputRef = useRef(null);
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

  // Focus the new-dir input when it appears
  useEffect(() => {
    if (newDir !== null) newDirInputRef.current?.focus();
  }, [newDir]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renameFile !== null) renameInputRef.current?.focus();
  }, [renameFile?.item]);

  // ── File browser ──────────────────────────────────────────────────────────

  function getFiles(fldr) {
    // Strip any leading slashes from fldr before prepending exactly one, so that
    // passing an already-absolute path like '/subfolder' doesn't produce '//subfolder'.
    const raw = fldr ? String(fldr).trim().replace(/^\/+/, '') : '';
    const folder = raw.length > 0 ? `/${raw}` : '/';
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

  async function createDir() {
    if (!newDir?.name?.trim()) return;
    const safe = newDir.name.trim().replace(/[^\w.\-]/g, '_');
    const folder = cwd === '/' ? '' : cwd;
    const dirPath = `${folder}/${safe}`;
    try {
      const r = await fetch(`${BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: dirPath }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setNewDir(null);
      getFiles(cwd);
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

  // ── ansible.cfg picker ────────────────────────────────────────────────────

  function getCfgFiles(fldr) {
    const folder = fldr && fldr.startsWith('/') ? fldr : '/';
    fetch(`${BASE}/browse?path=${encodeURIComponent(folder)}&files=1`)
      .then(r => r.json())
      .then(data => {
        setCfgPickerFiles(data);
        setCfgPickerCwd(data.path || '/');
      })
      .catch(console.error);
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
      body: JSON.stringify({ ini: selectedIni, yaml: selectedYaml, ansibleConfig: selectedAnsibleCfg }),
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
            zIndex: 9999, background: '#fff',
            border: '1px solid #e5e7eb', borderRadius: '8px',
            minWidth: '170px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
            overflow: 'hidden', padding: '4px 0',
          }}
        >
          <div style={ctxLabelStyle}>{ctxMenu.name}</div>
          <CtxItem onClick={() => { openEditor(ctxMenu.item); setCtxMenu(null); }}>
            Edit
          </CtxItem>
          {ctxMenu.isYaml && (
            <CtxItem onClick={() => {
              const fp = fullPath(ctxMenu.item);
              setSelectedYaml(prev => prev === fp ? '' : fp);
              setCtxMenu(null);
            }}>
              {selectedYaml === fullPath(ctxMenu.item) ? 'Deselect Playbook' : 'Set as Playbook'}
            </CtxItem>
          )}
          {ctxMenu.isIni && (
            <CtxItem onClick={() => {
              const fp = fullPath(ctxMenu.item);
              setSelectedIni(prev => prev === fp ? '' : fp);
              setCtxMenu(null);
            }}>
              {selectedIni === fullPath(ctxMenu.item) ? 'Deselect Hosts' : 'Set as Hosts'}
            </CtxItem>
          )}
          <div style={{ borderTop: '1px solid #e5e7eb', margin: '4px 0' }} />
          <CtxItem onClick={() => {
            const name = ctxMenu.item.split('/').pop();
            setRenameFile({ item: ctxMenu.item, path: fullPath(ctxMenu.item), name });
            setCtxMenu(null);
          }}>
            Rename
          </CtxItem>
          <CtxItem onClick={() => {
            setDeleteFile({ item: ctxMenu.item, path: fullPath(ctxMenu.item) });
            setCtxMenu(null);
          }}>
            <span style={{ color: '#dc2626' }}>Delete</span>
          </CtxItem>
        </div>
      )}

      {/* ── ansible.cfg picker modal ── */}
      {showCfgPicker && (
        <>
          <div onClick={() => setShowCfgPicker(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1999 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 2000, background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)', width: '480px', maxHeight: '480px',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>Select ansible.cfg</span>
              <button onClick={() => setShowCfgPicker(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '16px', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: '6px 16px', fontSize: '11px', color: '#6b7280', fontFamily: 'ui-monospace, Consolas, monospace', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cfgPickerCwd}
            </div>
            {cfgPickerFiles?.worldWritable && (
              <div style={{ padding: '8px 16px', background: '#fefce8', borderBottom: '1px solid #fde68a', fontSize: '12px', color: '#92400e', flexShrink: 0 }}>
                ⚠ This directory is world-writable. Ansible will not load a config file from here for security reasons.
              </div>
            )}
            <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
              {cfgPickerFiles?.parent !== null && cfgPickerFiles?.parent !== undefined && (
                <div
                  style={{ padding: '6px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => getCfgFiles(cfgPickerFiles.parent)}
                >
                  <ChevronUp size={14} style={{ color: '#9ca3af', flexShrink: 0 }} />
                  <span>..</span>
                </div>
              )}
              {cfgPickerFiles?.dirs?.map((name, i) => {
                const fullDir = cfgPickerCwd === '/' ? `/${name}` : `${cfgPickerCwd}/${name}`;
                return (
                  <div key={i}
                    style={{ padding: '6px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => getCfgFiles(fullDir)}
                  >
                    <Folder size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    <span>{name}</span>
                  </div>
                );
              }) ?? <p style={{ fontSize: '13px', color: '#9ca3af', padding: '8px 16px' }}>Loading…</p>}
              {cfgPickerFiles?.files?.map((name, i) => {
                const isCfg = name.endsWith('.cfg');
                const selectable = isCfg && !cfgPickerFiles.worldWritable;
                const absPath = cfgPickerCwd === '/' ? `/${name}` : `${cfgPickerCwd}/${name}`;
                return (
                  <div key={i}
                    style={{ padding: '6px 16px', cursor: selectable ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', opacity: selectable ? 1 : 0.35 }}
                    onMouseEnter={e => { if (selectable) e.currentTarget.style.background = '#f5f3ff'; }}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => {
                      if (!selectable) return;
                      setSelectedAnsibleCfg(absPath);
                      setShowCfgPicker(false);
                    }}
                  >
                    <FileText size={14} style={{ color: isCfg ? '#7c3aed' : '#9ca3af', flexShrink: 0 }} />
                    <span>{name}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button onClick={() => setShowCfgPicker(false)} className="btn-secondary" style={{ fontSize: '12px', padding: '4px 12px' }}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {/* ── File browser ── */}
      <section id="filebrowser">
        <div className="filebrowser">
          {/* Path breadcrumb */}
          <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px', fontFamily: 'ui-monospace, Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cwd}
          </div>

          {parentFolder !== cwd && (
            <div className="fileName" onClick={() => getFiles(parentFolder)} title="Go up one folder">
              <ChevronUp size={14} style={{ marginRight: '5px', color: '#9ca3af', flexShrink: 0 }} />
              <span>..</span>
            </div>
          )}

          {files?.folders?.map((item, i) => (
            <div key={i} className="fileName" title={item.split('/').pop()} onClick={() => getFiles(item)}>
              <Folder size={14} style={{ marginRight: '6px', color: '#f59e0b', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.split('/').pop()}</span>
            </div>
          )) ?? <p style={{ fontSize: '13px', color: '#9ca3af' }}>Loading…</p>}

          {files?.files?.map((item, i) => {
            const fp = fullPath(item);
            const name = item.split('/').pop();
            const isYamlSel = fp === selectedYaml;
            const isIniSel  = fp === selectedIni;
            const isSelected = isYamlSel || isIniSel;
            const isRenaming = renameFile?.item === item;
            const isDeleting = deleteFile?.item === item;

            if (isRenaming) {
              return (
                <div key={i} style={{ marginBottom: '6px' }}>
                  <input
                    ref={renameInputRef}
                    value={renameFile.name}
                    onChange={e => setRenameFile(f => ({ ...f, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenameFile(null); }}
                    className="app-input"
                  />
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                    <button onClick={doRename} className="btn-primary" style={{ flex: 1, padding: '4px 0', fontSize: '12px', justifyContent: 'center' }}>Rename</button>
                    <button onClick={() => setRenameFile(null)} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }}>✕</button>
                  </div>
                </div>
              );
            }

            if (isDeleting) {
              return (
                <div key={i} style={{ marginBottom: '6px', padding: '8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ color: '#991b1b', marginBottom: '6px', fontWeight: 500 }}>Delete {name}?</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={doDelete} style={{ flex: 1, background: '#dc2626', color: '#fff', border: 'none', borderRadius: '5px', padding: '4px 0', fontSize: '12px', cursor: 'pointer', fontWeight: 500 }}>Delete</button>
                    <button onClick={() => setDeleteFile(null)} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }}>Cancel</button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={i}
                className={`fileName${isSelected ? ' selected' : ''}`}
                title={`Left-click to select · Right-click for options\n${item}`}
                onClick={() => selectFile(item)}
                onContextMenu={e => handleContextMenu(e, item)}
              >
                <FileText size={14} style={{ marginRight: '6px', color: '#6b7280', flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                {isYamlSel && <Play size={10} style={{ color: '#2563eb', flexShrink: 0, marginLeft: '4px' }} />}
                {isIniSel  && <Server size={10} style={{ color: '#059669', flexShrink: 0, marginLeft: '4px' }} />}
              </div>
            );
          }) ?? null}

          {/* New file/folder controls */}
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '6px' }}>
            <button
              onClick={() => { setNewFile(f => f?.type === 'yaml' ? null : { type: 'yaml', name: '' }); setNewDir(null); }}
              className="btn-secondary"
              style={{ flex: 1, justifyContent: 'center', padding: '4px 0', fontSize: '12px' }}
            >+ YAML</button>
            <button
              onClick={() => { setNewFile(f => f?.type === 'ini' ? null : { type: 'ini', name: '' }); setNewDir(null); }}
              className="btn-secondary"
              style={{ flex: 1, justifyContent: 'center', padding: '4px 0', fontSize: '12px' }}
            >+ INI</button>
            <button
              onClick={() => { setNewDir(d => d ? null : { name: '' }); setNewFile(null); }}
              className="btn-secondary"
              style={{ flex: 1, justifyContent: 'center', padding: '4px 0', fontSize: '12px' }}
            >+ Folder</button>
          </div>

          {newFile && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                New .{newFile.type} file in <span style={{ fontFamily: 'monospace' }}>{cwd}</span>
              </div>
              <input
                ref={newFileInputRef}
                placeholder={`filename.${newFile.type}`}
                value={newFile.name}
                onChange={e => setNewFile(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') createFile(); if (e.key === 'Escape') setNewFile(null); }}
                className="app-input"
              />
              <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                <button onClick={createFile} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '5px 0', fontSize: '12px' }}>Create</button>
                <button onClick={() => setNewFile(null)} className="btn-secondary" style={{ padding: '5px 10px', fontSize: '12px' }}>✕</button>
              </div>
            </div>
          )}

          {newDir && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                New folder in <span style={{ fontFamily: 'monospace' }}>{cwd}</span>
              </div>
              <input
                ref={newDirInputRef}
                placeholder="folder-name"
                value={newDir.name}
                onChange={e => setNewDir(d => ({ ...d, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') createDir(); if (e.key === 'Escape') setNewDir(null); }}
                className="app-input"
              />
              <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                <button onClick={createDir} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '5px 0', fontSize: '12px' }}>Create</button>
                <button onClick={() => setNewDir(null)} className="btn-secondary" style={{ padding: '5px 10px', fontSize: '12px' }}>✕</button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Editor overlay ── */}
      {activeEditor && (
        <>
          <div onClick={() => setActiveEditor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999 }} />
          <div style={{
            position: 'fixed', inset: '16px', zIndex: 1000,
            background: '#1e1e1e',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px', borderBottom: '1px solid #374151',
              background: '#111827', gap: '8px', flexShrink: 0,
            }}>
              <span style={{ fontSize: '12px', color: '#9ca3af', fontFamily: 'ui-monospace, Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>
                {activeEditor.path}
              </span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                {activeEditor.language === 'yaml' && (
                  <button
                    onClick={() => setShowTaskPanel(v => !v)}
                    style={{
                      background: showTaskPanel ? '#1e3a5f' : '#1f2937',
                      color: showTaskPanel ? '#93c5fd' : '#d1d5db',
                      border: `1px solid ${showTaskPanel ? '#3b82f6' : '#374151'}`,
                      borderRadius: '5px', padding: '3px 10px',
                      fontSize: '12px', cursor: 'pointer', fontWeight: 500,
                    }}
                  >
                    {showTaskPanel ? '▴ Tasks' : '▾ Insert Task'}
                  </button>
                )}
                {saveMsg && (
                  <span style={{ fontSize: '12px', color: saveMsg.startsWith('Error') ? '#fca5a5' : '#86efac', fontWeight: 500 }}>
                    {saveMsg}
                  </span>
                )}
                <button
                  onClick={saveFile}
                  disabled={saving}
                  style={{
                    background: saving ? '#1d4ed8' : '#2563eb', color: '#fff', border: 'none',
                    borderRadius: '6px', padding: '4px 14px', fontSize: '13px',
                    fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
                  }}
                >{saving ? 'Saving…' : 'Save'}</button>
                <button
                  onClick={() => setActiveEditor(null)}
                  style={{
                    background: 'transparent', color: '#9ca3af',
                    border: '1px solid #374151', borderRadius: '5px',
                    padding: '3px 10px', fontSize: '13px', cursor: 'pointer',
                  }}
                >✕</button>
              </div>
            </div>

            {/* Task injection panel */}
            {showTaskPanel && activeEditor.language === 'yaml' && (
              <div style={{ padding: '8px 12px', background: '#111827', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
                <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
                  Click a module to insert a scaffold at the cursor
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {WIN_TASKS.map(task => (
                    <button
                      key={task.name}
                      title={task.desc}
                      onClick={() => insertTask(task.snippet)}
                      style={{
                        background: '#1e293b', color: '#93c5fd',
                        border: '1px solid #334155', borderRadius: '4px',
                        padding: '3px 8px', fontSize: '11px',
                        cursor: 'pointer', fontFamily: 'ui-monospace, Consolas, monospace',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#1e3a5f')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#1e293b')}
                    >
                      {task.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Editor
                height="100%"
                language={activeEditor.language}
                value={editorContent}
                onChange={val => setEditorContent(val ?? '')}
                theme="vs-dark"
                onMount={(editor, monaco) => { editorRef.current = editor; monacoRef.current = monaco; }}
                options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true }}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Center panel ── */}
      <section id="center">
        <div className="card">
          <h3 style={{ marginBottom: '12px' }}>Ansible Playbook Runner</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
            <div style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#6b7280', width: '64px', flexShrink: 0 }}>Playbook:</span>
              {selectedYaml
                ? <>
                    <span style={{ color: '#2563eb', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', background: '#eff6ff', padding: '2px 6px', borderRadius: '4px' }}>{selectedYaml}</span>
                    <button onClick={() => setSelectedYaml('')} title="Deselect" style={clearBtnStyle}>✕</button>
                  </>
                : <span style={{ color: '#9ca3af', fontSize: '12px' }}>none — right-click a YAML file to select</span>}
            </div>
            <div style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#6b7280', width: '64px', flexShrink: 0 }}>Hosts:</span>
              {selectedIni
                ? <>
                    <span style={{ color: '#059669', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', background: '#f0fdf4', padding: '2px 6px', borderRadius: '4px' }}>{selectedIni}</span>
                    <button onClick={() => setSelectedIni('')} title="Deselect" style={clearBtnStyle}>✕</button>
                  </>
                : <span style={{ color: '#9ca3af', fontSize: '12px' }}>none — right-click an INI file to select</span>}
            </div>
            <div style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#6b7280', width: '64px', flexShrink: 0 }}>Config:</span>
              {selectedAnsibleCfg
                ? <>
                    <span style={{ color: '#7c3aed', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', background: '#f5f3ff', padding: '2px 6px', borderRadius: '4px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>{selectedAnsibleCfg}</span>
                    <button onClick={() => setSelectedAnsibleCfg('')} title="Clear" style={clearBtnStyle}>✕</button>
                  </>
                : <>
                    <span style={{ color: '#9ca3af', fontSize: '12px' }}>none (optional)</span>
                    <button
                      onClick={() => { setShowCfgPicker(true); getCfgFiles('/'); }}
                      className="btn-secondary"
                      style={{ fontSize: '11px', padding: '2px 8px', marginLeft: '4px' }}
                    >Browse…</button>
                  </>}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="counter" onClick={SendTask} disabled={!selectedYaml || !selectedIni}>
              ▶ Run Playbook
            </button>
            {playbookStatus && (
              <span style={{
                fontSize: '13px', fontWeight: 500,
                color: playbookStatus.startsWith('✔') ? '#059669'
                     : playbookStatus.startsWith('✗') ? '#dc2626'
                     : '#6b7280',
              }}>
                {playbookStatus}
              </span>
            )}
          </div>
        </div>

        <div className="subpanel" style={{ maxHeight: '340px' }}>
          <h4 style={{ marginBottom: '8px' }}>Raw output</h4>
          <div id="taskoutput" style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', color: '#374151', overflow: 'auto', maxHeight: '260px' }}>
            {typeof taskResult === 'string'
              ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{taskResult || <span style={{ color: '#9ca3af' }}>No output yet.</span>}</pre>
              : JSON.stringify(taskResult)}
          </div>
        </div>

        <div className="subpanel" style={{ maxHeight: '340px' }}>
          <h4 style={{ marginBottom: '8px' }}>Formatted output</h4>
          <div style={{ overflow: 'auto', maxHeight: '270px' }}>
            {typeof playResults === 'object' && playResults != null
              ? Object.entries(playResults.msg.plays).map(([key, value]) =>
                  value.tasks
                    ? Object.entries(value.tasks).map(([taskKey, taskValue]) =>
                        taskValue.hosts
                          ? Object.entries(taskValue.hosts).map(([hostKey, hostValue]) => (
                            <div key={`${key}-${taskKey}-${hostKey}`} style={{ marginBottom: '12px', padding: '10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', marginBottom: '8px' }}>
                                <span style={{ color: '#6b7280', fontWeight: 500 }}>Task</span><span>{taskValue.task.name}</span>
                                <span style={{ color: '#6b7280', fontWeight: 500 }}>Host</span><span>{hostKey}</span>
                                <span style={{ color: '#6b7280', fontWeight: 500 }}>Start</span><span>{taskValue.task.duration.start}</span>
                                <span style={{ color: '#6b7280', fontWeight: 500 }}>End</span><span>{taskValue.task.duration.end}</span>
                              </div>
                              <pre style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', margin: 0, background: '#fff', padding: '8px', borderRadius: '4px', border: '1px solid #e5e7eb', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{ hostValue.stdout ? hostValue.stdout : hostValue.output ? hostValue.output : hostValue.msg ? hostValue.msg : "" }</pre>
                            </div>
                          ))
                          : null
                      )
                    : null
                )
              : <span style={{ color: '#9ca3af', fontSize: '13px' }}>No results yet.</span>}
          </div>
        </div>
      </section>
    </>
  );
}

export default App;
