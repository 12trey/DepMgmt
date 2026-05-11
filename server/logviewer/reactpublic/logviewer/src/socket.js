import { io } from 'socket.io-client';

// Connect to the backend. In dev, Vite proxies socket.io → port 4000.
// In production (served from Express), this is a relative connection.
export const socket = io({ autoConnect: true });
