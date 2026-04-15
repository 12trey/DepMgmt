import { useEffect, useState, useRef } from 'react';
import { listLogs, getLog, listPackages, runPackage, runWrapper } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import { Plus, Trash2, Play } from 'lucide-react';

export default function Execution() {
  const [logs, setLogs] = useState([]);
  const [packages, setPackages] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [logContent, setLogContent] = useState('');
  const [activeExecId, setActiveExecId] = useState(null);
  const [tab, setTab] = useState('single'); // 'single' | 'wrapper'
  const [singleForm, setSingleForm] = useState({ appName: '', version: '', mode: 'Silent' });
  const [wrapperSteps, setWrapperSteps] = useState([]);
  const { messages, subscribe, clear } = useWebSocket(activeExecId);
  const terminalRef = useRef();

  useEffect(() => {
    listLogs().then(setLogs).catch(() => {});
    listPackages().then(setPackages).catch(() => {});
  }, []);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [messages]);

  const handleRunSingle = async () => {
    clear();
    const result = await runPackage(singleForm.appName, singleForm.version, singleForm.mode);
    setActiveExecId(result.id);
    subscribe(result.id);
  };

  const handleRunWrapper = async () => {
    clear();
    const result = await runWrapper(wrapperSteps);
    setActiveExecId(result.id);
    subscribe(result.id);
  };

  const viewLog = async (id) => {
    const data = await getLog(id);
    setSelectedLog(data);
    setLogContent(data.log);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Execution & Logs</h1>

      {/* Run controls */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <div className="flex gap-4 mb-4">
          <button onClick={() => setTab('single')} className={`text-sm font-medium pb-1 ${tab === 'single' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}>Single Package</button>
          <button onClick={() => setTab('wrapper')} className={`text-sm font-medium pb-1 ${tab === 'wrapper' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}>Master Wrapper</button>
        </div>

        {tab === 'single' ? (
          <div className="flex gap-3 items-end">
            <label className="block flex-1">
              <span className="text-sm font-medium text-gray-700">Package</span>
              <select className="input mt-1" value={`${singleForm.appName}|${singleForm.version}`} onChange={(e) => { const [a, v] = e.target.value.split('|'); setSingleForm({ ...singleForm, appName: a, version: v }); }}>
                <option value="|">Select...</option>
                {packages.map((p, i) => <option key={i} value={`${p.appName}|${p.version}`}>{p.appName} v{p.version}</option>)}
              </select>
            </label>
            <label className="block w-40">
              <span className="text-sm font-medium text-gray-700">Mode</span>
              <select className="input mt-1" value={singleForm.mode} onChange={(e) => setSingleForm({ ...singleForm, mode: e.target.value })}>
                <option>Silent</option>
                <option>Interactive</option>
                <option>NonInteractive</option>
              </select>
            </label>
            <button onClick={handleRunSingle} disabled={!singleForm.appName} className="btn-primary"><Play size={16} /> Run</button>
          </div>
        ) : (
          <div>
            {wrapperSteps.map((step, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <span className="text-sm text-gray-500 w-6">{i + 1}.</span>
                <select className="input flex-1" value={`${step.appName}|${step.version}`} onChange={(e) => { const [a, v] = e.target.value.split('|'); const arr = [...wrapperSteps]; arr[i] = { ...step, appName: a, version: v }; setWrapperSteps(arr); }}>
                  <option value="|">Select...</option>
                  {packages.map((p, j) => <option key={j} value={`${p.appName}|${p.version}`}>{p.appName} v{p.version}</option>)}
                </select>
                <select className="input w-36" value={step.mode} onChange={(e) => { const arr = [...wrapperSteps]; arr[i] = { ...step, mode: e.target.value }; setWrapperSteps(arr); }}>
                  <option>Silent</option>
                  <option>Interactive</option>
                </select>
                <button onClick={() => setWrapperSteps(wrapperSteps.filter((_, j) => j !== i))} className="text-red-500"><Trash2 size={16} /></button>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setWrapperSteps([...wrapperSteps, { appName: '', version: '', mode: 'Silent' }])} className="btn-secondary text-sm"><Plus size={16} /> Add Step</button>
              <button onClick={handleRunWrapper} disabled={wrapperSteps.length === 0} className="btn-primary text-sm"><Play size={16} /> Run All</button>
            </div>
          </div>
        )}
      </div>

      {/* Live terminal */}
      {messages.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-4 mb-6 max-h-80 overflow-auto font-mono text-sm" ref={terminalRef}>
          {messages.map((m, i) => (
            <div key={i} className={m.stream === 'stderr' ? 'text-red-400' : m.stream === 'system' ? 'text-blue-400' : 'text-green-300'}>
              {m.text}
            </div>
          ))}
        </div>
      )}

      {/* Log history */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="font-semibold mb-3">Execution History</h2>
        <div className="divide-y">
          {logs.map((l) => (
            <div key={l.id} className="py-2 flex justify-between items-center text-sm cursor-pointer hover:bg-gray-50 px-2 rounded" onClick={() => viewLog(l.id)}>
              <span>{l.appName || 'Wrapper'} {l.version && `v${l.version}`}</span>
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-xs">{new Date(l.startedAt).toLocaleString()}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${l.status === 'Success' ? 'bg-green-100 text-green-700' : l.status === 'Failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{l.status}</span>
              </div>
            </div>
          ))}
          {logs.length === 0 && <p className="text-gray-500 text-sm py-2">No execution history yet.</p>}
        </div>
      </div>

      {/* Log viewer modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedLog(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-semibold">{selectedLog.appName} — Log</h3>
              <button onClick={() => setSelectedLog(null)} className="text-gray-400 hover:text-gray-600">Close</button>
            </div>
            <pre className="p-4 overflow-auto flex-1 bg-gray-900 text-green-300 text-xs font-mono">{logContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
