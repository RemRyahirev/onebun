/**
 * Socket.IO Protocol Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  EngineIOPacketType,
  encodeEngineIOPacket,
  decodeEngineIOPacket,
  createHandshake,
  createOpenPacket,
  createPingPacket,
  createPongPacket,
  SocketIOPacketType,
  encodeSocketIOPacket,
  decodeSocketIOPacket,
  createConnectPacket,
  createDisconnectPacket,
  createEventPacket,
  createAckPacket,
  createConnectErrorPacket,
  wrapInEngineIO,
  unwrapFromEngineIO,
  parseMessage,
  createFullEventMessage,
  createFullAckMessage,
  isNativeMessage,
  parseNativeMessage,
  createNativeMessage,
  detectProtocol,
} from './ws-socketio-protocol';

describe('ws-socketio-protocol', () => {
  describe('Engine.IO', () => {
    describe('encodeEngineIOPacket', () => {
      it('should encode OPEN packet', () => {
        const packet = { type: EngineIOPacketType.OPEN, data: '{"sid":"abc"}' };
        expect(encodeEngineIOPacket(packet)).toBe('0{"sid":"abc"}');
      });

      it('should encode PING packet without data', () => {
        const packet = { type: EngineIOPacketType.PING };
        expect(encodeEngineIOPacket(packet)).toBe('2');
      });

      it('should encode PONG packet with data', () => {
        const packet = { type: EngineIOPacketType.PONG, data: 'probe' };
        expect(encodeEngineIOPacket(packet)).toBe('3probe');
      });

      it('should encode MESSAGE packet', () => {
        const packet = { type: EngineIOPacketType.MESSAGE, data: 'hello' };
        expect(encodeEngineIOPacket(packet)).toBe('4hello');
      });
    });

    describe('decodeEngineIOPacket', () => {
      it('should decode OPEN packet', () => {
        const packet = decodeEngineIOPacket('0{"sid":"abc"}');
        expect(packet.type).toBe(EngineIOPacketType.OPEN);
        expect(packet.data).toBe('{"sid":"abc"}');
      });

      it('should decode PING packet', () => {
        const packet = decodeEngineIOPacket('2');
        expect(packet.type).toBe(EngineIOPacketType.PING);
      });

      it('should decode MESSAGE packet', () => {
        const packet = decodeEngineIOPacket('4hello');
        expect(packet.type).toBe(EngineIOPacketType.MESSAGE);
        expect(packet.data).toBe('hello');
      });

      it('should handle empty string', () => {
        const packet = decodeEngineIOPacket('');
        expect(packet.type).toBe(EngineIOPacketType.NOOP);
      });
    });

    describe('createHandshake', () => {
      it('should create handshake with defaults', () => {
        const handshake = createHandshake('test-sid');
        expect(handshake.sid).toBe('test-sid');
        expect(handshake.upgrades).toEqual(['websocket']);
        expect(handshake.pingInterval).toBeGreaterThan(0);
        expect(handshake.pingTimeout).toBeGreaterThan(0);
        expect(handshake.maxPayload).toBeGreaterThan(0);
      });

      it('should allow custom options', () => {
        const handshake = createHandshake('test-sid', {
          pingInterval: 5000,
          pingTimeout: 3000,
        });
        expect(handshake.pingInterval).toBe(5000);
        expect(handshake.pingTimeout).toBe(3000);
      });
    });

    describe('createOpenPacket', () => {
      it('should create OPEN packet with handshake', () => {
        const handshake = createHandshake('test-sid');
        const packet = createOpenPacket(handshake);
        expect(packet.startsWith('0')).toBe(true);
        expect(packet).toContain('test-sid');
      });
    });

    describe('createPingPacket and createPongPacket', () => {
      it('should create PING packet', () => {
        expect(createPingPacket()).toBe('2');
        expect(createPingPacket('probe')).toBe('2probe');
      });

      it('should create PONG packet', () => {
        expect(createPongPacket()).toBe('3');
        expect(createPongPacket('probe')).toBe('3probe');
      });
    });
  });

  describe('Socket.IO', () => {
    describe('encodeSocketIOPacket', () => {
      it('should encode CONNECT packet', () => {
        const packet = { type: SocketIOPacketType.CONNECT, nsp: '/' };
        expect(encodeSocketIOPacket(packet)).toBe('0');
      });

      it('should encode CONNECT packet with namespace', () => {
        const packet = { type: SocketIOPacketType.CONNECT, nsp: '/chat' };
        expect(encodeSocketIOPacket(packet)).toBe('0/chat,');
      });

      it('should encode EVENT packet', () => {
        const packet = {
          type: SocketIOPacketType.EVENT,
          nsp: '/',
          data: ['message', { text: 'hello' }],
        };
        expect(encodeSocketIOPacket(packet)).toBe('2["message",{"text":"hello"}]');
      });

      it('should encode ACK packet', () => {
        const packet = {
          type: SocketIOPacketType.ACK,
          nsp: '/',
          id: 1,
          data: [{ ok: true }],
        };
        expect(encodeSocketIOPacket(packet)).toBe('31[{"ok":true}]');
      });
    });

    describe('decodeSocketIOPacket', () => {
      it('should decode CONNECT packet', () => {
        const packet = decodeSocketIOPacket('0');
        expect(packet.type).toBe(SocketIOPacketType.CONNECT);
        expect(packet.nsp).toBe('/');
      });

      it('should decode EVENT packet', () => {
        const packet = decodeSocketIOPacket('2["message",{"text":"hello"}]');
        expect(packet.type).toBe(SocketIOPacketType.EVENT);
        expect(packet.data).toEqual(['message', { text: 'hello' }]);
      });

      it('should decode ACK packet with id', () => {
        const packet = decodeSocketIOPacket('31[{"ok":true}]');
        expect(packet.type).toBe(SocketIOPacketType.ACK);
        expect(packet.id).toBe(1);
        expect(packet.data).toEqual([{ ok: true }]);
      });

      it('should decode packet with namespace', () => {
        const packet = decodeSocketIOPacket('2/chat,["join",{}]');
        expect(packet.nsp).toBe('/chat');
        expect(packet.data).toEqual(['join', {}]);
      });
    });

    describe('createConnectPacket', () => {
      it('should create connect packet for default namespace', () => {
        const packet = createConnectPacket();
        expect(packet).toBe('0');
      });

      it('should create connect packet with auth data', () => {
        const packet = createConnectPacket('/', { token: 'abc' });
        expect(packet).toContain('token');
      });
    });

    describe('createDisconnectPacket', () => {
      it('should create disconnect packet', () => {
        expect(createDisconnectPacket()).toBe('1');
        expect(createDisconnectPacket('/chat')).toBe('1/chat,');
      });
    });

    describe('createEventPacket', () => {
      it('should create event packet', () => {
        const packet = createEventPacket('message', { text: 'hello' });
        expect(packet).toContain('message');
        expect(packet).toContain('hello');
      });

      it('should include ack id', () => {
        const packet = createEventPacket('message', {}, '/', 123);
        expect(packet).toContain('123');
      });
    });

    describe('createAckPacket', () => {
      it('should create ack packet', () => {
        const packet = createAckPacket(1, { ok: true });
        expect(packet).toBe('31[{"ok":true}]');
      });
    });

    describe('createConnectErrorPacket', () => {
      it('should create error packet', () => {
        const packet = createConnectErrorPacket({ message: 'Unauthorized' });
        expect(packet).toContain('Unauthorized');
      });
    });
  });

  describe('Combined messages', () => {
    describe('wrapInEngineIO', () => {
      it('should wrap Socket.IO packet in Engine.IO MESSAGE', () => {
        const socketIO = createEventPacket('test', {});
        const wrapped = wrapInEngineIO(socketIO);
        expect(wrapped.startsWith('4')).toBe(true);
      });
    });

    describe('unwrapFromEngineIO', () => {
      it('should extract Socket.IO packet from Engine.IO MESSAGE', () => {
        const message = '42["test",{}]';
        const socketIO = unwrapFromEngineIO(message);
        expect(socketIO).toBe('2["test",{}]');
      });

      it('should return null for non-MESSAGE packets', () => {
        expect(unwrapFromEngineIO('2')).toBeNull();
        expect(unwrapFromEngineIO('3')).toBeNull();
      });
    });

    describe('parseMessage', () => {
      it('should parse full message', () => {
        const message = '42["test",{"data":"value"}]';
        const { engineIO, socketIO } = parseMessage(message);

        expect(engineIO.type).toBe(EngineIOPacketType.MESSAGE);
        expect(socketIO?.type).toBe(SocketIOPacketType.EVENT);
        expect(socketIO?.data).toEqual(['test', { data: 'value' }]);
      });

      it('should handle ping without socketIO', () => {
        const { engineIO, socketIO } = parseMessage('2');
        expect(engineIO.type).toBe(EngineIOPacketType.PING);
        expect(socketIO).toBeUndefined();
      });
    });

    describe('createFullEventMessage', () => {
      it('should create full event message', () => {
        const message = createFullEventMessage('chat:message', { text: 'hello' });
        const { socketIO } = parseMessage(message);

        expect(socketIO?.data?.[0]).toBe('chat:message');
        expect(socketIO?.data?.[1]).toEqual({ text: 'hello' });
      });
    });

    describe('createFullAckMessage', () => {
      it('should create full ack message', () => {
        const message = createFullAckMessage(123, { ok: true });
        const { socketIO } = parseMessage(message);

        expect(socketIO?.type).toBe(SocketIOPacketType.ACK);
        expect(socketIO?.id).toBe(123);
      });
    });
  });

  describe('Native WebSocket format', () => {
    describe('isNativeMessage', () => {
      it('should detect native format', () => {
        expect(isNativeMessage('{"event":"test","data":{}}')).toBe(true);
        expect(isNativeMessage('{"event":"test"}')).toBe(true);
      });

      it('should reject non-native format', () => {
        expect(isNativeMessage('42["test",{}]')).toBe(false);
        expect(isNativeMessage('not json')).toBe(false);
        expect(isNativeMessage('{}')).toBe(false);
      });
    });

    describe('parseNativeMessage', () => {
      it('should parse native message', () => {
        const message = parseNativeMessage('{"event":"test","data":{"value":1}}');
        expect(message?.event).toBe('test');
        expect(message?.data).toEqual({ value: 1 });
      });

      it('should parse message with ack', () => {
        const message = parseNativeMessage('{"event":"test","data":{},"ack":123}');
        expect(message?.ack).toBe(123);
      });
    });

    describe('createNativeMessage', () => {
      it('should create native message', () => {
        const message = createNativeMessage('test', { value: 1 });
        expect(message).toBe('{"event":"test","data":{"value":1}}');
      });

      it('should include ack id', () => {
        const message = createNativeMessage('test', {}, 123);
        expect(message).toContain('"ack":123');
      });
    });
  });

  describe('Protocol detection', () => {
    it('should detect socket.io protocol', () => {
      expect(detectProtocol('42["test",{}]')).toBe('socket.io');
      expect(detectProtocol('2')).toBe('socket.io');
    });

    it('should detect native protocol', () => {
      expect(detectProtocol('{"event":"test","data":{}}')).toBe('native');
    });
  });
});
