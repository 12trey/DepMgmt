import { useEffect, useState, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

const DMT_URL = 'http://localhost:7000';

export default function DMTTools() {
  const [status, setStatus] = useState('checking'); // 'checking' | 'available' | 'unavailable'


  const check = () => {
    setStatus('checking');
    fetch(DMT_URL, { mode: 'no-cors', signal: AbortSignal.timeout(4000) })
      .then(() => setStatus('available'))
      .catch(() => setStatus('unavailable'));
  };

  useEffect(() => {
    check();

    const handler = (event) => {
      console.log('got message', event.data);
      window.electronAPI.sendToMain(event.data.payload);
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }, []);


  if (status === 'checking') {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        Checking for DMT service at {DMT_URL}...
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 max-w-lg text-center">
          <h2 className="text-lg font-semibold text-yellow-800 mb-2">DMT Service Not Detected</h2>
          <p className="text-sm text-yellow-700 mb-4">
            No service was found at <span className="font-mono">{DMT_URL}</span>.
            To use this feature, please install and start the <strong>DMTUbuntu.wsl</strong> image.
          </p>
          <ol className="text-sm text-yellow-700 text-left list-decimal list-inside space-y-1 mb-4">
            <li>Install the WSL image: <span className="font-mono">wsl --install DMTUbuntu</span></li>
            <li>Start the DMT service inside the WSL environment</li>
            <li>Verify it is listening on port 7000</li>
          </ol>
          <button onClick={check} className="btn-secondary text-sm">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  // Negative margin cancels the parent p-6 (24px each side) so the iframe fills the full content area
  return (
    <div className="-m-6" style={{ height: 'calc(100vh - 0px)' }}>
      <iframe
        src={DMT_URL}
        className="w-full h-full border-0"
        title="DMT Tools"
        allow="clipboard-read *; clipboard-write *;"
      />
      {/* <webview
        ref={webviewRef}
        src={DMT_URL}
        style={{ width: '100%', height: '100%' }}
        allowpopups="true"
      /> */}
    </div>
  );
}
