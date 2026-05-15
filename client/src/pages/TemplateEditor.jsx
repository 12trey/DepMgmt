import { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Save, RotateCcw, Loader, FileCode } from 'lucide-react';
import { readTemplate, saveTemplate, resetTemplate } from '../api';

const V4_FILES = [
  { file: 'Invoke-AppDeployToolkit.ps1.hbs', label: 'Invoke-AppDeployToolkit.ps1', language: 'powershell' },
  { file: 'Config.psd1.hbs',                 label: 'Config.psd1',                 language: 'powershell' },
];
const V3_FILES = [
  { file: 'Deploy-Application.ps1.hbs',       label: 'Deploy-Application.ps1',      language: 'powershell' },
  { file: 'AppDeployToolkitConfig.xml.hbs',   label: 'AppDeployToolkitConfig.xml',  language: 'xml' },
];

export default function TemplateEditor() {
  const [psadtVersion, setPsadtVersion] = useState('v4');
  const [selectedFile, setSelectedFile] = useState(V4_FILES[0]);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isCustom, setIsCustom] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('info');
  const [pendingReset, setPendingReset] = useState(false);

  const loadFile = useCallback(async (version, fileObj) => {
    setLoading(true);
    setMsg('');
    setPendingReset(false);
    try {
      const data = await readTemplate(version, fileObj.file);
      setContent(data.content);
      setOriginalContent(data.content);
      setIsCustom(data.isCustom);
    } catch (err) {
      setMsg(`Error loading template: ${err.message}`);
      setMsgType('error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load initial file on first render
  useEffect(() => { loadFile('v4', V4_FILES[0]); }, []);

  const handleSelectVersion = (v) => {
    const files = v === 'v4' ? V4_FILES : V3_FILES;
    setPsadtVersion(v);
    setSelectedFile(files[0]);
    loadFile(v, files[0]);
  };

  const handleSelectFile = (f) => {
    setSelectedFile(f);
    loadFile(psadtVersion, f);
  };

  const isDirty = content !== originalContent;

  const handleSave = async () => {
    if (!isDirty) return;
    setSaving(true);
    setMsg('');
    try {
      await saveTemplate(psadtVersion, selectedFile.file, content);
      setOriginalContent(content);
      setIsCustom(true);
      setMsg('Saved. New and regenerated packages will use this template.');
      setMsgType('info');
    } catch (err) {
      setMsg(`Error: ${err.message}`);
      setMsgType('error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setPendingReset(false);
    try {
      await resetTemplate(psadtVersion, selectedFile.file);
      setMsg('Reset to bundled default.');
      setMsgType('info');
      setIsCustom(false);
      await loadFile(psadtVersion, selectedFile);
    } catch (err) {
      setMsg(`Error: ${err.message}`);
      setMsgType('error');
    }
  };

  const files = psadtVersion === 'v4' ? V4_FILES : V3_FILES;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 100px)' }}>
      <div className="flex items-center gap-3 mb-6">
        <FileCode size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold">Template Editor</h1>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-44 flex-shrink-0 space-y-4">
          <div className="bg-white rounded-lg shadow p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">PSADT Version</p>
            {['v4', 'v3'].map(v => (
              <button
                key={v}
                onClick={() => handleSelectVersion(v)}
                className={`w-full text-left px-3 py-2 rounded text-sm mb-1 transition-colors ${
                  psadtVersion === v
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {v === 'v4' ? 'PSADT v4.1.x' : 'PSADT v3'}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Template File</p>
            {files.map(f => (
              <button
                key={f.file}
                onClick={() => handleSelectFile(f)}
                className={`w-full text-left px-3 py-2 rounded text-xs mb-1 font-mono leading-tight transition-colors ${
                  selectedFile.file === f.file
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            Changes apply when packages are <strong>created</strong> or <strong>regenerated</strong>. Existing package scripts are not updated automatically.
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col min-h-0 space-y-3">
          {/* Toolbar */}
          <div className="bg-white rounded-lg shadow px-4 py-3 flex items-center gap-3 flex-shrink-0">
            <span className="text-sm font-medium font-mono flex-1">{selectedFile.label}</span>
            {isCustom ? (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Customized</span>
            ) : (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Default</span>
            )}
            {msg && (
              <span className={`text-xs ${msgType === 'error' ? 'text-red-600' : 'text-green-600'}`}>{msg}</span>
            )}
            {isCustom && !pendingReset && (
              <button onClick={() => setPendingReset(true)} className="btn-secondary text-sm flex items-center gap-1.5">
                <RotateCcw size={13} /> Reset to Default
              </button>
            )}
            {pendingReset && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-700 font-medium">Reset and lose changes?</span>
                <button onClick={handleReset} className="text-xs bg-red-600 text-white px-2.5 py-1 rounded hover:bg-red-700">Confirm</button>
                <button onClick={() => setPendingReset(false)} className="btn-secondary text-xs py-1">Cancel</button>
              </div>
            )}
            <button onClick={handleSave} disabled={saving || loading || !isDirty} className="btn-primary text-sm flex items-center gap-1.5">
              {saving ? <><Loader size={13} className="animate-spin" /> Saving...</> : <><Save size={13} /> Save</>}
            </button>
          </div>

          {/* Monaco editor */}
          <div className="flex-1 bg-[#1e1e1e] rounded-lg overflow-hidden min-h-0">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader size={20} className="animate-spin text-gray-400" />
              </div>
            ) : (
              <Editor
                height="100%"
                language={selectedFile.language}
                value={content}
                onChange={val => setContent(val ?? '')}
                theme="vs-dark"
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  tabSize: 4,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
