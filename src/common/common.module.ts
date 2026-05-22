import { Global, Module } from '@nestjs/common';
import { SimpleCacheService } from './simple-cache.service';
import { UploadsController } from './uploads.controller';

/**
 * @Global() để service có sẵn ở mọi module mà không cần import lại.
 */
@Global()
@Module({
  controllers: [UploadsController],
  providers: [SimpleCacheService],
  exports: [SimpleCacheService],
})
export class CommonModule {}
