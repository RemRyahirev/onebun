import { Service, BaseService } from '@onebun/core';

interface Message {
  id: string;
  roomId: string;
  userId: string;
  text: string;
  timestamp: number;
}

@Service()
export class ChatService extends BaseService {
  private messages: Map<string, Message[]> = new Map();
  private messageIdCounter = 0;

  async saveMessage(data: Omit<Message, 'id'>): Promise<Message> {
    const message: Message = {
      id: `msg_${++this.messageIdCounter}`,
      ...data,
    };

    const roomMessages = this.messages.get(data.roomId) || [];
    roomMessages.push(message);
    this.messages.set(data.roomId, roomMessages);

    return message;
  }

  async getMessageHistory(roomId: string, limit = 50): Promise<Message[]> {
    const roomMessages = this.messages.get(roomId) || [];

    return roomMessages.slice(-limit);
  }

  async clearRoom(roomId: string): Promise<void> {
    this.messages.delete(roomId);
  }
}
