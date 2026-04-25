

const { spawn } = require('child_process');
const fs = require('fs');

var script = fs.readFileSync("C:/Users/trey/Documents/Deployments/powershell_scripts/MgGraph-GetIntuneApps.ps1").toString();

var filename = `tmp-${Date.now().toString()}.txt`;
var proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Invoke-Command -ScriptBlock { 
$ProgressPreference='SilentlyContinue';
$WarningPreference='SilentlyContinue';
$InformationPreference='SilentlyContinue';
Connect-MgGraph | Out-Null; 
& 'C:/Users/trey/Documents/Deployments/powershell_scripts/MgGraph-GetIntuneApps.ps1' | ConvertTo-Json -Compress -Depth 10 | Out-File -FilePath './${filename}' -Encoding 'utf8'; 
}`], {});

var output = '';
proc.stdout.on('data', (data) => {
  output += data;
});

proc.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`);
});

proc.on('close', (code) => {
	var tmp = fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '').trim();
	try { 
		let obj = JSON.parse(tmp);
		console.log(obj);
		fs.unlinkSync(filename);
	}
	catch(err) { console.log(err); }
	
	
  console.log(`child process exited with code ${code}`);
});