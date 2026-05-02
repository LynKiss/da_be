import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { PermissionsService } from '../permissions/permissions.service';
import { UserEntity, UserRole } from '../users/entities/user.entity';

@Injectable()
export class SuperAdminSyncService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly permissionsService: PermissionsService,
    private readonly effectivePermissionsService: EffectivePermissionsService,
  ) {}

  listPermissions() {
    return this.permissionsService.findAll();
  }

  async listAdmins() {
    const users = await this.usersRepository.find({
      where: { role: In([UserRole.ADMIN, UserRole.STAFF]) },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      users.map(async (user) => ({
        _id: user.userId,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        permissions: await this.effectivePermissionsService.getEffectivePermissions(
          user.userId,
          user.role,
        ),
      })),
    );
  }

  async applyAdminPermissions(
    userId: string,
    permissionKeys: string[],
    sourceProjectId?: string,
    syncedBy?: string,
  ) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user || ![UserRole.ADMIN, UserRole.STAFF].includes(user.role)) {
      throw new NotFoundException('Admin user not found');
    }

    const result = await this.effectivePermissionsService.applyUserPermissions({
      userId,
      permissionKeys,
      sourceProjectId,
      syncedBy,
    });

    return {
      ...result,
      user: {
        _id: user.userId,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  }
}
