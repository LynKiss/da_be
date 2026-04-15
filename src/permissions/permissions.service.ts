import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RolePermissionEntity } from '../roles/entities/role-permission.entity';
import { UserRole } from '../users/entities/user.entity';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { PermissionEntity } from './entities/permission.entity';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(PermissionEntity)
    private readonly permissionsRepository: Repository<PermissionEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionsRepository: Repository<RolePermissionEntity>,
  ) {}

  async findAll() {
    const permissions = await this.permissionsRepository.find({
      order: { permissionId: 'ASC' },
    });

    return permissions.map((permission) => this.mapPermission(permission));
  }

  async findPermissionsByRole(role: string) {
    const normalizedRole = this.parseRole(role);
    const rolePermissions = await this.rolePermissionsRepository.find({
      where: { role: normalizedRole },
      order: { permissionId: 'ASC' },
    });

    return {
      role: normalizedRole,
      permissions: rolePermissions.map(({ permission }) =>
        this.mapPermission(permission),
      ),
    };
  }

  async updateRolePermissions(
    role: string,
    updateRolePermissionsDto: UpdateRolePermissionsDto,
  ) {
    const normalizedRole = this.parseRole(role);
    const uniquePermissionIds = [
      ...new Set(updateRolePermissionsDto.permissionIds),
    ];

    const permissions = await this.permissionsRepository.find({
      where: {
        permissionId: In(uniquePermissionIds),
      },
      order: { permissionId: 'ASC' },
    });

    if (permissions.length !== uniquePermissionIds.length) {
      throw new NotFoundException('One or more permissions were not found');
    }

    await this.rolePermissionsRepository.delete({ role: normalizedRole });

    const rolePermissions = permissions.map((permission) =>
      this.rolePermissionsRepository.create({
        role: normalizedRole,
        permissionId: permission.permissionId,
      }),
    );

    await this.rolePermissionsRepository.save(rolePermissions);

    return this.findPermissionsByRole(normalizedRole);
  }

  private parseRole(role: string) {
    const normalizedRole = role.toLowerCase() as UserRole;
    const supportedRoles = Object.values(UserRole);

    if (!supportedRoles.includes(normalizedRole)) {
      throw new BadRequestException('Role is invalid');
    }

    return normalizedRole;
  }

  private mapPermission(permission: PermissionEntity) {
    return {
      _id: permission.permissionId.toString(),
      key: permission.permissionKey,
      name: permission.permissionName,
    };
  }
}
