import { Module } from '@nestjs/common';

import { PostsController } from './posts.controller';
import { UsersController } from './users.controller';
import { PostsService } from './posts.service';
import { UsersService } from './users.service';
import { SimpleCacheService } from './cache.service';

@Module({
  controllers: [PostsController, UsersController],
  providers: [
    PostsService,
    UsersService,
    SimpleCacheService,
    {
      provide: 'DRIZZLE_DB',
      useFactory: () => {
        if ('Bun' in globalThis) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return require('./db-bun').db;
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('./db').db;
      },
    },
  ],
})
export class AppModule {}
