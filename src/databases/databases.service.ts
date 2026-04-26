import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionEntity } from '../permissions/entities/permission.entity';
import { RolePermissionEntity } from '../roles/entities/role-permission.entity';
import { RefreshTokenEntity } from '../users/entities/refresh-token.entity';
import { UserEntity, UserRole } from '../users/entities/user.entity';

const CORE_PERMISSIONS = [
  // Manage = full CRUD
  { permissionKey: 'manage_products', permissionName: 'Quản lý sản phẩm' },
  { permissionKey: 'manage_orders', permissionName: 'Quản lý đơn hàng' },
  { permissionKey: 'manage_permissions', permissionName: 'Quản lý phân quyền' },
  { permissionKey: 'manage_news', permissionName: 'Quản lý bài viết' },
  { permissionKey: 'manage_inventory', permissionName: 'Quản lý kho hàng' },
  { permissionKey: 'manage_users', permissionName: 'Quản lý người dùng' },
  { permissionKey: 'manage_discounts', permissionName: 'Quản lý khuyến mãi' },
  { permissionKey: 'manage_reports', permissionName: 'Quản lý báo cáo' },
  { permissionKey: 'manage_settings', permissionName: 'Quản lý cài đặt hệ thống' },
  { permissionKey: 'manage_delivery', permissionName: 'Quản lý vận chuyển' },
  { permissionKey: 'manage_interface', permissionName: 'Quản lý giao diện' },
  { permissionKey: 'manage_reviews', permissionName: 'Quản lý đánh giá sản phẩm' },
  { permissionKey: 'manage_categories', permissionName: 'Quản lý danh mục' },
  { permissionKey: 'manage_customers', permissionName: 'Quản lý khách hàng' },
  { permissionKey: 'manage_support', permissionName: 'Quản lý chatbox' },
  { permissionKey: 'manage_ai_diagnosis', permissionName: 'Quản lý chuẩn đoán bệnh lúa bằng AI' },
  { permissionKey: 'manage_suppliers', permissionName: 'Quản lý nhà cung cấp' },
  { permissionKey: 'manage_procurement', permissionName: 'Quản lý mua hàng' },
  { permissionKey: 'manage_returns', permissionName: 'Quản lý trả hàng' },
  { permissionKey: 'manage_audit_logs', permissionName: 'Quản lý nhật ký thao tác' },

  // View = read-only
  { permissionKey: 'view_orders', permissionName: 'Xem đơn hàng' },
  { permissionKey: 'view_products', permissionName: 'Xem sản phẩm' },
  { permissionKey: 'view_news', permissionName: 'Xem bài viết' },
  { permissionKey: 'view_inventory', permissionName: 'Xem kho hàng' },
  { permissionKey: 'view_users', permissionName: 'Xem người dùng' },
  { permissionKey: 'view_discounts', permissionName: 'Xem khuyến mãi' },
  { permissionKey: 'view_reports', permissionName: 'Xem báo cáo' },
  { permissionKey: 'view_settings', permissionName: 'Xem cài đặt' },
  { permissionKey: 'view_delivery', permissionName: 'Xem vận chuyển' },
  { permissionKey: 'view_categories', permissionName: 'Xem danh mục' },
  { permissionKey: 'view_customers', permissionName: 'Xem khách hàng' },
  { permissionKey: 'view_audit_logs', permissionName: 'Xem nhật ký' },
  { permissionKey: 'view_suppliers', permissionName: 'Xem nhà cung cấp' },
  { permissionKey: 'view_procurement', permissionName: 'Xem mua hàng' },
  { permissionKey: 'view_returns', permissionName: 'Xem trả hàng' },
  { permissionKey: 'view_dashboard', permissionName: 'Xem trang tổng quan' },
];

// Mapping permission cho từng role mặc định
// ADMIN: tất cả permissions (auto-grant ở seeder)
// STAFF: được quản lý đơn hàng + sản phẩm + xem báo cáo + xem khách hàng
// VIEWER: chỉ view_*
const STAFF_PERMISSIONS = [
  'manage_orders',
  'manage_products',
  'manage_inventory',
  'manage_categories',
  'manage_news',
  'manage_returns',
  'manage_procurement',
  'manage_suppliers',
  'view_reports',
  'view_customers',
  'view_audit_logs',
  'view_dashboard',
  'view_discounts',
];

// Reserved cho role VIEWER tương lai (chưa seed vì UserRole enum chỉ có 3 role).
// Khi cần thêm VIEWER role: thêm 'viewer' vào UserRole enum + seed permissions từ list này.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _VIEWER_PERMISSIONS = [
  'view_orders',
  'view_products',
  'view_news',
  'view_inventory',
  'view_users',
  'view_discounts',
  'view_reports',
  'view_delivery',
  'view_categories',
  'view_customers',
  'view_audit_logs',
  'view_suppliers',
  'view_procurement',
  'view_returns',
  'view_dashboard',
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
  ) { }

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
    const permMap = new Map<string, PermissionEntity>();

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
      permMap.set(perm.permissionKey, entity);

      // ADMIN luôn có TẤT CẢ permissions
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
      }
    }

    // STAFF: subset permissions (operational)
    for (const key of STAFF_PERMISSIONS) {
      const entity = permMap.get(key);
      if (!entity) continue;
      const exists = await this.rolePermissionsRepository.findOneBy({
        role: UserRole.STAFF,
        permissionId: entity.permissionId,
      });
      if (!exists) {
        await this.rolePermissionsRepository.save(
          this.rolePermissionsRepository.create({
            role: UserRole.STAFF,
            permissionId: entity.permissionId,
            createdAt: new Date(),
          }),
        );
      }
    }
  }
}
