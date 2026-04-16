#!/usr/bin/env bun
/* eslint-disable no-console */

const projectName = process.argv[2];

if (!projectName) {
  console.log('Usage: bun create @onebun <project-name>');
  console.log('');
  console.log('Example:');
  console.log('  bun create @onebun my-app');
  process.exit(1);
}

const projectDir = `${process.cwd()}/${projectName}`;

// Check if directory already exists
const exists = await Bun.file(projectDir).exists().catch(() => false);

if (exists) {
  console.error(`Error: Directory "${projectName}" already exists.`);
  process.exit(1);
}

console.log(`\nCreating a new OneBun project in ${projectDir}...\n`);

// --- Template files ---

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
    "@onebun/core": "^0.3.0"
  },
  "devDependencies": {
    "bun-types": "^1.3.8"
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

@Controller('/')
export class AppController extends BaseController {
  constructor(private appService: AppService) {
    super();
  }

  @Get('/')
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

// --- Write files ---

await Promise.all([
  Bun.write(`${projectDir}/package.json`, packageJson),
  Bun.write(`${projectDir}/tsconfig.json`, tsconfig),
  Bun.write(`${projectDir}/src/index.ts`, indexTs),
  Bun.write(`${projectDir}/src/config.ts`, configTs),
  Bun.write(`${projectDir}/src/app.module.ts`, appModuleTs),
  Bun.write(`${projectDir}/src/app.controller.ts`, appControllerTs),
  Bun.write(`${projectDir}/src/app.service.ts`, appServiceTs),
  Bun.write(`${projectDir}/.env.example`, envExample),
  Bun.write(`${projectDir}/docker-compose.yml`, dockerCompose),
]);

console.log('  Created package.json');
console.log('  Created tsconfig.json');
console.log('  Created src/index.ts');
console.log('  Created src/config.ts');
console.log('  Created src/app.module.ts');
console.log('  Created src/app.controller.ts');
console.log('  Created src/app.service.ts');
console.log('  Created .env.example');
console.log('  Created docker-compose.yml');

// --- Run bun install ---

console.log('\nInstalling dependencies...\n');

const install = Bun.spawn(['bun', 'install'], {
  cwd: projectDir,
  stdout: 'inherit',
  stderr: 'inherit',
});

const exitCode = await install.exited;

if (exitCode !== 0) {
  console.error('\nFailed to install dependencies. You can try running "bun install" manually.');
}

// --- Success message ---

console.log(`
Done! Your OneBun project is ready.

  cd ${projectName}
  bun run dev

Happy coding!
`);
