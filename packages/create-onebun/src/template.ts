/**
 * The project `bun create @onebun <name>` writes. It lives apart from the CLI in `index.ts`, which
 * only writes these files and installs, so that `template.test.ts` and
 * `scripts/consumer-typecheck.ts` can read the template without scaffolding anything.
 */

/**
 * The `@onebun/core` range a new project depends on. A caret on 0.x pins the minor, so this has to
 * name the current core minor: `template.test.ts` fails as soon as it no longer covers
 * `packages/core/package.json`'s version, which every minor release does.
 */
const CORE_RANGE = '^0.8.2';

/**
 * A fresh project has no lockfile, so this installs the newest bun-types 1.x;
 * `scripts/consumer-typecheck.ts` compiles the template against every pinned bun-types it covers.
 */
const BUN_TYPES_RANGE = '^1.3.8';

/**
 * Every file of a new project, by its path relative to the project directory, in the order the CLI
 * reports writing them.
 */
export function scaffoldFiles(projectName: string): Record<string, string> {
  const packageJson = `{
  "name": "${projectName}",
  "version": "0.1.0",
  "description": "A new OneBun application",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts"
  },
  "dependencies": {
    "@onebun/core": "${CORE_RANGE}"
  },
  "devDependencies": {
    "bun-types": "${BUN_TYPES_RANGE}"
  }
}
`;

  const tsconfig = `{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "noEmit": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "types": ["bun-types"],
    "lib": ["ESNext"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
`;

  const configTs = `import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({ default: 3000, env: 'PORT' }),
    host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
  },
};

export type AppConfig = InferConfigType<typeof envSchema>;

declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}
`;

  const indexTs = `import { OneBunApplication } from '@onebun/core';

import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  envSchema,
  development: true,
});

app
  .start()
  .then(() => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.info('Application started successfully');
  })
  .catch((error: unknown) => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.error(
      'Failed to start application:',
      error instanceof Error ? error : new Error(String(error)),
    );
    // A failed start() has already released everything, so without this the process exits 0
    process.exit(1);
  });
`;

  const appModuleTs = `import { Module } from '@onebun/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`;

  const appControllerTs = `import {
  BaseController,
  Controller,
  Get,
} from '@onebun/core';

import { AppService } from './app.service';

@Controller()
export class AppController extends BaseController {
  constructor(private appService: AppService) {
    super();
  }

  @Get()
  async getHello() {
    return { message: this.appService.getHello() };
  }
}
`;

  const appServiceTs = `import {
  BaseService,
  Service,
} from '@onebun/core';

@Service()
export class AppService extends BaseService {
  getHello(): string {
    this.logger.info('Hello endpoint called');

    return 'Hello from OneBun!';
  }
}
`;

  const envExample = `PORT=3000
`;

  const dockerCompose = `services:
  postgres:
    image: postgres:17-alpine
    ports:
      - '5432:5432'
    environment:
      POSTGRES_USER: onebun
      POSTGRES_PASSWORD: onebun
      POSTGRES_DB: ${projectName}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    command: redis-server --requirepass onebun
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
`;

  /* eslint-disable @typescript-eslint/naming-convention -- the keys are file paths */
  return {
    'package.json': packageJson,
    'tsconfig.json': tsconfig,
    'src/index.ts': indexTs,
    'src/config.ts': configTs,
    'src/app.module.ts': appModuleTs,
    'src/app.controller.ts': appControllerTs,
    'src/app.service.ts': appServiceTs,
    '.env.example': envExample,
    'docker-compose.yml': dockerCompose,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}
