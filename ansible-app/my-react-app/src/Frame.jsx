import { useState, useEffect } from 'react';
import './Frame.css';
import App from './App.jsx';
import Welcome from './Welcome.jsx';
import GitPanel from './GitPanel.jsx';
import KerberosBar from './KerberosBar.jsx';
import Config from './Config.jsx';

function Frame() {
    const [view, setView] = useState('close');
    const [vsCodeAvailable, setVsCodeAvailable] = useState(false);

    useEffect(() => {
        fetch('/vscode-status')
            .then(r => r.json())
            .then(d => setVsCodeAvailable(d.available))
            .catch(() => {});
    }, []);

    const openInVsCode = () => {
        fetch('/codedot', { method: 'POST' }).catch(() => {});
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100svh', overflow: 'hidden' }}>
            <div className="header">
                <span style={{ margin: '0 10px' }}>DMT Tools UI v1.0</span> /
                <button className="headerbutton" onClick={() => setView('app')}>Ansible</button> /
                <button className="headerbutton" onClick={() => setView('git')}>Git</button> /
                <button className="headerbutton" onClick={() => setView('config')}>Config</button> /
                <button className="headerbutton" onClick={() => setView('close')}>Home</button> /
                {vsCodeAvailable && (
                    <button className="headerbutton" onClick={openInVsCode} title="Open repo in VS Code">VS Code</button>
                )}
            </div>
            <KerberosBar />
            {/* Content area fills the remaining height and provides the
                positioning context for the absolutely-placed panels in App */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
                {view === 'app' && <App />}
                {view === 'git' && <GitPanel />}
                {view === 'config' && <Config />}
                {view === 'close' && <Welcome />}
            </div>
        </div>
    );
}

export default Frame;
