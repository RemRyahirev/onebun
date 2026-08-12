/**
 * WebSocket Decorators Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import { BaseWebSocketGateway } from './ws-base-gateway';
import {
  WebSocketGateway,
  OnConnect,
  OnDisconnect,
  OnJoinRoom,
  OnLeaveRoom,
  OnMessage,
  Client,
  Socket,
  MessageData,
  RoomName,
  PatternParams,
  WsServer,
  getGatewayMetadata,
  isWebSocketGateway,
  getWsHandlers,
  getWsParamMetadata,
  UseWsGuards,
} from './ws-decorators';
import { WsHandlerType, WsParamType } from './ws.types';

describe('ws-decorators', () => {
  describe('@WebSocketGateway', () => {
    it('should mark class as WebSocket gateway', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {}

      expect(isWebSocketGateway(TestGateway)).toBe(true);
    });

    it('should store path option', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {}

      const metadata = getGatewayMetadata(TestGateway);
      expect(metadata?.path).toBe('/ws');
    });

    it('should store namespace option', () => {
      @WebSocketGateway({ path: '/ws', namespace: 'chat' })
      class TestGateway extends BaseWebSocketGateway {}

      const metadata = getGatewayMetadata(TestGateway);
      expect(metadata?.namespace).toBe('chat');
    });

    it('should use default path if not provided', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {}

      const metadata = getGatewayMetadata(TestGateway);
      expect(metadata?.path).toBe('/');
    });
  });

  describe('method decorators', () => {
    describe('@OnConnect', () => {
      it('should register connect handler', () => {
        @WebSocketGateway()
        class TestGateway extends BaseWebSocketGateway {
          @OnConnect()
          handleConnect() {}
        }

        const handlers = getWsHandlers(TestGateway);
        const connectHandler = handlers.find((h) => h.type === WsHandlerType.CONNECT);

        expect(connectHandler).toBeDefined();
        expect(connectHandler?.handler).toBe('handleConnect');
      });
    });

    describe('@OnDisconnect', () => {
      it('should register disconnect handler', () => {
        @WebSocketGateway()
        class TestGateway extends BaseWebSocketGateway {
          @OnDisconnect()
          handleDisconnect() {}
        }

        const handlers = getWsHandlers(TestGateway);
        const handler = handlers.find((h) => h.type === WsHandlerType.DISCONNECT);

        expect(handler).toBeDefined();
        expect(handler?.handler).toBe('handleDisconnect');
      });
    });

    describe('@OnJoinRoom', () => {
      it('should register join room handler without pattern', () => {
        @WebSocketGateway()
        class TestGateway extends BaseWebSocketGateway {
          @OnJoinRoom()
          handleJoin() {}
        }

        const handlers = getWsHandlers(TestGateway);
        const handler = handlers.find((h) => h.type === WsHandlerType.JOIN_ROOM);

        expect(handler).toBeDefined();
        expect(handler?.pattern).toBeUndefined();
      });

      it('should register join room handler with pattern', () => {
        @WebSocketGateway()
        class TestGateway extends BaseWebSocketGateway {
          @OnJoinRoom('room:{roomId}')
          handleJoin() {}
        }

        const handlers = getWsHandlers(TestGateway);
        const handler = handlers.find((h) => h.type === WsHandlerType.JOIN_ROOM);

        expect(handler?.pattern).toBe('room:{roomId}');
      });
    });

    describe('@OnLeaveRoom', () => {
      it('should register leave room handler', () => {
        @WebSocketGateway()
        class TestGateway extends BaseWebSocketGateway {
          @OnLeaveRoom('room:*')
          handleLeave() {}
        }

        const handlers = getWsHandlers(TestGateway);
        const handler = handlers.find((h) => h.type === WsHandlerType.LEAVE_ROOM);

        expect(handler).toBeDefined();
        expect(handler?.pattern).toBe('room:*');
      });
    });

    describe('@OnMessage', () => {
      it('should register message handler with pattern', () => {
        @WebSocketGateway()
        class TestGateway extends BaseWebSocketGateway {
          @OnMessage('chat:message')
          handleMessage() {}
        }

        const handlers = getWsHandlers(TestGateway);
        const handler = handlers.find((h) => h.type === WsHandlerType.MESSAGE);

        expect(handler).toBeDefined();
        expect(handler?.pattern).toBe('chat:message');
      });

      it('should support wildcard patterns', () => {
        @WebSocketGateway()
        class TestGateway extends BaseWebSocketGateway {
          @OnMessage('chat:*')
          handleMessage() {}
        }

        const handlers = getWsHandlers(TestGateway);
        const handler = handlers.find((h) => h.type === WsHandlerType.MESSAGE);

        expect(handler?.pattern).toBe('chat:*');
      });

      it('should support parameterized patterns', () => {
        @WebSocketGateway()
        class TestGateway extends BaseWebSocketGateway {
          @OnMessage('chat:{roomId}:message')
          handleMessage() {}
        }

        const handlers = getWsHandlers(TestGateway);
        const handler = handlers.find((h) => h.type === WsHandlerType.MESSAGE);

        expect(handler?.pattern).toBe('chat:{roomId}:message');
      });
    });
  });

  describe('parameter decorators', () => {
    it('should register @Client parameter', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('test')
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        handleMessage(@Client() client: unknown) {}
      }

      const params = getWsParamMetadata(TestGateway.prototype, 'handleMessage');
      const clientParam = params.find((p) => p.type === WsParamType.CLIENT);

      expect(clientParam).toBeDefined();
      expect(clientParam?.index).toBe(0);
    });

    it('should register @Socket parameter', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('test')
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        handleMessage(@Socket() socket: unknown) {}
      }

      const params = getWsParamMetadata(TestGateway.prototype, 'handleMessage');
      const socketParam = params.find((p) => p.type === WsParamType.SOCKET);

      expect(socketParam).toBeDefined();
    });

    it('should register @MessageData parameter', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('test')
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        handleMessage(@MessageData() data: unknown) {}
      }

      const params = getWsParamMetadata(TestGateway.prototype, 'handleMessage');
      const dataParam = params.find((p) => p.type === WsParamType.MESSAGE_DATA);

      expect(dataParam).toBeDefined();
    });

    it('should register @MessageData with property path', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('test')
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        handleMessage(@MessageData('text') text: string) {}
      }

      const params = getWsParamMetadata(TestGateway.prototype, 'handleMessage');
      const dataParam = params.find((p) => p.type === WsParamType.MESSAGE_DATA);

      expect(dataParam?.property).toBe('text');
    });

    it('should register @RoomName parameter', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {
        @OnJoinRoom()
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        handleJoin(@RoomName() room: string) {}
      }

      const params = getWsParamMetadata(TestGateway.prototype, 'handleJoin');
      const roomParam = params.find((p) => p.type === WsParamType.ROOM_NAME);

      expect(roomParam).toBeDefined();
    });

    it('should register @PatternParams parameter', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('chat:{roomId}')
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        handleMessage(@PatternParams() params: { roomId: string }) {}
      }

      const params = getWsParamMetadata(TestGateway.prototype, 'handleMessage');
      const patternParam = params.find((p) => p.type === WsParamType.PATTERN_PARAMS);

      expect(patternParam).toBeDefined();
    });

    it('should register @WsServer parameter', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('test')
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        handleMessage(@WsServer() server: unknown) {}
      }

      const params = getWsParamMetadata(TestGateway.prototype, 'handleMessage');
      const serverParam = params.find((p) => p.type === WsParamType.SERVER);

      expect(serverParam).toBeDefined();
    });

    it('should register multiple parameters in correct order', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('chat:{roomId}')
        handleMessage(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          @Client() client: unknown,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          @MessageData() data: unknown,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          @PatternParams() params: unknown,
        ) {}
      }

      const params = getWsParamMetadata(TestGateway.prototype, 'handleMessage');

      expect(params).toHaveLength(3);
      expect(params.find((p) => p.index === 0)?.type).toBe(WsParamType.CLIENT);
      expect(params.find((p) => p.index === 1)?.type).toBe(WsParamType.MESSAGE_DATA);
      expect(params.find((p) => p.index === 2)?.type).toBe(WsParamType.PATTERN_PARAMS);
    });
  });

  describe('multiple handlers', () => {
    it('should support multiple handlers in one gateway', () => {
      @WebSocketGateway()
      class TestGateway extends BaseWebSocketGateway {
        @OnConnect()
        handleConnect() {}

        @OnDisconnect()
        handleDisconnect() {}

        @OnMessage('chat:*')
        handleChat() {}

        @OnMessage('admin:*')
        handleAdmin() {}
      }

      const handlers = getWsHandlers(TestGateway);
      expect(handlers).toHaveLength(4);
    });
  });
});

// ============================================================================
// Decorator source order must never change runtime behaviour
//
// `@OnMessage` and its siblings snapshot the handler's guards when they run, and
// TypeScript applies method decorators BOTTOM-UP — so `@UseWsGuards` written ABOVE the
// handler decorator landed after the snapshot and was silently discarded, leaving the
// handler unguarded. The HTTP route path had the identical defect.
// ============================================================================

describe('@UseWsGuards order independence', () => {
  class DenyWsGuard {
    canActivate(): boolean {
      return false;
    }
  }

  @WebSocketGateway({ path: '/order' })
  class OrderGateway extends BaseWebSocketGateway {
    @UseWsGuards(DenyWsGuard)
    @OnMessage('above')
    above(): string {
      return 'above';
    }

    @OnMessage('below')
    @UseWsGuards(DenyWsGuard)
    below(): string {
      return 'below';
    }
  }

  it('registers the guard whether it is written above or below @OnMessage', () => {
    const handlers = getWsHandlers(OrderGateway);
    const above = handlers.find((h) => h.pattern === 'above');
    const below = handlers.find((h) => h.pattern === 'below');

    // Pre-fix: the ABOVE handler carried an empty guard list and ran unguarded, while
    // BELOW carried the guard. Asserted on the registered guard list because the gateway's
    // execution path reads exactly this array (ws-handler.ts passes handler.guards to
    // executeGuards); the end-to-end denial is covered by the integration suite.
    expect(above?.guards).toEqual([DenyWsGuard]);
    expect(below?.guards).toEqual([DenyWsGuard]);
  });
});
