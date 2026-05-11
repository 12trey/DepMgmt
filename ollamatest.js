const http = require('http');
const express = require('express');

var messages = [

];

async function SendOllamaChat(message, res) {

  messages.push({ role: "user", content: message });

  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen3-coder:latest',
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
          process.stdout.write(json.message.content);
          // TODO take res from http and stream output
          res.write(json.message.content);
        }

        // Optional: detect completion
        if (json.done) {
          process.stdout.write('\n');

        }
      }
      catch (err) {
        console.log('Parse error:', err);
      }
    }
  }

  alldata = [];
  mybuffer.split('\n').forEach((b) => {
    try {
      if (JSON.parse(b)) alldata.push(JSON.parse(b));
    }
    catch {
    }
  });

  let newMsg = {
    role: 'assistant',
    content: ''
  }

  alldata.forEach(d => {
    //if(d.message.content)
    //process.stdout.write(d.message.content);
    //console.log(d);
    if (d.message) newMsg.content += d.message.content;
  });
  messages.push(newMsg);
  //console.log(messages);
  return newMsg.content;
}

async function test() {
  await SendOllamaChat("what is 4+8?");
  await SendOllamaChat("what the result of the last operation plus 2?");
  await SendOllamaChat("what the result of the last operation time 100?");
}
//test();


const app = express();
app.use(express.json());

app.post('/api/data', async (req, res) => {
  const { message, test } = req.body;
  console.log(test);
  console.log(message);
  if (message) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    let airesponse = await SendOllamaChat(message, res);
    //res.json({ message: airesponse, status: "success" });
    res.end();
  }
  else {
    res.json({ message: "Hello from the server! Something went wrong!", status: "error" });
  }
});

console.log('starting express');
app.listen(7100, () => {
  console.log("listenting on 7100");
});