import { Module } from '@onebun/core';

import { UserModule } from './users/users.module';

@Module({
  imports: [UserModule],
})
export class AppModule {}
