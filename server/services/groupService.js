const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Escape a value for embedding inside a PowerShell single-quoted string
function ps(s) {
  return String(s).replace(/'/g, "''");
}

// Build PowerShell lines that set up $adCred (null when no credentials supplied)
function credentialBlock(credential) {
  if (!credential?.username) {
    return '$adCred = $null';
  }
  return [
    `$_pass = ConvertTo-SecureString '${ps(credential.password)}' -AsPlainText -Force`,
    `$adCred = New-Object System.Management.Automation.PSCredential('${ps(credential.username)}', $_pass)`,
  ].join('\n');
}

// Splatting fragment: adds -Credential when $adCred is set
const credSplat = `$credParam = @{}
if ($null -ne $adCred) { $credParam['Credential'] = $adCred }`;

// Run a PowerShell script string, return parsed JSON output
function runScript(script) {
  return new Promise((resolve, reject) => {
    const tmpScript = path.join(os.tmpdir(), `grp_${uuidv4()}.ps1`);
    fs.writeFileSync(tmpScript, script, 'utf-8');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpScript],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpScript); } catch {}
        if (err) {
          try {
            const data = JSON.parse(stdout.trim());
            return resolve(data);
          } catch {}
          return reject(new Error(stderr.trim() || err.message));
        }
        try {
          const text = stdout.trim();
          resolve(text ? JSON.parse(text) : {});
        } catch (e) {
          reject(new Error(`Failed to parse output: ${stdout.trim()}`));
        }
      }
    );
  });
}

// ─── Group verification ────────────────────────────────────────────────────

async function verifyGroup(name, type, credential) {
  if (type === 'local') {
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $g = Get-LocalGroup -Name '${ps(name)}'
  [PSCustomObject]@{ exists = $true; name = $g.Name; description = [string]$g.Description } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ exists = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  } else {
    const script = `
$ErrorActionPreference = 'Stop'
${credentialBlock(credential)}
${credSplat}
try {
  $g = Get-ADGroup -Identity '${ps(name)}' -Properties Description @credParam
  [PSCustomObject]@{ exists = $true; name = $g.Name; description = [string]$g.Description } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ exists = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  }
}

// ─── Group members ─────────────────────────────────────────────────────────

async function getGroupMembers(name, type, credential) {
  if (type === 'local') {
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $members = Get-LocalGroupMember -Group '${ps(name)}' | ForEach-Object {
    [PSCustomObject]@{
      name           = $_.Name
      samAccountName = ($_.Name -split '\\\\')[-1]
      type           = $_.ObjectClass
      sid            = $_.SID.Value
    }
  }
  if ($null -eq $members) { '[]' } else { @($members) | ConvertTo-Json -Compress }
} catch {
  [PSCustomObject]@{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    const result = await runScript(script);
    if (result.error) throw new Error(result.error);
    return Array.isArray(result) ? result : (result ? [result] : []);
  } else {
    const script = `
$ErrorActionPreference = 'Stop'
${credentialBlock(credential)}
${credSplat}
try {
  $members = Get-ADGroupMember -Identity '${ps(name)}' @credParam | ForEach-Object {
    [PSCustomObject]@{
      name           = $_.Name
      samAccountName = $_.SamAccountName
      type           = $_.objectClass
    }
  }
  if ($null -eq $members) { '[]' } else { @($members) | ConvertTo-Json -Compress }
} catch {
  [PSCustomObject]@{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    const result = await runScript(script);
    if (result.error) throw new Error(result.error);
    return Array.isArray(result) ? result : (result ? [result] : []);
  }
}

// ─── User verification ─────────────────────────────────────────────────────

async function verifyUser(username, type, credential) {
  if (type === 'local') {
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $u = Get-LocalUser -Name '${ps(username)}'
  [PSCustomObject]@{
    exists      = $true
    name        = $u.Name
    fullName    = [string]$u.FullName
    description = [string]$u.Description
    enabled     = [bool]$u.Enabled
  } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ exists = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  } else {
    const script = `
$ErrorActionPreference = 'Stop'
${credentialBlock(credential)}
${credSplat}
try {
  $u = Get-ADUser -Identity '${ps(username)}' -Properties DisplayName, Enabled, EmailAddress, Department @credParam
  [PSCustomObject]@{
    exists      = $true
    name        = $u.SamAccountName
    displayName = [string]$u.DisplayName
    email       = [string]$u.EmailAddress
    department  = [string]$u.Department
    enabled     = [bool]$u.Enabled
  } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ exists = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  }
}

// ─── Check if user is member ───────────────────────────────────────────────

async function checkMembership(username, groupName, type, credential) {
  if (type === 'local') {
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $target  = '${ps(username)}'
  $members = Get-LocalGroupMember -Group '${ps(groupName)}'
  $match   = $members | Where-Object {
    $_.Name -ieq $target -or ($_.Name -split '\\\\')[-1] -ieq $target
  }
  [PSCustomObject]@{ isMember = ($null -ne $match -and @($match).Count -gt 0) } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  } else {
    const script = `
$ErrorActionPreference = 'Stop'
${credentialBlock(credential)}
${credSplat}
try {
  $members = Get-ADGroupMember -Identity '${ps(groupName)}' @credParam
  $match   = $members | Where-Object { $_.SamAccountName -ieq '${ps(username)}' }
  [PSCustomObject]@{ isMember = ($null -ne $match -and @($match).Count -gt 0) } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  }
}

// ─── Add user to group ─────────────────────────────────────────────────────

async function addUserToGroup(username, groupName, type, credential) {
  if (type === 'local') {
    const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-LocalGroupMember -Group '${ps(groupName)}' -Member '${ps(username)}'
  [PSCustomObject]@{ success = $true } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  } else {
    const script = `
$ErrorActionPreference = 'Stop'
${credentialBlock(credential)}
${credSplat}
try {
  Add-ADGroupMember -Identity '${ps(groupName)}' -Members '${ps(username)}' @credParam
  [PSCustomObject]@{ success = $true } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  }
}

// ─── Remove user from group ────────────────────────────────────────────────

async function removeUserFromGroup(username, groupName, type, credential) {
  if (type === 'local') {
    const script = `
$ErrorActionPreference = 'Stop'
try {
  Remove-LocalGroupMember -Group '${ps(groupName)}' -Member '${ps(username)}'
  [PSCustomObject]@{ success = $true } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  } else {
    const script = `
$ErrorActionPreference = 'Stop'
${credentialBlock(credential)}
${credSplat}
try {
  Remove-ADGroupMember -Identity '${ps(groupName)}' -Members '${ps(username)}' -Confirm:$false @credParam
  [PSCustomObject]@{ success = $true } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}`;
    return runScript(script);
  }
}

module.exports = {
  verifyGroup,
  getGroupMembers,
  verifyUser,
  checkMembership,
  addUserToGroup,
  removeUserFromGroup,
};
