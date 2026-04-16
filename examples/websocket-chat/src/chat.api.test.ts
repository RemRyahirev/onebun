import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { createTestService } from '@onebun/core/testing';

import { ChatService } from './chat.service';

describe('WebSocket Chat — ChatService', () => {
  let chatService: ChatService;

  beforeEach(() => {
    const { instance } = createTestService(ChatService);
    chatService = instance;
  });

  // =========================================================================
  // saveMessage
  // =========================================================================

  describe('saveMessage', () => {
    test('saves a message and returns it with id', async () => {
      const msg = await chatService.saveMessage({
        roomId: 'general',
        userId: 'user-1',
        text: 'Hello!',
        timestamp: Date.now(),
      });

      expect(msg.id).toBe('msg_1');
      expect(msg.roomId).toBe('general');
      expect(msg.userId).toBe('user-1');
      expect(msg.text).toBe('Hello!');
    });

    test('increments message id counter', async () => {
      const msg1 = await chatService.saveMessage({
        roomId: 'room1',
        userId: 'user-1',
        text: 'First',
        timestamp: Date.now(),
      });
      const msg2 = await chatService.saveMessage({
        roomId: 'room1',
        userId: 'user-2',
        text: 'Second',
        timestamp: Date.now(),
      });

      expect(msg1.id).toBe('msg_1');
      expect(msg2.id).toBe('msg_2');
    });

    test('stores messages per room', async () => {
      await chatService.saveMessage({
        roomId: 'room-a',
        userId: 'user-1',
        text: 'In room A',
        timestamp: Date.now(),
      });
      await chatService.saveMessage({
        roomId: 'room-b',
        userId: 'user-1',
        text: 'In room B',
        timestamp: Date.now(),
      });

      const roomA = await chatService.getMessageHistory('room-a');
      const roomB = await chatService.getMessageHistory('room-b');

      expect(roomA).toHaveLength(1);
      expect(roomB).toHaveLength(1);
      expect(roomA[0].text).toBe('In room A');
      expect(roomB[0].text).toBe('In room B');
    });
  });

  // =========================================================================
  // getMessageHistory
  // =========================================================================

  describe('getMessageHistory', () => {
    test('returns empty array for room with no messages', async () => {
      const history = await chatService.getMessageHistory('empty-room');

      expect(history).toEqual([]);
    });

    test('returns messages in order', async () => {
      await chatService.saveMessage({
        roomId: 'room1',
        userId: 'user-1',
        text: 'First',
        timestamp: 1000,
      });
      await chatService.saveMessage({
        roomId: 'room1',
        userId: 'user-2',
        text: 'Second',
        timestamp: 2000,
      });

      const history = await chatService.getMessageHistory('room1');

      expect(history).toHaveLength(2);
      expect(history[0].text).toBe('First');
      expect(history[1].text).toBe('Second');
    });

    test('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await chatService.saveMessage({
          roomId: 'room1',
          userId: 'user-1',
          text: `Message ${i}`,
          timestamp: i * 1000,
        });
      }

      const history = await chatService.getMessageHistory('room1', 3);

      expect(history).toHaveLength(3);
      // Should return the last 3 messages
      expect(history[0].text).toBe('Message 2');
      expect(history[2].text).toBe('Message 4');
    });

    test('uses default limit of 50', async () => {
      for (let i = 0; i < 60; i++) {
        await chatService.saveMessage({
          roomId: 'room1',
          userId: 'user-1',
          text: `Message ${i}`,
          timestamp: i,
        });
      }

      const history = await chatService.getMessageHistory('room1');

      expect(history).toHaveLength(50);
      expect(history[0].text).toBe('Message 10');
    });
  });

  // =========================================================================
  // clearRoom
  // =========================================================================

  describe('clearRoom', () => {
    test('removes all messages from a room', async () => {
      await chatService.saveMessage({
        roomId: 'room1',
        userId: 'user-1',
        text: 'Hello',
        timestamp: Date.now(),
      });
      await chatService.saveMessage({
        roomId: 'room1',
        userId: 'user-2',
        text: 'World',
        timestamp: Date.now(),
      });

      await chatService.clearRoom('room1');

      const history = await chatService.getMessageHistory('room1');
      expect(history).toEqual([]);
    });

    test('does not affect other rooms', async () => {
      await chatService.saveMessage({
        roomId: 'room-a',
        userId: 'user-1',
        text: 'In A',
        timestamp: Date.now(),
      });
      await chatService.saveMessage({
        roomId: 'room-b',
        userId: 'user-1',
        text: 'In B',
        timestamp: Date.now(),
      });

      await chatService.clearRoom('room-a');

      const roomA = await chatService.getMessageHistory('room-a');
      const roomB = await chatService.getMessageHistory('room-b');

      expect(roomA).toEqual([]);
      expect(roomB).toHaveLength(1);
    });

    test('is safe to call on non-existent room', async () => {
      await chatService.clearRoom('does-not-exist');
      // Should not throw
    });
  });
});
