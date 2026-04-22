import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionEntity } from '../permissions/entities/permission.entity';
import { RolePermissionEntity } from '../roles/entities/role-permission.entity';
import { RefreshTokenEntity } from '../users/entities/refresh-token.entity';
import { UserEntity, UserRole } from '../users/entities/user.entity';

const CORE_PERMISSIONS = [
  { permissionKey: 'manage_products', permissionName: 'Quản lý sản phẩm' },
  { permissionKey: 'manage_orders', permissionName: 'Quản lý đơn hàng' },
  { permissionKey: 'view_orders', permissionName: 'Xem đơn hàng' },
  { permissionKey: 'manage_permissions', permissionName: 'Quản lý phân quyền' },
  { permissionKey: 'manage_news', permissionName: 'Quản lý bài viết' },
  { permissionKey: 'manage_inventory', permissionName: 'Quản lý kho hàng' },
  { permissionKey: 'manage_users', permissionName: 'Quản lý người dùng' },
  { permissionKey: 'manage_discounts', permissionName: 'Quản lý khuyến mãi' },
  { permissionKey: 'manage_reports', permissionName: 'Quản lý báo cáo' },
  { permissionKey: 'view_reports', permissionName: 'Xem báo cáo' },
  { permissionKey: 'manage_settings', permissionName: 'Quản lý cài đặt hệ thống' },
  { permissionKey: 'manage_delivery', permissionName: 'Quản lý vận chuyển' },
  { permissionKey: 'manage_interface', permissionName: 'Quản lý giao diện' },
  { permissionKey: 'manage_reviews', permissionName: 'Quản lý đánh giá sản phẩm' },
  { permissionKey: 'manage_categories', permissionName: 'Quản lý danh mục' },
  { permissionKey: 'manage_customers', permissionName: 'Quản lý khách hàng' },
];

@Injectable()
export class DatabasesService implements OnModuleInit {
  private readonly logger = new Logger(DatabasesService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permissionsRepository: Repository<PermissionEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokensRepository: Repository<RefreshTokenEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionsRepository: Repository<RolePermissionEntity>,
  ) {}

  async getSummary() {
    const [users, permissions, refreshTokens] = await Promise.all([
      this.usersRepository.count(),
      this.permissionsRepository.count(),
      this.refreshTokensRepository.count(),
    ]);

    return { users, permissions, refreshTokens };
  }

  async onModuleInit() {
    await this.seedCorePermissions();
    const summary = await this.getSummary();
    this.logger.log(
      `MySQL ready. users=${summary.users}, permissions=${summary.permissions}, refreshTokens=${summary.refreshTokens}`,
    );
  }

  private async seedCorePermissions() {
    for (const perm of CORE_PERMISSIONS) {
      let entity = await this.permissionsRepository.findOneBy({
        permissionKey: perm.permissionKey,
      });

      if (!entity) {
        entity = await this.permissionsRepository.save(
          this.permissionsRepository.create({
            permissionKey: perm.permissionKey,
            permissionName: perm.permissionName,
          }),
        );
        this.logger.log(`Seeded permission: ${perm.permissionKey}`);
      }

      const hasAdminPerm = await this.rolePermissionsRepository.findOneBy({
        role: UserRole.ADMIN,
        permissionId: entity.permissionId,
      });

      if (!hasAdminPerm) {
        await this.rolePermissionsRepository.save(
          this.rolePermissionsRepository.create({
            role: UserRole.ADMIN,
            permissionId: entity.permissionId,
            createdAt: new Date(),
          }),
        );
        this.logger.log(`Assigned ${perm.permissionKey} to admin role`);
      }
    }
  }
}
