/**
 * WebSocket Type Guards Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  isWsMessage,
  isWsHandlerResponse,
  isWsClientData,
  isWsRoom,
} from './ws.types';

describe('ws.types type guards', () => {
  describe('isWsMessage', () => {
    it('should return true for valid WsMessage with event and data', () => {
      expect(isWsMessage({ event: 'chat:message', data: 'hello' })).toBe(true);
    });

    it('should return true for WsMessage without data field', () => {
      expect(isWsMessage({ event: 'ping' })).toBe(true);
    });

    it('should return true for WsMessage with ack', () => {
      expect(isWsMessage({ event: 'request', data: null, ack: 42 })).toBe(true);
    });

    it('should return false for null', () => {
      expect(isWsMessage(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isWsMessage(undefined)).toBe(false);
    });

    it('should return false for primitive string', () => {
      expect(isWsMessage('event')).toBe(false);
    });

    it('should return false for object missing event field', () => {
      expect(isWsMessage({ data: 'hello' })).toBe(false);
    });

    it('should return false when event is not a string', () => {
      expect(isWsMessage({ event: 123, data: 'hello' })).toBe(false);
    });

    it('should return false for empty object', () => {
      expect(isWsMessage({})).toBe(false);
    });
  });

  describe('isWsHandlerResponse', () => {
    it('should return true for valid WsHandlerResponse', () => {
      expect(isWsHandlerResponse({ event: 'response', data: { ok: true } })).toBe(true);
    });

    it('should return true when data is null', () => {
      expect(isWsHandlerResponse({ event: 'ack', data: null })).toBe(true);
    });

    it('should return true when data is a primitive', () => {
      expect(isWsHandlerResponse({ event: 'pong', data: 0 })).toBe(true);
    });

    it('should return false for null', () => {
      expect(isWsHandlerResponse(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isWsHandlerResponse(undefined)).toBe(false);
    });

    it('should return false when event is missing', () => {
      expect(isWsHandlerResponse({ data: 'hello' })).toBe(false);
    });

    it('should return false when data is missing', () => {
      expect(isWsHandlerResponse({ event: 'response' })).toBe(false);
    });

    it('should return false when event is not a string', () => {
      expect(isWsHandlerResponse({ event: 42, data: 'hello' })).toBe(false);
    });

    it('should return false for empty object', () => {
      expect(isWsHandlerResponse({})).toBe(false);
    });
  });

  describe('isWsClientData', () => {
    const validClientData = {
      id: 'client-1',
      rooms: ['room-a'],
      connectedAt: Date.now(),
      auth: null,
      metadata: {},
      protocol: 'native' as const,
    };

    it('should return true for valid WsClientData with native protocol', () => {
      expect(isWsClientData(validClientData)).toBe(true);
    });

    it('should return true for valid WsClientData with socketio protocol', () => {
      expect(isWsClientData({ ...validClientData, protocol: 'socketio' })).toBe(true);
    });

    it('should return true when rooms is empty array', () => {
      expect(isWsClientData({ ...validClientData, rooms: [] })).toBe(true);
    });

    it('should return false for null', () => {
      expect(isWsClientData(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isWsClientData(undefined)).toBe(false);
    });

    it('should return false when id is missing', () => {
      const { id: _id, ...rest } = validClientData;
      expect(isWsClientData(rest)).toBe(false);
    });

    it('should return false when id is not a string', () => {
      expect(isWsClientData({ ...validClientData, id: 42 })).toBe(false);
    });

    it('should return false when rooms is missing', () => {
      const { rooms: _rooms, ...rest } = validClientData;
      expect(isWsClientData(rest)).toBe(false);
    });

    it('should return false when rooms is not an array', () => {
      expect(isWsClientData({ ...validClientData, rooms: 'room-a' })).toBe(false);
    });

    it('should return false when connectedAt is missing', () => {
      const { connectedAt: _connectedAt, ...rest } = validClientData;
      expect(isWsClientData(rest)).toBe(false);
    });

    it('should return false when connectedAt is not a number', () => {
      expect(isWsClientData({ ...validClientData, connectedAt: '2024-01-01' })).toBe(false);
    });

    it('should return false when protocol is missing', () => {
      const { protocol: _protocol, ...rest } = validClientData;
      expect(isWsClientData(rest)).toBe(false);
    });

    it('should return false when protocol is unknown value', () => {
      expect(isWsClientData({ ...validClientData, protocol: 'ws' })).toBe(false);
    });

    it('should return false for empty object', () => {
      expect(isWsClientData({})).toBe(false);
    });
  });

  describe('isWsRoom', () => {
    it('should return true for valid WsRoom', () => {
      expect(isWsRoom({ name: 'general', clientIds: ['c1', 'c2'] })).toBe(true);
    });

    it('should return true when clientIds is empty array', () => {
      expect(isWsRoom({ name: 'empty-room', clientIds: [] })).toBe(true);
    });

    it('should return true with optional metadata', () => {
      expect(isWsRoom({ name: 'lobby', clientIds: [], metadata: { private: true } })).toBe(true);
    });

    it('should return false for null', () => {
      expect(isWsRoom(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isWsRoom(undefined)).toBe(false);
    });

    it('should return false when name is missing', () => {
      expect(isWsRoom({ clientIds: ['c1'] })).toBe(false);
    });

    it('should return false when name is not a string', () => {
      expect(isWsRoom({ name: 123, clientIds: [] })).toBe(false);
    });

    it('should return false when clientIds is missing', () => {
      expect(isWsRoom({ name: 'room' })).toBe(false);
    });

    it('should return false when clientIds is not an array', () => {
      expect(isWsRoom({ name: 'room', clientIds: 'c1' })).toBe(false);
    });

    it('should return false for empty object', () => {
      expect(isWsRoom({})).toBe(false);
    });
  });
});
