const express = require('express');
const { spawn } = require('child_process');

let messages = [];

const START = '===startagentcmd===';
const END = '===endagentcmd===';

async function SendOllamaChat(message, res) {
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

  let ndjsonBuffer = '';
  let assistantText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const decoded = decoder.decode(value, { stream: true });
    ndjsonBuffer += decoded;

    const lines = ndjsonBuffer.split('\n');
    ndjsonBuffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const json = JSON.parse(line);

        if (json.message?.content) {
          const chunk = json.message.content;
          assistantText += chunk;

          process.stdout.write(chunk);
          if (res && !res.writableEnded) res.write(chunk);
        }

        if (json.done) {
          process.stdout.write('\n');
        }
      } catch (err) {
        console.log('Parse error:', err);
      }
    }
  }

  messages.push({ role: 'assistant', content: assistantText });

  const match = assistantText.match(
    /===startagentcmd===([\s\S]*?)===endagentcmd===/
  );

  const cmdBuffer = match ? match[1].trim() : '';

  return {
    content: assistantText,
    cmdBuffer
  };
}

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

async function debugCode(code, issue, language = 'javascript') {
  const prompt = `Debug this ${language} code that has the following issue: ${issue}
\`\`\`${code}\`\`\`
Provide the corrected code and explain what was wrong.`;

  return await SendOllamaChat(prompt);
}

async function refactorCode(code, improvements, language = 'javascript') {
  const prompt = `Refactor this code to improve ${improvements}:
\`\`\`${code}\`\`\`
Make sure to keep the same functionality but improve readability, performance, or structure.`;

  return await SendOllamaChat(prompt);
}

const app = express();
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { message, action, code, issue, improvements, agentCallback } = req.body;

  try {
    if (message) {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });

      let _message = message + `
I AM THE NODEJS AGENT:
If this is a code related question and you reply with programming code, please delimit with:
===startcode===
===endcode===

Make sure there are no new lines in ===endcode===.
Make sure to only use the delimiter when code is detected.
You are a Powershell and NodeJS expert and should check your code before submitting it.
Any time you ask the agent to write a file, you should also ask the agent to read back the file.
`;

      if (!agentCallback) {
        _message += `
When I asked you to edit or read a file, respond with a powershell.exe script for my agent to run.

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
`;
      }

      const result = await SendOllamaChat(_message, res);

      console.log("CMD BUFFER");
      console.log(result.cmdBuffer);

      if (result.cmdBuffer.length > 0) {
        const buffer = Buffer.from(result.cmdBuffer, 'utf16le');
        const base64Script = buffer.toString('base64');

        const ps = spawn('powershell.exe', [
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-EncodedCommand', base64Script
        ]);

        ps.stdout.on('data', (data) => {
          console.log(`PowerShell Output: ${data}`);
          if (!res.writableEnded) res.write(data);
        });

        ps.stderr.on('data', (data) => {
          console.error(`PowerShell Error: ${data}`);
        });

        ps.on('close', (code) => {
          console.log(`Process exited with code ${code}`);
          if (!res.writableEnded) res.end();
        });
      } else {
        if (!res.writableEnded) res.end();
      }

      return;
    }

    if (action === 'generate') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const result = await generateCode(message);
      res.write(result.content);
      res.end();
      return;
    }

    if (action === 'explain') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const result = await explainCode(code);
      res.write(result.content);
      res.end();
      return;
    }

    if (action === 'debug') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const result = await debugCode(code, issue);
      res.write(result.content);
      res.end();
      return;
    }

    if (action === 'refactor') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const result = await refactorCode(code, improvements);
      res.write(result.content);
      res.end();
      return;
    }

    res.json({
      message: "Hello from the coding agent! Send a message or specify an action.",
      status: "error"
    });

  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message, status: "error" });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

console.log('Starting coding agent server');
app.listen(7100, () => {
  console.log("Coding agent listening on port 7100");
});