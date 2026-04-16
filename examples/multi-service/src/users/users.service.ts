import { Service, BaseService } from '@onebun/core';
import { Span } from '@onebun/trace';

interface User {
  id: string;
  name: string;
  email: string;
}

@Service()
export class UserService extends BaseService {
  private users = new Map<string, User>();

  constructor() {
    super();
    // Seed some data
    this.users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com' });
    this.users.set('2', { id: '2', name: 'Bob', email: 'bob@example.com' });
  }

  @Span('user-find-all')
  async findAll(): Promise<User[]> {
    this.logger.info('Finding all users');

    return Array.from(this.users.values());
  }

  @Span('user-find-by-id')
  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  @Span('user-create')
  async create(data: Omit<User, 'id'>): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      ...data,
    };
    this.users.set(user.id, user);
    this.logger.info('User created', { userId: user.id });

    return user;
  }
}
