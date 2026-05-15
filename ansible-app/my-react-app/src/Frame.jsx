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
    const [dialog, setDialog] = useState(false);
    const [dialogtext, setDialogText] = useState('');

    useEffect(() => {
        fetch('/vscode-status')
            .then(r => r.json())
            .then(d => setVsCodeAvailable(d.available))
            .catch(() => { });
    }, []);

    const openInVsCode = () => {
        fetch('/codedot', { method: 'POST' }).catch(() => { });
    };

    const vsCodeExtInstall = async () => {
        let res = await fetch('http://localhost:7000/install', { method: 'GET' }).catch(() => { });

        if (!res.ok) {
            setDialogText(`${res.status}`);
            setDialog(true);
            setTimeout(() => {
                setDialog(false);
            }, 4000);
            return;
        }
        const data = await res.json();
        if (data.status) {
            //let parsed = data.status.replace(/\\n/, '<br/>');
            setDialogText(`WSL: ${data.status}`);
            setDialog(true);
            setTimeout(() => {
                setDialog(false);
            }, 4000);
        }

        res = await fetch('http://localhost:4000/api/vscode/install', { method: 'GET' }).catch(() => { });

        if (!res.ok) {
            setDialogText(`${res.status}`);
            setDialog(true);
            setTimeout(() => {
                setDialog(false);
            }, 4000);
            return;
        }
        const data2 = await res.json();
        if (data2.status) {
            //let parsed = data.status.replace(/\\n/, '<br/>');
            setDialogText((prev)=>{ return `${prev}\nWINDOWS: ${data2.status}` });
            setDialog(true);
            setTimeout(() => {
                setDialog(false);
            }, 4000);
        }
    };

    const vsCodeExtUnInstall = async () => {
        let res = await fetch('http://localhost:7000/uninstall', { method: 'GET' }).catch(() => { });

        let timeout = null;
        if (!res.ok) {
            setDialogText(`${res.status}`);
            setDialog(true);
            if(timeout !=null) clearTimeout(timeout);
            timeout = setTimeout(() => {
                setDialog(false);
            }, 4000);
            return;
        }
        const data = await res.json();
        if (data.status) {
            //let parsed = data.status.replace(/\\n/, '<br/>');
            setDialogText(`WSL: ${data.status}`);
            setDialog(true);
            if(timeout !=null) clearTimeout(timeout);
            timeout = setTimeout(() => {
                setDialog(false);
            }, 4000);
        }

        res = await fetch('http://localhost:4000/api/vscode/uninstall', { method: 'GET' }).catch(() => { });

        if (!res.ok) {
            setDialogText(`${res.status}`);
            setDialog(true);
            if(timeout !=null) clearTimeout(timeout);
            timeout = setTimeout(() => {
                setDialog(false);
            }, 4000);
            return;
        }
        const data2 = await res.json();
        if (data2.status) {
            //let parsed = data.status.replace(/\\n/, '<br/>');
            setDialogText((prev)=>{ return `${prev}\nWINDOWS: ${data2.status}` });
            setDialog(true);
            if(timeout !=null) clearTimeout(timeout);
            timeout = setTimeout(() => {
                setDialog(false);
            }, 4000);
        }
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
                    <span>
                        <button className="headerbutton" onClick={openInVsCode} title="Open repo in VS Code">VS Code</button> /
                        <button className="headerbutton" onClick={vsCodeExtInstall} title="Install VSCode extension for Ansible">Install extension</button> /
                        <button className="headerbutton" onClick={vsCodeExtUnInstall} title="Uninstall VSCode extension for Ansible">Uninstall extension</button>
                    </span>
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

            <div className={dialog ? 'dialog dialog-visible' : 'dialog dialog-hidden'}>
                <div className='dialog-content'>
                    {dialogtext}
                </div>
            </div>
        </div>
    );
}

export default Frame;
