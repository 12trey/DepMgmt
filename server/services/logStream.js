let wss = null;

exports.attachWss = (webSocketServer) => {
  wss = webSocketServer;
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // Client sends { subscribe: executionId } to filter messages
    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.subscribe) ws.subscribedTo = data.subscribe;
      } catch {}
    });
  });

  // Heartbeat
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
};

exports.broadcast = (executionId, text, stream) => {
  if (!wss) return;
  const message = JSON.stringify({ executionId, text, stream, timestamp: Date.now() });
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1 && (!ws.subscribedTo || ws.subscribedTo === executionId)) {
      ws.send(message);
    }
  });
};
