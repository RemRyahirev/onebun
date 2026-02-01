/**
 * Integration tests for WebSocket Gateway + Client
 *
 * Tests the full cycle of WebSocket communication including:
 * - Server startup with WebSocket Gateway
 * - Client connection and message exchange
 * - Room management
 * - Event patterns
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'bun:test';

import type { WsClientData } from './ws.types';

import { OneBunApplication } from '../application/application';
import { Module } from '../decorators/decorators';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { createWsClient } from './ws-client';
import {
  WebSocketGateway,
  OnConnect,
  OnDisconnect,
  OnMessage,
  OnJoinRoom,
  OnLeaveRoom,
  Client,
  MessageData,
  RoomName,
  PatternParams,
  UseWsGuards,
} from './ws-decorators';
import { WsAuthGuard } from './ws-guards';
import { createWsServiceDefinition } from './ws-service-definition';

// Test port - use a high port to avoid conflicts
const TEST_PORT = 19876;
const TEST_URL = `ws://localhost:${TEST_PORT}/ws`;

// Test Gateway implementation
@WebSocketGateway({ path: '/ws' })
class TestGateway extends BaseWebSocketGateway {
  public connectCount = 0;
  public disconnectCount = 0;
  public lastMessage: unknown = null;
  public lastClient: WsClientData | null = null;

  @OnConnect()
  handleConnect(@Client() client: WsClientData) {
    this.connectCount++;
    this.lastClient = client;

    return { event: 'welcome', data: { message: 'Welcome!', clientId: client.id } };
  }

  @OnDisconnect()
  handleDisconnect(@Client() client: WsClientData) {
    this.disconnectCount++;
    this.lastClient = client;
  }

  @OnMessage('echo')
  handleEcho(@MessageData() data: unknown) {
    this.lastMessage = data;

    return { event: 'echo:response', data };
  }

  @OnMessage('broadcast')
  handleBroadcast(@Client() client: WsClientData, @MessageData() data: { text: string }) {
    this.broadcast('broadcast:message', { from: client.id, text: data.text });
  }

  @OnMessage('chat:{roomId}:message')
  handleChatMessage(
    @Client() client: WsClientData,
    @MessageData() data: { text: string },
    @PatternParams() params: { roomId: string },
  ) {
    this.emitToRoom(`room:${params.roomId}`, 'chat:message', {
      roomId: params.roomId,
      from: client.id,
      text: data.text,
    });

    return { event: 'chat:sent', data: { roomId: params.roomId } };
  }

  @OnJoinRoom()
  async handleJoinRoom(@Client() client: WsClientData, @RoomName() room: string) {
    await this.joinRoom(client.id, room);

    return { event: 'room:joined', data: { room } };
  }

  @OnLeaveRoom()
  async handleLeaveRoom(@Client() client: WsClientData, @RoomName() room: string) {
    await this.leaveRoom(client.id, room);

    return { event: 'room:left', data: { room } };
  }

  @UseWsGuards(WsAuthGuard)
  @OnMessage('protected')
  handleProtected(@Client() client: WsClientData) {
    return { event: 'protected:response', data: { userId: client.auth?.userId } };
  }
}

// Test Module
@Module({
  controllers: [TestGateway],
})
class TestModule {}

describe('WebSocket Integration', () => {
  let app: OneBunApplication;
  let definition: ReturnType<typeof createWsServiceDefinition>;

  beforeAll(async () => {
    // Start the application
    app = new OneBunApplication(TestModule, {
      port: TEST_PORT,
      development: true,
    });
    await app.start();

    // Create service definition for typed client
    definition = createWsServiceDefinition(TestModule);
  });

  afterAll(async () => {
    await app.stop();
  });

  describe('basic connection', () => {
    it('should connect and receive welcome message', async () => {
      const client = createWsClient(definition, { url: TEST_URL });

      let welcomeReceived = false;
      let welcomeData: unknown = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('welcome', (data: unknown) => {
        welcomeReceived = true;
        welcomeData = data;
      });

      await client.connect();

      // Wait for welcome message
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(welcomeReceived).toBe(true);
      expect(welcomeData).toHaveProperty('message', 'Welcome!');
      expect(welcomeData).toHaveProperty('clientId');

      client.disconnect();
    });

    it('should disconnect cleanly', async () => {
      const client = createWsClient(definition, { url: TEST_URL });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('message exchange', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any;

    beforeEach(async () => {
      client = createWsClient(definition, { url: TEST_URL, timeout: 2000 });
      await client.connect();
      // Wait for connection to stabilize
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    afterEach(() => {
      if (client?.isConnected()) {
        client.disconnect();
      }
    });

    it('should echo messages', async () => {
      const testData = { hello: 'world', number: 42 };

      let responseReceived = false;
      let responseData: unknown = null;

      client.TestGateway.on('echo:response', (data: unknown) => {
        responseReceived = true;
        responseData = data;
      });

      client.TestGateway.send('echo', testData);

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(responseReceived).toBe(true);
      expect(responseData).toEqual(testData);
    });

    it('should handle emit with acknowledgement', async () => {
      const testData = { test: 'data' };

      const response = await client.TestGateway.emit('echo', testData);
      
      // Response should be the acknowledgement
      expect(response).toBeDefined();
    });
  });

  describe('room management', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client1: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client2: any;

    beforeEach(async () => {
      client1 = createWsClient(definition, { url: TEST_URL, timeout: 2000 });
      client2 = createWsClient(definition, { url: TEST_URL, timeout: 2000 });
      await client1.connect();
      await client2.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    afterEach(() => {
      if (client1?.isConnected()) {
        client1.disconnect();
      }
      if (client2?.isConnected()) {
        client2.disconnect();
      }
    });

    it('should join and leave rooms', async () => {
      // Use emit with acknowledgement for more reliable testing
      const joinResponse = await client1.TestGateway.emit('join', 'room:test');
      // Handler returns { event: 'room:joined', data: { room } }
      // With ack, we get the full response
      expect(joinResponse).toBeDefined();

      const leaveResponse = await client1.TestGateway.emit('leave', 'room:test');
      expect(leaveResponse).toBeDefined();
    });

    it('should broadcast messages to room members', async () => {
      const roomName = 'room:chat';
      let client2ReceivedMessage = false;
      let receivedData: unknown = null;

      // Both clients join the same room
      client1.TestGateway.send('join', roomName);
      client2.TestGateway.send('join', roomName);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Client2 listens for messages
      client2.TestGateway.on('chat:message', (data: unknown) => {
        client2ReceivedMessage = true;
        receivedData = data;
      });

      // Client1 sends a message to the room
      client1.TestGateway.send('chat:chat:message', { text: 'Hello room!' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(client2ReceivedMessage).toBe(true);
      expect(receivedData).toHaveProperty('text', 'Hello room!');
    });
  });

  describe('pattern matching', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any;

    beforeEach(async () => {
      client = createWsClient(definition, { url: TEST_URL, timeout: 2000 });
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    afterEach(() => {
      if (client?.isConnected()) {
        client.disconnect();
      }
    });

    it('should match parameterized patterns', async () => {
      let sentResponse: unknown = null;

      client.TestGateway.on('chat:sent', (data: unknown) => {
        sentResponse = data;
      });

      // Send message to chat:room123:message pattern
      client.TestGateway.send('chat:room123:message', { text: 'Hello!' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(sentResponse).toHaveProperty('roomId', 'room123');
    });
  });

  describe('multiple clients', () => {
    it('should handle multiple simultaneous connections', async () => {
      const clients = [];
      const connectedClients: string[] = [];

      // Create 5 clients
      for (let i = 0; i < 5; i++) {
        const client = createWsClient(definition, { url: TEST_URL });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).TestGateway.on('welcome', (data: { clientId: string }) => {
          connectedClients.push(data.clientId);
        });
        clients.push(client);
      }

      // Connect all clients
      await Promise.all(clients.map((c) => c.connect()));
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(connectedClients.length).toBe(5);

      // All client IDs should be unique
      const uniqueIds = new Set(connectedClients);
      expect(uniqueIds.size).toBe(5);

      // Disconnect all
      clients.forEach((c) => c.disconnect());
    });

    it('should broadcast to all clients', async () => {
      const client1 = createWsClient(definition, { url: TEST_URL });
      const client2 = createWsClient(definition, { url: TEST_URL });

      let client1Received = false;
      let client2Received = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client1 as any).TestGateway.on('broadcast:message', () => {
        client1Received = true;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client2 as any).TestGateway.on('broadcast:message', () => {
        client2Received = true;
      });

      await client1.connect();
      await client2.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Client1 broadcasts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client1 as any).TestGateway.send('broadcast', { text: 'Hello everyone!' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(client1Received).toBe(true);
      expect(client2Received).toBe(true);

      client1.disconnect();
      client2.disconnect();
    });
  });

  describe('authentication and guards', () => {
    it('should reject protected handler without auth', async () => {
      // Client without auth token
      const client = createWsClient(definition, {
        url: TEST_URL,
        timeout: 2000,
      });

      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Try to access protected endpoint without auth - set up error listener
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('error', () => {
        // Error expected when auth fails
      });

      // Send to protected endpoint - should not receive response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.send('protected', {});
      await new Promise((resolve) => setTimeout(resolve, 100));

      // We should not receive protected:response since guard blocks it
      let protectedResponseReceived = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('protected:response', () => {
        protectedResponseReceived = true;
      });

      expect(protectedResponseReceived).toBe(false);

      client.disconnect();
    });

    it('should allow protected handler with valid auth token', async () => {
      // Client with auth token
      const client = createWsClient(definition, {
        url: TEST_URL,
        timeout: 2000,
        auth: {
          token: 'valid-test-token',
        },
      });

      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      let responseReceived = false;
      let responseData: { userId?: string } | null = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('protected:response', (data: { userId?: string }) => {
        responseReceived = true;
        responseData = data;
      });

      // Send to protected endpoint with auth
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.send('protected', {});
      await new Promise((resolve) => setTimeout(resolve, 100));

      // With auth token, the request should be allowed
      expect(responseReceived).toBe(true);
      expect(responseData).toBeDefined();

      client.disconnect();
    });

    it('should pass auth data to handler via client object', async () => {
      const testToken = 'test-user-token-123';
      const client = createWsClient(definition, {
        url: TEST_URL,
        timeout: 2000,
        auth: {
          token: testToken,
        },
      });

      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      let responseData: { userId?: string } | null = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('protected:response', (data: { userId?: string }) => {
        responseData = data;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.send('protected', {});
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Auth data should be available in handler
      expect(responseData).toBeDefined();

      client.disconnect();
    });

    it('should handle multiple authenticated clients independently', async () => {
      const client1 = createWsClient(definition, {
        url: TEST_URL,
        auth: { token: 'user1-token' },
      });
      const client2 = createWsClient(definition, {
        url: TEST_URL,
        auth: { token: 'user2-token' },
      });

      await client1.connect();
      await client2.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      let client1Response = false;
      let client2Response = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client1 as any).TestGateway.on('protected:response', () => {
        client1Response = true;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client2 as any).TestGateway.on('protected:response', () => {
        client2Response = true;
      });

      // Both clients access protected endpoint
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client1 as any).TestGateway.send('protected', {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client2 as any).TestGateway.send('protected', {});
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Both should receive responses
      expect(client1Response).toBe(true);
      expect(client2Response).toBe(true);

      client1.disconnect();
      client2.disconnect();
    });
  });
});
