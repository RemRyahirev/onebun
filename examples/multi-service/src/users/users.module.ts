import { Module } from '@onebun/core';

import { UserController } from './users.controller';
import { UserService } from './users.service';

@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
