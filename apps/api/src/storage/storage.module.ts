import { Global, Module } from '@nestjs/common';

import { StorageService } from './storage.service';

/** Global like PrismaModule: storage is infrastructure, not a feature. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
