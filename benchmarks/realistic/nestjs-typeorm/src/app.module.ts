import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User, Post, Comment } from './entities';
import { PostsController } from './posts.controller';
import { UsersController } from './users.controller';
import { PostsService } from './posts.service';
import { UsersService } from './users.service';

const DB_PATH = process.env.BENCH_DB_PATH || './bench.db';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: DB_PATH,
      entities: [User, Post, Comment],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([User, Post, Comment]),
  ],
  controllers: [PostsController, UsersController],
  providers: [PostsService, UsersService],
})
export class AppModule {}
