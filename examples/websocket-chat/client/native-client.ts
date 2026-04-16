/* eslint-disable no-console */
import { createNativeWsClient } from '@onebun/core';

const client = createNativeWsClient({
  url: 'ws://localhost:3000/chat',
  protocol: 'native',
  auth: { token: 'user-jwt-token' },
  reconnect: true,
});

client.on('connect', () => console.log('Connected to chat'));
client.on('welcome', (data) => console.log('Welcome:', data.message));
client.on('chat:message', (msg) => console.log(`[${msg.userId}]: ${msg.text}`));
client.on('user:joined', (data) => console.log(`User ${data.userId} joined`));
client.on('user:left', (data) => console.log(`User ${data.userId} left`));

await client.connect();

// Join room
const roomInfo = await client.emit('join', 'room:general');
console.log('Joined room:', roomInfo);

// Send a message
await client.emit('chat:general:message', { text: 'Hello everyone!' });

// Typing indicator
client.send('typing:general', {});

// Leave and disconnect after a delay
setTimeout(() => {
  client.send('leave', 'room:general');
  client.disconnect();
  console.log('Disconnected');
}, 5000);
