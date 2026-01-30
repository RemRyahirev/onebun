# @onebun/trace

OpenTelemetry-compatible tracing module for the OneBun framework.

## Features

- 🔍 Automatic HTTP request tracing
- 📊 W3C Trace Context support (traceparent, tracestate)
- 🎯 Effect.js integration
- 🏷️ Method tracing decorators
- 📝 Automatic trace information in logs
- 🔗 Custom span creation
- 🚀 OpenTelemetry-compatible API

## Installation

```bash
bun add @onebun/trace
```

## Usage

### Basic setup

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    serviceVersion: '1.0.0',
    samplingRate: 1.0, // 100% sampling
    traceHttpRequests: true,
    traceDatabaseQueries: true,
    defaultAttributes: {
      'service.name': 'my-service',
      'service.version': '1.0.0',
      'deployment.environment': 'production'
    }
  }
});
```

### Configuration options

```typescript
interface TraceOptions {
  enabled?: boolean;              // Enable/disable tracing (default: true)
  serviceName?: string;           // Service name (default: 'onebun-service')
  serviceVersion?: string;        // Service version (default: '1.0.0')
  samplingRate?: number;          // Sampling rate 0.0-1.0 (default: 1.0)
  traceHttpRequests?: boolean;    // Automatic HTTP tracing (default: true)
  traceDatabaseQueries?: boolean; // Automatic DB tracing (default: true)
  defaultAttributes?: Record<string, string | number | boolean>;
  exportOptions?: TraceExportOptions;
}
```

### Decorators

#### @Trace

Used for tracing controller methods:

```typescript
import { Controller, Get, Post } from '@onebun/core';
import { Trace } from '@onebun/trace';

@Controller('/api')
export class UserController {
  @Get('/users')
  @Trace('get-all-users')
  async getUsers() {
    // Automatically creates a span named 'get-all-users'
    return this.userService.findAll();
  }

  @Post('/users')
  @Trace() // Uses method name as span name
  async createUser(@Body() userData: CreateUserDto) {
    return this.userService.create(userData);
  }
}
```

#### @Span

Used for creating custom spans in services:

```typescript
import { Service } from '@onebun/core';
import { Span } from '@onebun/trace';

@Service()
export class UserService {
  @Span('database-query')
  async findAll() {
    // Creates a span for tracking database query
    return await this.database.query('SELECT * FROM users');
  }

  @Span() // Uses 'UserService.validateUser' as name
  async validateUser(id: string) {
    // Span for validation
    return await this.validateUserLogic(id);
  }
}
```

### Manual trace management

```typescript
import { TraceService } from '@onebun/trace';
import { Effect } from 'effect';

export class CustomService {
  constructor(private traceService: TraceService) {}

  async complexOperation() {
    return Effect.runPromise(
      Effect.flatMap(
        this.traceService.startSpan('complex-operation'),
        (span) => Effect.flatMap(
          this.traceService.setAttributes({
            'operation.type': 'data-processing',
            'operation.complexity': 'high'
          }),
          () => Effect.flatMap(
            this.performOperation(),
            (result) => Effect.flatMap(
              this.traceService.addEvent('operation-completed', {
                'result.size': result.length,
                'result.status': 'success'
              }),
              () => Effect.flatMap(
                this.traceService.endSpan(span),
                () => Effect.succeed(result)
              )
            )
          )
        )
      )
    );
  }
}
```

### Extracting and injecting trace context

```typescript
// Extract from HTTP headers
const traceContext = await Effect.runPromise(
  traceService.extractFromHeaders({
    'traceparent': '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    'tracestate': 'rojo=00f067aa0ba902b7,congo=t61rcWkgMzE'
  })
);

// Inject into HTTP headers
const headers = await Effect.runPromise(
  traceService.injectIntoHeaders(traceContext)
);

// headers = {
//   'traceparent': '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
//   'x-trace-id': '4bf92f3577b34da6a3ce929d0e0e4736',
//   'x-span-id': '00f067aa0ba902b7'
// }
```

### Log integration

Traces are automatically added to logs:

```typescript
// In controller
@Get('/users/:id')
@Trace('get-user-by-id')
async getUser(@Param('id') id: string) {
  this.logger.info('Fetching user', { userId: id });
  // Log automatically includes trace information:
  // {
  //   "timestamp": "2024-01-15T10:30:00.000Z",
  //   "level": "info",
  //   "message": "Fetching user",
  //   "trace": {
  //     "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  //     "spanId": "00f067aa0ba902b7"
  //   },
  //   "context": { "userId": "123" }
  // }
  
  return this.userService.findById(id);
}
```

### Log formats

#### Pretty format (development)
```
2024-01-15T10:30:00.000Z [INFO   ] [trace:34da6a3c span:902b7f00] Fetching user
```

#### JSON format (production)
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info", 
  "message": "Fetching user",
  "trace": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7",
    "parentSpanId": "a3ce929d0e0e4736"
  },
  "context": { "userId": "123" }
}
```

### Automatic HTTP tracing

All HTTP requests are automatically traced with attributes:

- `http.method` - HTTP method
- `http.url` - Request URL  
- `http.route` - Route (pattern)
- `http.status_code` - Response status code
- `http.duration` - Duration in milliseconds
- `http.user_agent` - Client User-Agent
- `http.remote_addr` - Client IP address

### Effect.js integration

The module is fully integrated with Effect.js:

```typescript
import { Effect } from 'effect';
import { TraceService } from '@onebun/trace';

const tracedOperation = Effect.flatMap(
  TraceService,
  (traceService) => Effect.flatMap(
    traceService.startSpan('my-operation'),
    (span) => Effect.flatMap(
      performSomeWork(),
      (result) => Effect.flatMap(
        traceService.endSpan(span),
        () => Effect.succeed(result)
      )
    )
  )
);
```

## OpenTelemetry compatibility

The module uses OpenTelemetry API and supports:

- W3C Trace Context propagation
- Standard span attributes
- Span events and statuses
- Export to external systems (when configured)

## License

[LGPL-3.0](../../LICENSE) 