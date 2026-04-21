import {
  BaseController,
  Controller,
  Get,
  Module,
  OneBunApplication,
} from '@onebun/core';

interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

interface OrderItem {
  id: number;
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  status: string;
  items: OrderItem[];
  total: number;
  createdAt: string;
}

interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: string;
  address: Address;
  preferences: {
    theme: string;
    language: string;
    notifications: boolean;
    timezone: string;
  };
  recentOrders: Order[];
  metadata: {
    lastLogin: string;
    accountCreated: string;
    loginCount: number;
    verified: boolean;
  };
}

const PAYLOAD: UserProfile = {
  id: 42,
  name: 'Jane Doe',
  email: 'jane.doe@example.com',
  role: 'admin',
  address: {
    street: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    country: 'US',
  },
  preferences: {
    theme: 'dark',
    language: 'en',
    notifications: true,
    timezone: 'America/Chicago',
  },
  recentOrders: [
    {
      id: 'ord-001',
      status: 'delivered',
      items: [
        { id: 1, name: 'Widget Pro', quantity: 2, price: 29.99 },
        { id: 2, name: 'Gadget Mini', quantity: 1, price: 49.99 },
      ],
      total: 109.97,
      createdAt: '2026-04-01T10:30:00Z',
    },
    {
      id: 'ord-002',
      status: 'processing',
      items: [
        { id: 3, name: 'Connector Cable', quantity: 5, price: 9.99 },
        { id: 4, name: 'Power Adapter', quantity: 1, price: 24.99 },
      ],
      total: 74.94,
      createdAt: '2026-04-10T14:15:00Z',
    },
  ],
  metadata: {
    lastLogin: '2026-04-13T08:00:00Z',
    accountCreated: '2024-01-15T12:00:00Z',
    loginCount: 847,
    verified: true,
  },
};

@Controller()
class JsonBenchController extends BaseController {
  @Get('json')
  getJson(): UserProfile {
    return PAYLOAD;
  }
}

@Module({
  controllers: [JsonBenchController],
})
class JsonBenchModule {}

const BENCH_PORT = 3101;

const app = new OneBunApplication(JsonBenchModule, {
  port: BENCH_PORT,
  host: '0.0.0.0',
  metrics: { enabled: false },
  tracing: { enabled: false },
});

app.start().catch((error: unknown) => {
  throw error instanceof Error ? error : new Error(String(error));
});
