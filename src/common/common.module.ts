import { Global, Module } from '@nestjs/common';
import { SimpleCacheService } from './simple-cache.service';

/**
 * @Global() để service có sẵn ở mọi module mà không cần import lại.
 */
@Global()
@Module({
  providers: [SimpleCacheService],
  exports: [SimpleCacheService],
})
export class CommonModule {}
