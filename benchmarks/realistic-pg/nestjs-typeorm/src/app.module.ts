import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User, Post, Comment } from './entities';
import { PostsController } from './posts.controller';
import { UsersController } from './users.controller';
import { PostsService } from './posts.service';
import { UsersService } from './users.service';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://bench:bench@localhost:5432/bench';

@Module({
  imports: [
    CacheModule.register({
      ttl: 30,
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: DATABASE_URL,
      entities: [User, Post, Comment],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([User, Post, Comment]),
  ],
  controllers: [PostsController, UsersController],
  providers: [PostsService, UsersService],
})
export class AppModule {}
