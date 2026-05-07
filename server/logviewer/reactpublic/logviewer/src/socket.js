// src/socket.js
import { io } from 'socket.io-client';

// // Use your backend server URL
// const URL = 'http://localhost:4000'; 

// export const socket = io(URL, {
//   autoConnect: false // Recommended: connect manually when needed
// });

export const socket = io('http://localhost:3000',{
    autoConnect: true
});