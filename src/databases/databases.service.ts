// ConfigService dung de doc bien moi truong trong file .env.
import { ConfigService } from '@nestjs/config';
// Logger de ghi log ro rang hon khi app khoi dong va seed data.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// InjectModel dung de inject cac mongoose model vao service.
import { InjectModel } from '@nestjs/mongoose';
// SoftDeleteModel la model mongoose da duoc mo rong boi plugin soft-delete.
import { SoftDeleteModel } from 'soft-delete-plugin-mongoose';
// UsersService duoc dung lai de hash password thay vi viet hash truc tiep o day.
import { UsersService } from '../users/users.service';
// Import cac hang so seed data va ten role mac dinh.
import {
  ADMIN_ROLE,
  INIT_PERMISSIONS,
  INIT_USERS,
  USER_ROLE,
} from './sample';
// Import type/schema permission de inject model permission.
import {
  Permission,
  PermissionDocument,
} from '../permissions/schemas/permission.schema';
// Import type/schema role de inject model role.
import { Role, RoleDocument } from '../roles/schemas/role.schema';
// Import type/schema user de inject model user.
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class DatabasesService implements OnModuleInit {
  // Logger rieng cho service nay de log de nhin va phan biet nguon log.
  private readonly logger = new Logger(DatabasesService.name);

  constructor(
    // Inject model user de tao va dem user.
    @InjectModel(User.name)
    private userModel: SoftDeleteModel<UserDocument>,

    // Inject model permission de tao va truy van permission.
    @InjectModel(Permission.name)
    private permissionModel: SoftDeleteModel<PermissionDocument>,

    // Inject model role de tao va truy van role.
    @InjectModel(Role.name)
    private roleModel: SoftDeleteModel<RoleDocument>,

    // Service doc bien moi truong.
    private configService: ConfigService,
    // Service users de dung ham hashPassword co san trong project.
    private usersService: UsersService,
  ) {}

  // Kiem tra co duoc phep init data hay khong.
  // Chi tra ve true khi SHOULD_INIT trong .env = "true".
  private shouldInitData() {
    return (this.configService.get<string>('SHOULD_INIT') ?? '')
      .trim()
      .toLowerCase() === 'true';
  }

  // Lay password seed tu .env.
  // Neu chua co INIT_PASSWORD thi dung tam gia tri mac dinh 123456.
  private getInitPassword() {
    return this.configService.get<string>('INIT_PASSWORD') ?? '123456';
  }

  // Seed permissions mau vao database.
  // Ham nay chi them permission chua ton tai, khong tao trung.
  private async seedPermissions() {
    // Lay cac permission hien co de doi chieu theo cap method + apiPath.
    const existingPermissions = await this.permissionModel
      .find({})
      .select({ apiPath: 1, method: 1 })
      .lean();

    // Tao Set de kiem tra ton tai nhanh hon.
    const existingKeys = new Set(
      existingPermissions.map((item) => `${item.method}:${item.apiPath}`),
    );

    // Loc ra nhung permission chua co trong DB.
    const permissionsToCreate = INIT_PERMISSIONS.filter(
      (item) => !existingKeys.has(`${item.method}:${item.apiPath}`),
    );

    // Chi insert khi thuc su co permission moi can tao.
    if (permissionsToCreate.length > 0) {
      await this.permissionModel.insertMany(permissionsToCreate);
      this.logger.log(`Seeded ${permissionsToCreate.length} permissions`);
    }
  }

  // Seed role admin va user.
  // Role admin duoc gan tat ca permission hien co.
  // Role user mac dinh khong gan permission nao.
  private async seedRoles() {
    // Lay toan bo _id permission de role admin co full quyen.
    const permissions = await this.permissionModel.find({}).select({ _id: 1 });
    // Chuyen danh sach permission document thanh mang id.
    const allPermissionIds = permissions.map((item) => item._id);

    // Lay cac role can seed neu da ton tai.
    const existingRoles = await this.roleModel
      .find({
        name: { $in: [ADMIN_ROLE, USER_ROLE] },
      })
      .select({ name: 1 })
      .lean();

    // Tao Set role name ton tai de check nhanh.
    const existingRoleNames = new Set(existingRoles.map((item) => item.name));
    // Mang tam de chua cac role can tao moi.
    const rolesToCreate: Array<{
      name: string;
      description: string;
      isActive: boolean;
      permissions: any[];
    }> = [];

    // Neu chua co role ADMIN thi tao role admin.
    if (!existingRoleNames.has(ADMIN_ROLE)) {
      rolesToCreate.push({
        name: ADMIN_ROLE,
        description: 'Admin role with full permissions',
        isActive: true,
        permissions: allPermissionIds,
      });
    }

    // Neu chua co role USER thi tao role user.
    if (!existingRoleNames.has(USER_ROLE)) {
      rolesToCreate.push({
        name: USER_ROLE,
        description: 'Default role for end users',
        isActive: true,
        permissions: [],
      });
    }

    // Insert tat ca role can tao trong mot lan.
    if (rolesToCreate.length > 0) {
      await this.roleModel.insertMany(rolesToCreate);
      this.logger.log(`Seeded ${rolesToCreate.length} roles`);
    }
  }

  // Seed user admin va user thuong.
  // User se duoc tao sau khi role da ton tai.
  private async seedUsers() {
    // Lay role ADMIN va USER de map sang _id that trong collection roles.
    const roles = await this.roleModel
      .find({
        name: { $in: [ADMIN_ROLE, USER_ROLE] },
      })
      .select({ _id: 1, name: 1 })
      .lean();

    // Tao Map<tenRole, roleId> de tra cuu nhanh khi tao user.
    const roleMap = new Map(roles.map((role) => [role.name, role._id]));
    // Lay cac user seed neu da ton tai theo email.
    const existingUsers = await this.userModel
      .find({
        email: { $in: INIT_USERS.map((item) => item.email) },
      })
      .select({ email: 1 })
      .lean();

    // Tao Set email ton tai de tranh insert trung.
    const existingEmails = new Set(existingUsers.map((item) => item.email));
    // Hash password seed mot lan roi dung lai cho cac user mau.
    const initPasswordHash = this.usersService.hashPassword(this.getInitPassword());

    // Loc user chua ton tai va chuyen roleName thanh role _id.
    const usersToCreate = INIT_USERS.filter(
      (item) => !existingEmails.has(item.email),
    )
      .map((item) => ({
        name: item.name,
        email: item.email,
        password: initPasswordHash,
        age: item.age,
        gender: item.gender,
        address: item.address,
        role: roleMap.get(item.roleName),
      }))
      // Neu khong tim thay role _id thi bo qua user do de tranh insert loi.
      .filter((item) => item.role);

    // Chi insert khi co user moi can tao.
    if (usersToCreate.length > 0) {
      await this.userModel.insertMany(usersToCreate);
      this.logger.log(`Seeded ${usersToCreate.length} users`);
    }
  }

  // Hook cua NestJS.
  // Ham nay tu dong chay sau khi module duoc khoi tao xong.
  async onModuleInit() {
    // Neu .env khong bat SHOULD_INIT=true thi bo qua toan bo seed data.
    if (!this.shouldInitData()) {
      this.logger.log('Skipping init data because SHOULD_INIT is not true');
      return;
    }

    // Seed permission truoc vi role admin can dung danh sach permission.
    await this.seedPermissions();
    // Seed role sau khi permission da co.
    await this.seedRoles();
    // Seed user sau khi role da co.
    await this.seedUsers();

    // Dem lai tong so document de log ket qua sau cung.
    const [countUser, countRole, countPermission] = await Promise.all([
      this.userModel.countDocuments(),
      this.roleModel.countDocuments(),
      this.permissionModel.countDocuments(),
    ]);

    // Log tong ket de de theo doi khi app start.
    this.logger.log(
      `Init data completed. users=${countUser}, roles=${countRole}, permissions=${countPermission}`,
    );
  }
}
