const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { broadcast } = require('./logStream');

const paths = require('../paths');
const packageService = require('./packageService');
const logsDir = paths.logsDir;

function getConfig() {
  return JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
}

// In-memory execution tracker
const executions = new Map();

function runScript(scriptPath, mode, execId, deploymentType = 'Install') {
  return new Promise((resolve, reject) => {
    const config = getConfig();
    const psArgs = [
      ...config.execution.defaultArgs,
      '-File',
      scriptPath,
      `-DeploymentType`,
      deploymentType,
      `-DeployMode`,
      mode,
    ];

    // In packaged Electron the inherited PSModulePath may be empty or incomplete, causing both
    // Get-Module -ListAvailable to miss CurrentUser-installed modules AND transitive RequiredModules
    // (e.g. Microsoft.PowerShell.Archive) to fail resolution. Reconstruct the full standard path.
    const userProfile = process.env.USERPROFILE || '';
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const standardModPaths = [
      // CurrentUser installs (PS5.1 and PS7)
      ...(userProfile ? [
        path.join(userProfile, 'Documents', 'WindowsPowerShell', 'Modules'),
        path.join(userProfile, 'Documents', 'PowerShell', 'Modules'),
      ] : []),
      // AllUsers installs
      path.join(progFiles, 'WindowsPowerShell', 'Modules'),
      path.join(progFiles, 'PowerShell', 'Modules'),
      // Windows built-in modules (Microsoft.PowerShell.Archive, etc.)
      path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
    ];
    const baseParts = (process.env.PSModulePath || '').split(';').filter(Boolean);
    const mergedParts = [...new Set([...standardModPaths, ...baseParts])];
    const spawnEnv = { ...process.env, PSModulePath: mergedParts.join(';') };

    const child = spawn(config.execution.powershellPath, psArgs, { cwd: path.dirname(scriptPath), env: spawnEnv });
    const logLines = [];

    const onData = (stream) => (chunk) => {
      const text = chunk.toString();
      logLines.push(text);
      broadcast(execId, text, stream);
    };

    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));

    child.on('close', (code) => {
      const status = code === 0 ? 'Success' : 'Failed';
      executions.set(execId, { ...executions.get(execId), status, exitCode: code, endedAt: new Date().toISOString() });
      // Persist log
      fs.writeFileSync(path.join(logsDir, `${execId}.log`), logLines.join(''));
      fs.writeFileSync(
        path.join(logsDir, `${execId}.json`),
        JSON.stringify(executions.get(execId), null, 2)
      );
      broadcast(execId, `\n--- Execution ${status} (exit code ${code}) ---\n`, 'system');
      resolve({ status, exitCode: code });
    });

    child.on('error', (err) => {
      executions.set(execId, { ...executions.get(execId), status: 'Failed', error: err.message });
      broadcast(execId, `Error: ${err.message}\n`, 'stderr');
      reject(err);
    });
  });
}

function runScriptWithCredentials(scriptPath, mode, execId, deploymentType, username, password) {
  return new Promise((resolve, reject) => {
    const config = getConfig();
    const psEsc = (s) => String(s).replace(/'/g, "''");

    const script = [
      `$ErrorActionPreference = 'Continue'`,
      `$secPass = ConvertTo-SecureString '${psEsc(password)}' -AsPlainText -Force`,
      `$cred = New-Object System.Management.Automation.PSCredential('${psEsc(username)}', $secPass)`,
      `$tmpOut = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.Guid]::NewGuid().ToString('N') + '.out')`,
      `$tmpErr = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.Guid]::NewGuid().ToString('N') + '.err')`,
      `try {`,
      `    $psArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \`"${psEsc(scriptPath)}\`" -DeploymentType ${psEsc(deploymentType)} -DeployMode ${psEsc(mode)}"`,
      `    $proc = Start-Process powershell.exe -Credential $cred -ArgumentList $psArgs -Wait -WindowStyle Hidden -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr -PassThru`,
      `    if (Test-Path $tmpOut) { Get-Content $tmpOut | ForEach-Object { Write-Host $_ } }`,
      `    if (Test-Path $tmpErr) { Get-Content $tmpErr | ForEach-Object { if ($_) { Write-Warning $_ } } }`,
      `    exit $proc.ExitCode`,
      `} finally {`,
      `    Remove-Item $tmpOut, $tmpErr -ErrorAction SilentlyContinue`,
      `}`,
    ].join('\n');

    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    const userProfile = process.env.USERPROFILE || '';
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const standardModPaths = [
      ...(userProfile ? [
        path.join(userProfile, 'Documents', 'WindowsPowerShell', 'Modules'),
        path.join(userProfile, 'Documents', 'PowerShell', 'Modules'),
      ] : []),
      path.join(progFiles, 'WindowsPowerShell', 'Modules'),
      path.join(progFiles, 'PowerShell', 'Modules'),
      path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
    ];
    const baseParts = (process.env.PSModulePath || '').split(';').filter(Boolean);
    const mergedParts = [...new Set([...standardModPaths, ...baseParts])];
    const spawnEnv = { ...process.env, PSModulePath: mergedParts.join(';') };

    const psArgs = [...config.execution.defaultArgs, '-EncodedCommand', encoded];
    const child = spawn(config.execution.powershellPath, psArgs, { cwd: path.dirname(scriptPath), env: spawnEnv });
    const logLines = [];

    const onData = (stream) => (chunk) => {
      const text = chunk.toString();
      logLines.push(text);
      broadcast(execId, text, stream);
    };

    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));

    child.on('close', (code) => {
      const status = code === 0 ? 'Success' : 'Failed';
      executions.set(execId, { ...executions.get(execId), status, exitCode: code, endedAt: new Date().toISOString() });
      fs.writeFileSync(path.join(logsDir, `${execId}.log`), logLines.join(''));
      fs.writeFileSync(path.join(logsDir, `${execId}.json`), JSON.stringify(executions.get(execId), null, 2));
      broadcast(execId, `\n--- Execution ${status} (exit code ${code}) ---\n`, 'system');
      resolve({ status, exitCode: code });
    });

    child.on('error', (err) => {
      executions.set(execId, { ...executions.get(execId), status: 'Failed', error: err.message });
      broadcast(execId, `Error: ${err.message}\n`, 'stderr');
      reject(err);
    });
  });
}

exports.runPackage = async (appName, version, mode, deploymentType = 'Install', username, password) => {
  const scriptPath = packageService.getEntryScript(appName, version);
  if (!fs.existsSync(scriptPath)) throw new Error('Deploy script not found');

  const execId = uuidv4();
  const meta = { id: execId, appName, version, mode, deploymentType, status: 'Running', startedAt: new Date().toISOString() };
  executions.set(execId, meta);

  if (username && password) {
    broadcast(execId, `Starting deployment as '${username}': ${appName} v${version} [${deploymentType}/${mode}]\n`, 'system');
    runScriptWithCredentials(scriptPath, mode, execId, deploymentType, username, password).catch(() => {});
  } else {
    broadcast(execId, `Starting deployment: ${appName} v${version} [${deploymentType}/${mode}]\n`, 'system');
    runScript(scriptPath, mode, execId, deploymentType).catch(() => {});
  }

  return { id: execId, status: 'Running' };
};

exports.runWrapper = async (steps) => {
  const wrapperId = uuidv4();
  const meta = { id: wrapperId, type: 'wrapper', steps, status: 'Running', startedAt: new Date().toISOString() };
  executions.set(wrapperId, meta);

  (async () => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const scriptPath = packageService.getEntryScript(step.appName, step.version);
      if (!fs.existsSync(scriptPath)) {
        broadcast(wrapperId, `Step ${i + 1}: Script not found for ${step.appName}\n`, 'stderr');
        continue;
      }
      broadcast(wrapperId, `\n=== Step ${i + 1}/${steps.length}: ${step.appName} v${step.version} [${step.deploymentType || 'Install'}/${step.mode || 'Silent'}] ===\n`, 'system');
      try {
        await runScript(scriptPath, step.mode || 'Silent', wrapperId, step.deploymentType || 'Install');
      } catch {
        broadcast(wrapperId, `Step ${i + 1} failed, continuing...\n`, 'stderr');
      }
    }
    executions.set(wrapperId, { ...executions.get(wrapperId), status: 'Completed', endedAt: new Date().toISOString() });
  })();

  return { id: wrapperId, status: 'Running' };
};

exports.runRemote = async (appName, version, mode, target, username, password, deploymentType = 'Install') => {
  const pkgDir = path.join(paths.packagesDir, appName, version);
  if (!fs.existsSync(pkgDir)) throw new Error('Package not found');

  const metaPath = path.join(pkgDir, 'metadata.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};
  const entryScript = meta.psadtVersion === 'v4' ? 'Invoke-AppDeployToolkit.ps1' : 'Deploy-Application.ps1';

  const config = getConfig();
  const execId = uuidv4();
  const execMeta = { id: execId, appName, version, mode, deploymentType, target, status: 'Running', startedAt: new Date().toISOString() };
  executions.set(execId, execMeta);
  broadcast(execId, `Starting remote deployment: ${appName} v${version} on ${target} [${deploymentType}/${mode}]\n`, 'system');

  const psEsc = (s) => String(s).replace(/'/g, "''");
  const localPath = pkgDir; // full Windows path

  const credLines = (username && password)
    ? `$secPass = ConvertTo-SecureString '${psEsc(password)}' -AsPlainText -Force\n` +
      `$cred = [System.Management.Automation.PSCredential]::new('${psEsc(username)}', $secPass)\n` +
      `$sessionParams['Credential'] = $cred\n`
    : '';

  const script = [
    `$ErrorActionPreference = [System.Management.Automation.ActionPreference]::Stop`,
    `$ProgressPreference = [System.Management.Automation.ActionPreference]::SilentlyContinue`,
    `$remoteTmp = "C:\\Windows\\Temp\\PSADT_$([System.Guid]::NewGuid().ToString('N'))"`,
    `$sessionParams = @{ ComputerName = '${psEsc(target)}' }`,
    credLines,
    `Write-Host "Connecting to '${psEsc(target)}' via WinRM..."`,
    `$sessionOption = New-PSSessionOption -OperationTimeout 0 -IdleTimeout 7200000`,
    `$session = New-PSSession @sessionParams -SessionOption $sessionOption`,
    `try {`,
    `    Write-Host "Creating remote staging directory $remoteTmp..."`,
    `    Invoke-Command -Session $session -ScriptBlock { param($p) New-Item -ItemType Directory -Path $p -Force | Out-Null } -ArgumentList $remoteTmp`,
    `    Write-Host "Copying package files to ${psEsc(target)}..."`,
    `    Copy-Item -Path '${psEsc(localPath)}\\*' -Destination $remoteTmp -ToSession $session -Recurse -Force`,
    `    $adtMod = Get-Module -Name PSAppDeployToolkit -ListAvailable |`,
    `        Where-Object { $_.Version.Major -ge 4 } |`,
    `        Sort-Object Version -Descending |`,
    `        Select-Object -First 1`,
    `    if ($adtMod) {`,
    `        $adtSrc = Split-Path $adtMod.Path -Parent`,
    `        $remoteAdtDest = Join-Path $remoteTmp 'PSAppDeployToolkit'`,
    `        Write-Host "Copying PSAppDeployToolkit $($adtMod.Version) to remote staging directory..."`,
    `        Invoke-Command -Session $session -ScriptBlock { param($p) New-Item -ItemType Directory -Path $p -Force | Out-Null } -ArgumentList $remoteAdtDest`,
    `        Copy-Item -Path "$adtSrc\\*" -Destination $remoteAdtDest -ToSession $session -Recurse -Force`,
    `    } else {`,
    `        Write-Warning "PSAppDeployToolkit v4 not found locally; remote machine must have it installed."`,
    `    }`,
    `    Write-Host "Executing ${entryScript} on ${psEsc(target)} [${deploymentType}/${mode}]..."`,
    `    if ('${psEsc(mode)}' -eq 'Interactive') {`,
    `        # Interactive mode: WinRM has no desktop — run via a scheduled task under the logged-on user`,
    `        $output = Invoke-Command -Session $session -ScriptBlock {`,
    `            param($dir, $scriptName)`,
    `            # Console session`,
    `            $loggedOnUser = (Get-CimInstance Win32_ComputerSystem).UserName`,
    `            # RDP/TS sessions: Win32_ComputerSystem.UserName is empty — use explorer.exe owner instead`,
    `            if (-not $loggedOnUser) {`,
    `                $exp = Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Select-Object -First 1`,
    `                if ($exp) {`,
    `                    $o = Invoke-CimMethod -InputObject $exp -MethodName GetOwner`,
    `                    if ($o.ReturnValue -eq 0) {`,
    `                        $loggedOnUser = if ($o.Domain) { "$($o.Domain)\\$($o.User)" } else { $o.User }`,
    `                    }`,
    `                }`,
    `            }`,
    `            if (-not $loggedOnUser) {`,
    `                throw 'No interactive session found (console or RDP). Interactive mode requires an active desktop session on the target machine.'`,
    `            }`,
    `            $taskName  = "PSADT_$([System.Guid]::NewGuid().ToString('N'))"`,
    `            $sp        = Join-Path $dir $scriptName`,
    `            $psArg     = "-WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$sp\`" -DeploymentType ${psEsc(deploymentType)} -DeployMode Interactive"`,
    `            $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArg -WorkingDirectory $dir`,
    `            $principal = New-ScheduledTaskPrincipal -UserId $loggedOnUser -LogonType Interactive -RunLevel Highest`,
    `            $settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1)`,
    `            Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
    `            Write-Output "Scheduled task registered. Running interactively as: $loggedOnUser"`,
    `            Start-ScheduledTask -TaskName $taskName`,
    `            # Wait up to 15 seconds for the task to actually start`,
    `            $startWait = 0`,
    `            do {`,
    `                Start-Sleep -Seconds 1`,
    `                $startWait++`,
    `                $st = (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State`,
    `            } while ($st -notin @('Running', 'Disabled') -and $startWait -lt 15)`,
    `            if ($st -ne 'Running') {`,
    `                Write-Output "Warning: task state is '$st' after $startWait seconds - proceeding anyway"`,
    `            } else {`,
    `                Write-Output "Task started (state: Running). Waiting for completion..."`,
    `            }`,
    `            # Poll until task leaves Running/Queued state, emitting a heartbeat every 30s to keep WinRM alive`,
    `            $deadline  = [DateTime]::Now.AddMinutes(90)`,
    `            $lastBeat  = [DateTime]::Now`,
    `            while ([DateTime]::Now -lt $deadline) {`,
    `                Start-Sleep -Seconds 5`,
    `                $st = (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State`,
    `                if ($st -notin @('Running', 'Queued')) { break }`,
    `                if (([DateTime]::Now - $lastBeat).TotalSeconds -ge 30) {`,
    `                    Write-Output "Still running... (state: $st)"`,
    `                    $lastBeat = [DateTime]::Now`,
    `                }`,
    `            }`,
    `            $rc = (Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue).LastTaskResult`,
    `            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue`,
    `            Write-Output "Task finished with result code: $rc"`,
    `            $logDir = 'C:\\Windows\\Logs\\Software'`,
    `            $latestLog = Get-ChildItem $logDir -Filter '*.log' -ErrorAction SilentlyContinue |`,
    `                Sort-Object LastWriteTime -Descending | Select-Object -First 1`,
    `            if ($latestLog) {`,
    `                Write-Output "--- PSADT log: $($latestLog.Name) ---"`,
    `                Get-Content $latestLog.FullName -Tail 300`,
    `            }`,
    `        } -ArgumentList $remoteTmp, '${entryScript}'`,
    `    } else {`,
    `        $output = Invoke-Command -Session $session -ScriptBlock {`,
    `            param($dir, $scriptName, $deployMode)`,
    `            $sp = Join-Path $dir $scriptName`,
    `            Set-Location $dir`,
    `            & $sp -DeploymentType ${psEsc(deploymentType)} -DeployMode $deployMode 2>&1 | ForEach-Object { $_.ToString() }`,
    `        } -ArgumentList $remoteTmp, '${entryScript}', '${psEsc(mode)}'`,
    `    }`,
    `    $output | ForEach-Object { Write-Host $_ }`,
    `} finally {`,
    `    Write-Host "Cleaning up remote staging directory..."`,
    `    try {`,
    `        Invoke-Command -Session $session -ScriptBlock {`,
    `            param($p) Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue`,
    `        } -ArgumentList $remoteTmp`,
    `    } catch {}`,
    `    Remove-PSSession $session -ErrorAction SilentlyContinue`,
    `}`,
  ].join('\n');

  // Encode as UTF-16LE for PowerShell -EncodedCommand
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  const userProfile = process.env.USERPROFILE || '';
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const standardModPaths = [
    ...(userProfile ? [
      path.join(userProfile, 'Documents', 'WindowsPowerShell', 'Modules'),
      path.join(userProfile, 'Documents', 'PowerShell', 'Modules'),
    ] : []),
    path.join(progFiles, 'WindowsPowerShell', 'Modules'),
    path.join(progFiles, 'PowerShell', 'Modules'),
    path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  ];
  const baseParts = (process.env.PSModulePath || '').split(';').filter(Boolean);
  const mergedParts = [...new Set([...standardModPaths, ...baseParts])];
  const spawnEnv = { ...process.env, PSModulePath: mergedParts.join(';') };

  const psArgs = [...config.execution.defaultArgs, '-EncodedCommand', encoded];

  (async () => {
    await new Promise((resolve) => {
      const child = spawn(config.execution.powershellPath, psArgs, { env: spawnEnv });
      const logLines = [];
      const onData = (stream) => (chunk) => {
        const text = chunk.toString();
        logLines.push(text);
        broadcast(execId, text, stream);
      };
      child.stdout.on('data', onData('stdout'));
      child.stderr.on('data', onData('stderr'));
      child.on('close', (code) => {
        const status = code === 0 ? 'Success' : 'Failed';
        executions.set(execId, { ...executions.get(execId), status, exitCode: code, endedAt: new Date().toISOString() });
        fs.mkdirSync(logsDir, { recursive: true });
        fs.writeFileSync(path.join(logsDir, `${execId}.log`), logLines.join(''));
        fs.writeFileSync(path.join(logsDir, `${execId}.json`), JSON.stringify(executions.get(execId), null, 2));
        broadcast(execId, `\n--- Remote Execution ${status} (exit code ${code}) ---\n`, 'system');
        resolve();
      });
      child.on('error', (err) => {
        executions.set(execId, { ...executions.get(execId), status: 'Failed', error: err.message });
        broadcast(execId, `Error: ${err.message}\n`, 'stderr');
        resolve();
      });
    });
  })();

  return { id: execId, status: 'Running' };
};

exports.getStatus = (id) => {
  const exec = executions.get(id);
  if (!exec) throw new Error('Execution not found');
  return exec;
};

exports.listLogs = async () => {
  if (!fs.existsSync(logsDir)) return [];
  return fs
    .readdirSync(logsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(logsDir, f), 'utf-8')))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
};

exports.getLog = async (id) => {
  const logPath = path.join(logsDir, `${id}.log`);
  const metaPath = path.join(logsDir, `${id}.json`);
  if (!fs.existsSync(logPath)) throw new Error('Log not found');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};
  const log = fs.readFileSync(logPath, 'utf-8');
  return { ...meta, log };
};
