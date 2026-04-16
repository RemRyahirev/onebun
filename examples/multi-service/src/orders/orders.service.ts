import {
  Service,
  BaseService,
  createHttpClient,
  isErrorResponse,
} from '@onebun/core';
import { Span } from '@onebun/trace';

interface Order {
  id: string;
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
  total: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: string;
}

interface User {
  id: string;
  name: string;
  email: string;
}

@Service()
export class OrderService extends BaseService {
  private orders = new Map<string, Order>();
  private readonly usersClient;

  constructor() {
    super();
    this.usersClient = createHttpClient({
      baseUrl: this.config.get('usersServiceUrl'),
    });
  }

  @Span('order-find-all')
  async findAll(): Promise<Order[]> {
    return Array.from(this.orders.values());
  }

  @Span('order-find-by-user')
  async findByUserId(userId: string): Promise<Order[]> {
    return Array.from(this.orders.values()).filter(
      (order) => order.userId === userId,
    );
  }

  @Span('order-create')
  async create(data: {
    userId: string;
    items: Array<{ productId: string; quantity: number; price: number }>;
  }): Promise<Order> {
    // Verify user exists by calling Users service
    const userResponse = await this.usersClient.get<User>(`/users/${data.userId}`);

    if (isErrorResponse(userResponse)) {
      this.logger.warn('User not found', { userId: data.userId });
      throw new Error('User not found');
    }

    const user = userResponse.result;
    this.logger.info('User verified', { userId: user.id, name: user.name });

    // Calculate total
    const total = data.items.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0,
    );

    const order: Order = {
      id: crypto.randomUUID(),
      userId: data.userId,
      items: data.items.map(({ productId, quantity }) => ({ productId, quantity })),
      total,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.orders.set(order.id, order);
    this.logger.info('Order created', {
      orderId: order.id,
      userId: data.userId,
      total,
    });

    return order;
  }

  @Span('order-update-status')
  async updateStatus(
    orderId: string,
    status: 'pending' | 'completed' | 'cancelled',
  ): Promise<Order | null> {
    const order = this.orders.get(orderId);
    if (!order) {
      return null;
    }

    order.status = status;
    this.orders.set(orderId, order);

    this.logger.info('Order status updated', { orderId, status });

    return order;
  }
}
