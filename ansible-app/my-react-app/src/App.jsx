import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import './App.css';

const BASE = 'http://localhost:7000';

function getLanguage(filename) {
  if (!filename) return 'plaintext';
  if (filename.endsWith('.yaml') || filename.endsWith('.yml')) return 'yaml';
  if (filename.endsWith('.ini')) return 'ini';
  return 'plaintext';
}

function App() {
  const [playResults, setPlayResults] = useState(null);
  const [taskResult, setTaskResult] = useState('No data yet');
  const [files, setFiles] = useState(null);
  const [cwd, setCwd] = useState('/');
  const [parentFolder, setParentFolder] = useState('/');

  const [iniContent, setIniContent] = useState('');
  const [yamlContent, setYamlContent] = useState('');
  const [selectedIni, setSelectedIni] = useState('');
  const [selectedYaml, setSelectedYaml] = useState('');

  // Currently focused editor: { path, content, language } | null
  const [activeEditor, setActiveEditor] = useState(null);
  const [editorContent, setEditorContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  async function SendTask() {
    let elem = document.getElementById('taskoutput');
    let isRunning = await GetIsRunning();
    if (isRunning) {
      alert('A playbook is already running. Please wait for it to finish before starting a new one.');
      return;
    }
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
      var text = new TextDecoder().decode(value);
      setTaskResult(prev => `${prev}${text}`);
      setTimeout(() => {
        elem?.scrollTo({ top: elem.scrollHeight + 20, behavior: 'smooth' });
      }, 100);
      if (`${text}`.startsWith('Process exited with code 0')) {
        let trimmed = text.substring('Process exited with code 0'.length).trim();
        setPlayResults(JSON.parse(trimmed));
        alert('Playbook execution completed!');
      }
    }
  }

  async function GetIsRunning() {
    const response = await fetch(`${BASE}/isrunning`);
    const data = await response.json();
    return data.isRunning;
  }

  function getFiles() {
    let fldr = arguments.length && arguments[0]?.trim().length > 1 ? `/${arguments[0]}` : '/';
    fetch(`${BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: fldr }),
    })
      .then(r => r.json())
      .then(data => {
        setFiles(data);
        setCwd(data.cwd);
        let pfldr = '/' + data.cwd.split('/').filter(Boolean).slice(0, -1).join('/');
        setParentFolder(pfldr);
      })
      .catch(console.error);
  }

  useEffect(() => { getFiles(); }, []);

  function checkItem(filepath) {
    var e = filepath.split('/').pop();
    var isIni = e.endsWith('.ini');
    var isYaml = e.endsWith('.yaml') || e.endsWith('.yml');

    fetch(`${BASE}/getfilecontent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: `${cwd}/${e}` }),
    })
      .then(r => r.json())
      .then(data => {
        const fullPath = `${cwd}/${e}`;
        if (isIni) {
          setSelectedIni(selectedIni === fullPath ? '' : fullPath);
          setIniContent(data.content);
        } else if (isYaml) {
          setSelectedYaml(selectedYaml === fullPath ? '' : fullPath);
          setYamlContent(data.content);
        }
        // Open in editor
        setActiveEditor({ path: fullPath, language: getLanguage(e) });
        setEditorContent(data.content);
        setSaveMsg('');
      })
      .catch(console.error);
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
      // Sync back to whichever role this file had
      if (activeEditor.path === selectedIni) setIniContent(editorContent);
      if (activeEditor.path === selectedYaml) setYamlContent(editorContent);
    } catch (err) {
      setSaveMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section id="filebrowser">
        <div className="filebrowser" style={{ textAlign: 'left' }}>
          <div>Current directory: <span title={cwd}>{cwd}</span></div>
          {parentFolder !== cwd && (
            <div className="fileName" onClick={() => getFiles(parentFolder)} title="Previous folder">
              ↖️ {parentFolder}
            </div>
          )}
          <div>
            {files?.folders
              ? files.folders.map((item, i) => (
                <div key={i} className="fileName" title={item.split('/').pop()} onClick={() => getFiles(item)}>
                  📁 {item.split('/').pop()}
                </div>
              ))
              : <p>Loading folders…</p>}
          </div>
          {files?.files
            ? files.files.map((item, i) => (
              <div
                key={i}
                className="fileName"
                title={item.split('/').pop()}
                onClick={() => checkItem(item)}
                style={
                  item === selectedIni || item === selectedYaml
                    ? { background: '#2a2a3e', borderRadius: '4px' }
                    : {}
                }
              >
                📄 {item.split('/').pop()}
              </div>
            ))
            : <p>Loading files…</p>}
        </div>
      </section>

      <section id="center">
        {/* ── Monaco editor panel ── */}
        {activeEditor ? (
          <div className="subpanel" style={{ margin: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: '#aaa', fontFamily: 'monospace' }}>
                {activeEditor.path}
              </span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {saveMsg && (
                  <span style={{ fontSize: '12px', color: saveMsg.startsWith('Error') ? '#f88' : '#8f8' }}>
                    {saveMsg}
                  </span>
                )}
                <button
                  onClick={saveFile}
                  disabled={saving}
                  style={{
                    background: '#3b82f6', color: '#fff', border: 'none',
                    borderRadius: '5px', padding: '4px 12px', fontSize: '12px',
                    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            <Editor
              height="320px"
              language={activeEditor.language}
              value={editorContent}
              onChange={(val) => setEditorContent(val ?? '')}
              theme="vs-dark"
              options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
              }}
            />
          </div>
        ) : (
          <div style={{ margin: '20px', color: '#888', fontSize: '13px' }}>
            Select a file from the browser to edit it.
          </div>
        )}

        <hr style={{ margin: '20px', backgroundColor: '#252525' }} />

        <div>
          <h3>Ansible playbook results</h3>
          <div>Playbook path: {selectedYaml}</div>
          <div>Host path: {selectedIni}</div>
          <button
            className="counter"
            onClick={() => SendTask()}
            disabled={!selectedYaml || !selectedIni}
          >
            Run playbook
          </button>
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
