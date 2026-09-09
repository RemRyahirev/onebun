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
import { makeMockLoggerLayer } from '../testing/test-utils';

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
@WebSocketGateway({
  path: '/ws',
  // The gateway's own authentication. Nothing in the framework sets `authenticated`, and
  // WsAuthGuard requires it — before this hook existed the guard could never pass, and the
  // suite's "allows a valid token" case only looked green because a decorator-order defect
  // stopped the guard from running at all.
  authenticate: ({ token }) => (token ? { userId: `user-for-${token}` } : null),
})
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
      loggerLayer: makeMockLoggerLayer(),
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
      await new Promise((resolve) => setTimeout(resolve, 20));

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
      await new Promise((resolve) => setTimeout(resolve, 20));
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
      await new Promise((resolve) => setTimeout(resolve, 30));

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
      await new Promise((resolve) => setTimeout(resolve, 20));
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
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Client2 listens for messages
      client2.TestGateway.on('chat:message', (data: unknown) => {
        client2ReceivedMessage = true;
        receivedData = data;
      });

      // Client1 sends a message to the room
      client1.TestGateway.send('chat:chat:message', { text: 'Hello room!' });
      await new Promise((resolve) => setTimeout(resolve, 30));

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
      await new Promise((resolve) => setTimeout(resolve, 20));
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
      await new Promise((resolve) => setTimeout(resolve, 30));

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
      await new Promise((resolve) => setTimeout(resolve, 30));

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
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Client1 broadcasts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client1 as any).TestGateway.send('broadcast', { text: 'Hello everyone!' });
      await new Promise((resolve) => setTimeout(resolve, 30));

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
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Try to access protected endpoint without auth - set up error listener
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('error', () => {
        // Error expected when auth fails
      });

      // Listen BEFORE sending — registering the listener afterwards made this assertion
      // vacuous, so it passed even while the guard was being skipped entirely.
      let protectedResponseReceived = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('protected:response', () => {
        protectedResponseReceived = true;
      });

      // Send to protected endpoint - should not receive response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.send('protected', {});
      await new Promise((resolve) => setTimeout(resolve, 30));

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
      await new Promise((resolve) => setTimeout(resolve, 20));

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
      await new Promise((resolve) => setTimeout(resolve, 30));

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
      await new Promise((resolve) => setTimeout(resolve, 20));

      let responseData: { userId?: string } | null = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('protected:response', (data: { userId?: string }) => {
        responseData = data;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.send('protected', {});
      await new Promise((resolve) => setTimeout(resolve, 30));

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
      await new Promise((resolve) => setTimeout(resolve, 20));

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
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Both should receive responses
      expect(client1Response).toBe(true);
      expect(client2Response).toBe(true);

      client1.disconnect();
      client2.disconnect();
    });
  });

  describe('authenticate hook', () => {
    /**
     * Before this hook existed, `ws-handler.ts` created every client with
     * `authenticated: false` and nothing anywhere set it to true — so `WsAuthGuard`, an
     * exported built-in, denied every client forever, and `WsPermissionGuard` read a
     * permissions list nobody populated. The suite's own "allows a valid token" case passed
     * only because a decorator-order defect stopped the guard from running at all.
     */
    it('lets an authenticated client through a WsAuthGuard-protected handler', async () => {
      const client = createWsClient(definition, {
        url: TEST_URL,
        timeout: 2000,
        auth: { token: 'hook-token' },
      });

      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 20));

      let received = false;
      let payload: { userId?: string } | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('protected:response', (data: { userId?: string }) => {
        received = true;
        payload = data;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.send('protected', {});
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(received).toBe(true);
      // The identity the hook returned reached the handler, which is what proves the hook
      // ran rather than the guard being bypassed.
      expect(payload?.userId).toBe('user-for-hook-token');

      client.disconnect();
    });

    it('admits a client with no token as anonymous, and the guard still denies it', async () => {
      const client = createWsClient(definition, { url: TEST_URL, timeout: 2000 });

      // `null` from the hook means connect-but-anonymous: the upgrade succeeds...
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 20));

      let received = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('protected:response', () => {
        received = true;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.send('protected', {});
      await new Promise((resolve) => setTimeout(resolve, 30));

      // ...and the protected handler is still out of reach.
      expect(received).toBe(false);

      client.disconnect();
    });
  });
});

/**
 * `app.stop()` closes the sockets it is serving.
 *
 * It used to close none. No close frame was sent, and `drainHttpServer` severed every established
 * upgrade at the end with `server.stop(true)` — so a client saw nothing at all (measured:
 * `readyState` still 1, no close event) and learned the service was gone only when the process
 * died, as an abnormal 1006 at an arbitrary moment.
 *
 * The close now happens BEFORE the HTTP drain, which is what lets `@OnDisconnect` run while the
 * gateway, its storage and the DI scope are still alive.
 */
describe('shutdown closes WebSocket connections', () => {
  const disconnected: string[] = [];
  const echoed: number[] = [];
  /** Long enough that "started" and "finished" are distinguishable in the assertions below. */
  const DISCONNECT_WORK_MS = 300;

  @WebSocketGateway({ path: '/shutdown-ws' })
  class ShutdownGateway extends BaseWebSocketGateway {
    @OnDisconnect()
    async onDisconnect(@Client() client: WsClientData): Promise<void> {
      // Slow on purpose. `stop()` has to WAIT for this, not merely start it: without the wait the
      // handler would still be running when the storage is wiped and the DI scope is disposed.
      // A mutation that drops the wait leaves a fast handler passing by luck.
      await Bun.sleep(DISCONNECT_WORK_MS);

      // Reads the client back out of storage, the way the chat example does. It must still be
      // there: the storage wipe belongs after the disconnect path, not before it.
      const stored = await this.getClient(client.id);

      disconnected.push(stored ? `present:${client.id}` : `missing:${client.id}`);
    }

    @OnMessage('echo')
    onEcho(@MessageData() data: { n: number }): void {
      echoed.push(data.n);
    }
  }

  @Module({ controllers: [ShutdownGateway] })
  class ShutdownModule {}

  afterEach(() => {
    disconnected.length = 0;
    echoed.length = 0;
  });

  it('sends a close, runs @OnDisconnect with storage intact, and handles nothing afterwards', async () => {
    const shutdownApp = new OneBunApplication(ShutdownModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await shutdownApp.start();

    const socket = new WebSocket(`${shutdownApp.getHttpUrl().replace('http', 'ws')}/shutdown-ws`);
    let closeReason: string | undefined;
    let closeSeen = false;

    socket.addEventListener('close', (event) => {
      closeSeen = true;
      closeReason = (event as CloseEvent).reason;
    });

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('the socket never opened')));
    });

    socket.send(JSON.stringify({ event: 'echo', data: { n: 1 } }));

    const deadline = Bun.nanoseconds() + 3_000 * 1_000_000;
    while (echoed.length === 0) {
      if (Bun.nanoseconds() > deadline) {
        throw new Error('the gateway never handled the first frame');
      }
      await Bun.sleep(20);
    }

    await shutdownApp.stop();

    // (a) The client was told, rather than being cut when the process died. Asserted on the
    // reason and on the state: Bun's own client reports the CODE as 1000 whatever the server
    // sends — measured against a bare `Bun.serve`, `close(1001, 'bye')` reaches the server's own
    // callback as 1001 and the client as 1000 — so the code is not something to pin here.
    expect(closeSeen).toBe(true);
    expect(closeReason).toBe('Server shutting down');
    expect(socket.readyState).toBe(WebSocket.CLOSED);

    // (b) `@OnDisconnect` ran to COMPLETION before `stop()` resolved — asserted right here, with
    // no further waiting, so a shutdown that merely kicked the handler off fails.
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]).toStartWith('present:');

    // (c) Nothing sent afterwards is handled.
    socket.send(JSON.stringify({ event: 'echo', data: { n: 2 } }));
    await Bun.sleep(200);

    expect(echoed).toEqual([1]);
    // Booting and stopping a whole application, twice over a real socket, does not fit bun's
    // 5 s default.
  }, 20_000);
});
