import { Module } from '@onebun/core';

import { AppModule as CoreAppModule } from './apps/core/app.module';

@Module({
  imports: [CoreAppModule],
})
export class AppModule {}