import type { WsClientData } from '@onebun/core';
import {
  WebSocketGateway,
  BaseWebSocketGateway,
  OnConnect,
  OnDisconnect,
  OnJoinRoom,
  OnLeaveRoom,
  OnMessage,
  Client,
  MessageData,
  RoomName,
  PatternParams,
  UseWsGuards,
} from '@onebun/core';

import { ChatAuthGuard } from './auth.guard';
import { ChatService } from './chat.service';

interface ChatMessage {
  text: string;
}

@WebSocketGateway({ path: '/chat' })
export class ChatGateway extends BaseWebSocketGateway {
  constructor(private chatService: ChatService) {
    super();
  }

  @OnConnect()
  async handleConnect(@Client() client: WsClientData) {
    this.logger.info(`Client ${client.id} connected`);

    // Send welcome message
    return {
      event: 'welcome',
      data: {
        message: 'Welcome to the chat!',
        clientId: client.id,
        timestamp: Date.now(),
      },
    };
  }

  @OnDisconnect()
  async handleDisconnect(@Client() client: WsClientData) {
    this.logger.info(`Client ${client.id} disconnected`);

    // Notify all rooms the client was in
    for (const room of client.rooms) {
      this.emitToRoom(room, 'user:left', {
        userId: client.id,
        room,
      });
    }
  }

  @OnJoinRoom('room:{roomId}')
  async handleJoinRoom(
    @Client() client: WsClientData,
    @RoomName() room: string,
    @PatternParams() params: { roomId: string },
  ) {
    this.logger.info(`Client ${client.id} joining room ${params.roomId}`);

    // Add to room
    await this.joinRoom(client.id, room);

    // Notify others in the room
    this.emitToRoom(room, 'user:joined', {
      userId: client.id,
      room,
    }, [client.id]); // Exclude the joining user

    // Get message history
    const history = await this.chatService.getMessageHistory(params.roomId);

    return {
      event: 'room:joined',
      data: {
        room: params.roomId,
        history,
        users: await this.getClientsInRoom(room),
      },
    };
  }

  @OnLeaveRoom('room:{roomId}')
  async handleLeaveRoom(
    @Client() client: WsClientData,
    @RoomName() room: string,
    @PatternParams() params: { roomId: string },
  ) {
    // Remove from room
    await this.leaveRoom(client.id, room);

    // Notify others
    this.emitToRoom(room, 'user:left', {
      userId: client.id,
      room,
    });
  }

  @UseWsGuards(ChatAuthGuard)
  @OnMessage('chat:{roomId}:message')
  async handleMessage(
    @Client() client: WsClientData,
    @MessageData() data: ChatMessage,
    @PatternParams() params: { roomId: string },
  ) {
    // Validate client is in the room
    if (!client.rooms.includes(`room:${params.roomId}`)) {
      return {
        event: 'error',
        data: { message: 'Not in room' },
      };
    }

    // Save message
    const message = await this.chatService.saveMessage({
      roomId: params.roomId,
      userId: client.id,
      text: data.text,
      timestamp: Date.now(),
    });

    // Broadcast to room
    this.emitToRoom(`room:${params.roomId}`, 'chat:message', message);

    // Acknowledge sender
    return {
      event: 'chat:message:ack',
      data: { messageId: message.id },
    };
  }

  @OnMessage('typing:{roomId}')
  handleTyping(
    @Client() client: WsClientData,
    @PatternParams() params: { roomId: string },
  ) {
    // Broadcast typing indicator (except to sender)
    this.emitToRoom(
      `room:${params.roomId}`,
      'typing',
      { userId: client.id },
      [client.id],
    );
  }

  // Helper method to get clients in a room
  private async getClientsInRoom(roomName: string): Promise<string[]> {
    const clients = await super.getClientsByRoom(roomName);

    return clients.map(c => c.id);
  }
}
