import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RolePermissionEntity } from '../roles/entities/role-permission.entity';
import { UserRole } from '../users/entities/user.entity';
import { PermissionEntity } from './entities/permission.entity';
import { UserPermissionOverrideEntity } from './entities/user-permission-override.entity';

export type ApplyUserPermissionsInput = {
  userId: string;
  permissionKeys: string[];
  sourceProjectId?: string | null;
  syncedBy?: string | null;
};

@Injectable()
export class EffectivePermissionsService {
  constructor(
    @InjectRepository(PermissionEntity)
    private readonly permissionsRepository: Repository<PermissionEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionsRepository: Repository<RolePermissionEntity>,
    @InjectRepository(UserPermissionOverrideEntity)
    private readonly userPermissionOverridesRepository: Repository<UserPermissionOverrideEntity>,
  ) {}

  async getEffectivePermissions(userId: string, role: UserRole) {
    const overrides = await this.userPermissionOverridesRepository.find({
      where: { userId },
      order: { permissionId: 'ASC' },
    });

    if (overrides.length > 0) {
      return overrides
        .map((override) => override.permission)
        .filter((permission): permission is PermissionEntity => Boolean(permission))
        .map((permission) => this.mapPermission(permission));
    }

    const rolePermissions = await this.rolePermissionsRepository.find({
      where: { role },
      order: { permissionId: 'ASC' },
    });

    return rolePermissions.map(({ permission }) => this.mapPermission(permission));
  }

  async applyUserPermissions(input: ApplyUserPermissionsInput) {
    const uniquePermissionKeys = [...new Set(input.permissionKeys.map((key) => key.trim()).filter(Boolean))];
    const permissions = uniquePermissionKeys.length
      ? await this.permissionsRepository.find({
          where: { permissionKey: In(uniquePermissionKeys) },
          order: { permissionId: 'ASC' },
        })
      : [];

    if (permissions.length !== uniquePermissionKeys.length) {
      const found = new Set(permissions.map((permission) => permission.permissionKey));
      const missing = uniquePermissionKeys.filter((key) => !found.has(key));
      throw new NotFoundException(`Permissions not found: ${missing.join(', ')}`);
    }

    await this.userPermissionOverridesRepository.delete({ userId: input.userId });

    const rows =
      permissions.length > 0
        ? permissions.map((permission) =>
            this.userPermissionOverridesRepository.create({
              userId: input.userId,
              permissionId: permission.permissionId,
              sourceProjectId: input.sourceProjectId ?? null,
              syncedBy: input.syncedBy ?? null,
            }),
          )
        : [
            this.userPermissionOverridesRepository.create({
              userId: input.userId,
              permissionId: null,
              sourceProjectId: input.sourceProjectId ?? null,
              syncedBy: input.syncedBy ?? null,
            }),
          ];

    await this.userPermissionOverridesRepository.save(rows);

    return {
      userId: input.userId,
      permissions: permissions.map((permission) => this.mapPermission(permission)),
      overrideActive: true,
    };
  }

  async clearUserPermissions(userId: string) {
    await this.userPermissionOverridesRepository.delete({ userId });
    return { userId, overrideActive: false };
  }

  private mapPermission(permission: PermissionEntity) {
    return {
      _id: permission.permissionId.toString(),
      key: permission.permissionKey,
      name: permission.permissionName,
    };
  }
}
