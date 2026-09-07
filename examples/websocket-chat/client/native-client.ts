/* eslint-disable no-console */
import { createNativeWsClient } from '@onebun/core';

// A standalone client shares no types with the server, so the payloads it expects
// are declared here. `on()` is `on<T = unknown>` — without an explicit argument the
// listener parameter is `unknown` and every property access is a compile error.
interface WelcomePayload {
  message: string;
  clientId: string;
  timestamp: number;
}

interface ChatMessagePayload {
  id: string;
  roomId: string;
  userId: string;
  text: string;
  timestamp: number;
}

interface RoomMembershipPayload {
  userId: string;
  room: string;
}

const client = createNativeWsClient({
  url: 'ws://localhost:3000/chat',
  protocol: 'native',
  auth: { token: 'user-jwt-token' },
  reconnect: true,
});

client.on('connect', () => console.log('Connected to chat'));
client.on<WelcomePayload>('welcome', (data) => console.log('Welcome:', data.message));
client.on<ChatMessagePayload>('chat:message', (msg) => console.log(`[${msg.userId}]: ${msg.text}`));
client.on<RoomMembershipPayload>('user:joined', (data) => console.log(`User ${data.userId} joined`));
client.on<RoomMembershipPayload>('user:left', (data) => console.log(`User ${data.userId} left`));

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
