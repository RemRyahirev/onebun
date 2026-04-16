import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { TestingModule, type CompiledTestingModule } from '@onebun/core/testing';

import { OrderController } from './orders.controller';
import { OrderService } from './orders.service';

/**
 * OrderService depends on createHttpClient to call the Users service.
 * We mock the OrderService to isolate the controller tests.
 */
function createMockOrderService() {
  const orders = new Map<string, {
    id: string;
    userId: string;
    items: Array<{ productId: string; quantity: number }>;
    total: number;
    status: string;
    createdAt: string;
  }>();

  return {
    findAll: async () => Array.from(orders.values()),
    findByUserId: async (userId: string) =>
      Array.from(orders.values()).filter(o => o.userId === userId),
    create: async (data: {
      userId: string;
      items: Array<{ productId: string; quantity: number; price: number }>;
    }) => {
      const total = data.items.reduce(
        (sum, item) => sum + item.quantity * item.price,
        0,
      );
      const order = {
        id: crypto.randomUUID(),
        userId: data.userId,
        items: data.items.map(({ productId, quantity }) => ({ productId, quantity })),
        total,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };
      orders.set(order.id, order);

      return order;
    },
    updateStatus: async (orderId: string, status: string) => {
      const order = orders.get(orderId);
      if (!order) {
        return null;
      }
      order.status = status;

      return order;
    },
  };
}

describe('Multi-Service — Orders API', () => {
  let app: CompiledTestingModule;
  let mockOrderService: ReturnType<typeof createMockOrderService>;

  beforeEach(async () => {
    mockOrderService = createMockOrderService();

    app = await TestingModule
      .create({
        controllers: [OrderController],
        providers: [OrderService],
      })
      .overrideProvider(OrderService).useValue(mockOrderService)
      .compile();
  });

  afterEach(async () => {
    await app.close();
  });

  // =========================================================================
  // GET /orders — List
  // =========================================================================

  describe('GET /orders', () => {
    test('returns empty list initially', async () => {
      const res = await app.inject('GET', '/orders');

      expect(res.status).toBe(200);
      const json = await res.json() as { result: unknown[] };
      expect(json.result).toEqual([]);
    });

    test('returns created orders', async () => {
      await app.inject('POST', '/orders', {
        body: {
          userId: 'user-1',
          items: [{ productId: 'prod-1', quantity: 2, price: 10 }],
        },
      });

      const res = await app.inject('GET', '/orders');
      const json = await res.json() as { result: unknown[] };

      expect(json.result).toHaveLength(1);
    });

    test('filters by userId query param', async () => {
      await app.inject('POST', '/orders', {
        body: {
          userId: 'user-1',
          items: [{ productId: 'prod-1', quantity: 1, price: 10 }],
        },
      });
      await app.inject('POST', '/orders', {
        body: {
          userId: 'user-2',
          items: [{ productId: 'prod-2', quantity: 1, price: 20 }],
        },
      });

      const res = await app.inject('GET', '/orders', {
        query: { userId: 'user-1' },
      });
      const json = await res.json() as {
        result: Array<{ userId: string }>;
      };

      expect(json.result).toHaveLength(1);
      expect(json.result[0].userId).toBe('user-1');
    });
  });

  // =========================================================================
  // POST /orders — Create
  // =========================================================================

  describe('POST /orders', () => {
    test('creates an order', async () => {
      const res = await app.inject('POST', '/orders', {
        body: {
          userId: 'user-1',
          items: [
            { productId: 'prod-1', quantity: 2, price: 15 },
            { productId: 'prod-2', quantity: 1, price: 30 },
          ],
        },
      });

      expect(res.status).toBe(201);
      const json = await res.json() as {
        success: boolean;
        result: {
          id: string;
          userId: string;
          total: number;
          status: string;
        };
      };
      expect(json.success).toBe(true);
      expect(json.result.userId).toBe('user-1');
      expect(json.result.total).toBe(60);
      expect(json.result.status).toBe('pending');
    });

    test('returns 400 for missing items', async () => {
      const res = await app.inject('POST', '/orders', {
        body: { userId: 'user-1' },
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 for invalid item data', async () => {
      const res = await app.inject('POST', '/orders', {
        body: { userId: 'user-1', items: [{ productId: 123 }] },
      });

      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // PUT /orders/:id/status — Update status
  // =========================================================================

  describe('PUT /orders/:id/status', () => {
    test('updates order status', async () => {
      const createRes = await app.inject('POST', '/orders', {
        body: {
          userId: 'user-1',
          items: [{ productId: 'prod-1', quantity: 1, price: 10 }],
        },
      });
      const { result: created } = await createRes.json() as {
        result: { id: string };
      };

      const res = await app.inject('PUT', `/orders/${created.id}/status`, {
        body: { status: 'completed' },
      });

      expect(res.status).toBe(200);
      const json = await res.json() as {
        result: { status: string };
      };
      expect(json.result.status).toBe('completed');
    });

    test('returns 404 for non-existent order', async () => {
      const res = await app.inject('PUT', '/orders/non-existent/status', {
        body: { status: 'completed' },
      });

      expect(res.status).toBe(404);
    });

    test('returns 400 for invalid status', async () => {
      const res = await app.inject('PUT', '/orders/some-id/status', {
        body: { status: 'invalid-status' },
      });

      expect(res.status).toBe(400);
    });
  });
});
