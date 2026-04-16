import { Module } from '@onebun/core';

import { UserController } from './users.controller';
import { UserRepository } from './users.repository';
import { UserService } from './users.service';

@Module({
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService],
})
export class UserModule {}
