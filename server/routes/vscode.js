const express = require('express');
const { execFile, spawn } = require('child_process');
const path = require('path');


const router = express.Router();

router.get('/download', (req, res) => {
    const filepath = 'vscode-ext\\ansible-helper-0.1.0.vsix';
    res.download(filepath);
});

router.get('/install', (req, res) => {
    let code = spawn('cmd.exe', ['/c', 'code.cmd', '--install-extension', `resources\\app\\vscode-ext\\ansible-helper-0.1.0.vsix`], {
        //shell: true,
    });

    let errors = [];
    let datas = [];

    code.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
        datas.push(data);
    });

    code.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        errors.push(data);
    });

    code.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
        if(errors.length === 0)
            res.json({ status: datas.join(' ') });
        else
            res.json({ status: errors.join(' ') });

    });

});

router.get('/uninstall', (req, res) => {
    let code = spawn('cmd.exe', ['/c', 'code.cmd', '--uninstall-extension', `resources\\app\\vscode-ext\\ansible-helper-0.1.0.vsix`], {
        //shell: true,
    });

    let errors = [];
    let datas = [];

    code.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
        datas.push(data);
    });

    code.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        errors.push(data);
    });

    code.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
        if(errors.length === 0)
            res.json({ status: datas.join(' ') });
        else
            res.json({ status: errors.join(' ') });
    });

});

module.exports = router
