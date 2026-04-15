import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket(executionId) {
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);

  const clear = useCallback(() => setMessages([]), []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/logs`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (executionId) ws.send(JSON.stringify({ subscribe: executionId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setMessages((prev) => [...prev, data]);
      } catch {}
    };

    return () => ws.close();
  }, [executionId]);

  // Allow re-subscribing
  const subscribe = useCallback((id) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ subscribe: id }));
    }
  }, []);

  return { messages, subscribe, clear };
}
