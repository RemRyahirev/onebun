import { Module, getConfig } from '@onebun/core';
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
        type: DatabaseType.SQLITE,
        options: { url: config.get('bench.dbPath') },
      },
      autoMigrate: false,
    }),
  ],
  controllers: [PostsController, UsersController],
  providers: [PostsService, UsersService],
})
export class BenchModule {}
