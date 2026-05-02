import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePermissionEntity } from '../roles/entities/role-permission.entity';
import { PermissionsController } from './permissions.controller';
import { EffectivePermissionsService } from './effective-permissions.service';
import { PermissionEntity } from './entities/permission.entity';
import { UserPermissionOverrideEntity } from './entities/user-permission-override.entity';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PermissionEntity,
      RolePermissionEntity,
      UserPermissionOverrideEntity,
    ]),
  ],
  controllers: [PermissionsController],
  providers: [PermissionsService, EffectivePermissionsService],
  exports: [PermissionsService, EffectivePermissionsService, TypeOrmModule],
})
export class PermissionsModule {}
