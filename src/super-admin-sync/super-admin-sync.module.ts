import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions/permissions.module';
import { UserEntity } from '../users/entities/user.entity';
import { InternalHmacGuard } from './internal-hmac.guard';
import { SuperAdminSyncController } from './super-admin-sync.controller';
import { SuperAdminSyncService } from './super-admin-sync.service';

@Module({
  imports: [PermissionsModule, TypeOrmModule.forFeature([UserEntity])],
  controllers: [SuperAdminSyncController],
  providers: [InternalHmacGuard, SuperAdminSyncService],
})
export class SuperAdminSyncModule {}
