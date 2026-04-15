import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionEntity } from '../permissions/entities/permission.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PermissionEntity, RolePermissionEntity])],
  providers: [RolesService],
  exports: [RolesService, TypeOrmModule],
  controllers: [RolesController],
})
export class RolesModule {}
