const http = require('http');
const express = require('express');
const { spawn } = require('child_process');

var messages = [];

const START = '===startagentcmd===';
const END = '===endagentcmd===';

async function SendOllamaChat(message, res) {

  let capture = false;
  let pending = '';
  let cmdbuffer = '';

  // Add user message to conversation history
  messages.push({ role: "user", content: message });

  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gemma4:latest',
      messages,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let mybuffer = '';
  let agentcmdfound = false;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    // Decode chunk
    buffer += decoder.decode(value, { stream: true });
    mybuffer += buffer;

    // Ollama sends newline-delimited JSON
    const lines = buffer.split('\n');

    // Keep incomplete line in buffer
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const json = JSON.parse(line);

        // Stream token/content as received
        if (json.message?.content) {
          const chunk = json.message.content;
          process.stdout.write(chunk);
          if (res) res.write(chunk);

          pending += chunk;

          while (pending.length > 0) {

            // Not currently capturing
            if (!capture) {
              const startIdx = pending.indexOf(START);

              // No start marker yet
              if (startIdx === -1) {

                // Keep only enough trailing chars to detect split markers
                if (pending.length > START.length) {
                  pending = pending.slice(-(START.length - 1));
                }

                break;
              }

              // Discard everything before marker
              pending = pending.slice(startIdx + START.length);
              capture = true;
            }

            // Currently capturing
            if (capture) {
              const endIdx = pending.indexOf(END);

              // End marker not found yet
              if (endIdx === -1) {

                // Save everything except possible partial END marker
                const safeLength = Math.max(
                  0,
                  pending.length - (END.length - 1)
                );

                cmdbuffer += pending.slice(0, safeLength);

                pending = pending.slice(safeLength);

                break;
              }

              // Capture content before END marker
              cmdbuffer += pending.slice(0, endIdx);

              // Remove captured data + END marker
              pending = pending.slice(endIdx + END.length);

              capture = false;
            }
          }
        }

        // Optional: detect completion
        if (json.done) {
          process.stdout.write('\n');
        }
      } catch (err) {
        console.log('Parse error:', err);
      }
    }
  }

  alldata = [];
  mybuffer.split('\n').forEach((b) => {
    try {
      if (JSON.parse(b)) alldata.push(JSON.parse(b));
    } catch {
    }
  });

  let newMsg = {
    role: 'assistant',
    content: ''
  };

  alldata.forEach(d => {
    if (d.message) newMsg.content += d.message.content;
  });

  // Add AI response to conversation history
  messages.push(newMsg);

  return {
    content: newMsg.content,
    cmdBuffer: cmdbuffer
  };
}

// Enhanced coding agent functions
async function generateCode(problem, language = 'javascript') {
  const prompt = `Generate clean, well-commented ${language} code to solve this problem: ${problem}.
  Include proper error handling and follow best practices.`;

  return await SendOllamaChat(prompt);
}

async function explainCode(code, language = 'javascript') {
  const prompt = `Explain this ${language} code step by step:
  \`\`\`${code}\`\`\`
  Focus on the logic, algorithms, and key concepts used.`;

  return await SendOllamaChat(prompt);
}

async function debugCode(code, issue) {
  const prompt = `Debug this ${language} code that has the following issue: ${issue}
  \`\`\`${code}\`\`\`
  Provide the corrected code and explain what was wrong.`;

  return await SendOllamaChat(prompt);
}

async function refactorCode(code, improvements) {
  const prompt = `Refactor this code to improve ${improvements}:
  \`\`\`${code}\`\`\`
  Make sure to keep the same functionality but improve readability, performance, or structure.`;

  return await SendOllamaChat(prompt);
}

async function test() {
  console.log("Testing coding agent capabilities...");

  // Example usage
  const problem = "Create a function that sorts an array of objects by a specific property";
  const code = await generateCode(problem);
  console.log("Generated code:", code);

  const explanation = await explainCode(code);
  console.log("Explanation:", explanation);
}

const app = express();
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { message, action, code, issue, improvements, agentCallback } = req.body;

  console.log("Received request:", { message, action });

  if (message) {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });


    let _message = message + `\nIf this is a code related question and you reply with programming code, please delimit with:
    ===startcode===
    ===endcode===.\n
    Make sure there in no new lines in ===endcode===.
    Make sure to only use the delimeter when code is detected!!!!!\n`;

    if (!agentCallback) {

      _message += `
When I asked you to edit or read a file, please respond with a powershell.exe script for my agent to run.

Enclose scripts with:
===startagentcmd===
===endagentcmd===

To get the contents of the file back from the agent, call me again with the contents.

Set $filePath then add:

$fileContent = Get-Content -Path $filePath -Raw
$bytes = [System.Text.Encoding]::UTF8.GetBytes($fileContent)
$base64Content = [System.Convert]::ToBase64String($bytes)

$Body = @{
    message = $base64Content
    agentCallback = $true
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "http://localhost:7100/api/chat" \`
    -Method POST \`
    -ContentType "application/json" \`
    -Body $Body
;`
    }

    console.log(`Asking: ${_message}`);

    let result = await SendOllamaChat(_message, res);

    if (result.cmdBuffer.trim().length === 0) {
      if (!res.writableEnded) {
        res.end();
      }
    }
    console.log("CMD BUFFER");
    console.log(result.cmdBuffer);
    if (result.cmdBuffer.length > 0 && true) {
      res.write('\n');
      const buffer = Buffer.from(result.cmdBuffer, 'utf16le');
      const base64Script = buffer.toString('base64');

      // 3. Spawn powershell.exe with the -EncodedCommand flag
      // Using -NoProfile and -ExecutionPolicy Bypass is recommended for automation
      const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', base64Script
        //'-Command', cmdbuffer
      ]);

      // 4. Capture the output
      ps.stdout.on('data', (data) => {
        console.log(`PowerShell Output: ${data}`);
        res.write(data);
      });

      ps.stderr.on('data', (data) => {
        console.error(`PowerShell Error: ${data}`);
      });

      ps.on('close', (code) => {
        console.log(`Process exited with code ${code}`);
        cmdbuffer = '';
        res.end();
      });

    }
  } else if (action === 'generate') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    let code = await generateCode(message);
    res.write(code);
    res.end();
  } else if (action === 'explain') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    let explanation = await explainCode(code);
    res.write(explanation);
    res.end();
  } else if (action === 'debug') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    let debugResult = await debugCode(code, issue);
    res.write(debugResult);
    res.end();
  } else if (action === 'refactor') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    let refactored = await refactorCode(code, improvements);
    res.write(refactored);
    res.end();
  } else {
    res.json({
      message: "Hello from the coding agent! Send a message or specify an action.",
      status: "error"
    });
  }


});

// Enhanced API endpoints for coding agent
app.post('/api/generate', async (req, res) => {
  const { problem, language = 'javascript' } = req.body;
  try {
    const code = await generateCode(problem, language);
    res.json({ code, status: "success" });
  } catch (error) {
    res.status(500).json({ error: error.message, status: "error" });
  }
});

app.post('/api/explain', async (req, res) => {
  const { code, language = 'javascript' } = req.body;
  try {
    const explanation = await explainCode(code, language);
    res.json({ explanation, status: "success" });
  } catch (error) {
    res.status(500).json({ error: error.message, status: "error" });
  }
});

app.post('/api/debug', async (req, res) => {
  const { code, issue } = req.body;
  try {
    const debugResult = await debugCode(code, issue);
    res.json({ debugResult, status: "success" });
  } catch (error) {
    res.status(500).json({ error: error.message, status: "error" });
  }
});

app.post('/api/refactor', async (req, res) => {
  const { code, improvements } = req.body;
  try {
    const refactored = await refactorCode(code, improvements);
    res.json({ refactored, status: "success" });
  } catch (error) {
    res.status(500).json({ error: error.message, status: "error" });
  }
});

console.log('Starting coding agent server');
app.listen(7100, () => {
  console.log("Coding agent listening on port 7100");
});