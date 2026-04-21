import { Module, getConfig } from '@onebun/core';
import { CacheModule } from '@onebun/cache';
import { DatabaseType, DrizzleModule } from '@onebun/drizzle';

import { envSchema, type AppConfig } from './config';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const config = getConfig<AppConfig>(envSchema);

@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.POSTGRESQL,
        options: {
          host: config.get('db.host'),
          port: config.get('db.port'),
          user: config.get('db.user'),
          password: config.get('db.password'),
          database: config.get('db.database'),
        },
      },
      autoMigrate: false,
    }),
    CacheModule.forRoot({
      cacheOptions: { defaultTtl: config.get('cache.ttl') },
    }),
  ],
  controllers: [PostsController, UsersController],
  providers: [PostsService, UsersService],
})
export class BenchModule {}
