// Module nay phu trach khoi tao du lieu mau khi app start.
import { Module } from '@nestjs/common';
// Service chua logic seed/init data.
import { DatabasesService } from './databases.service';
// Controller hien tai chua co nghiep vu dac biet, giu de dung cau truc module NestJS.
import { DatabasesController } from './databases.controller';
// MongooseModule dung de dang ky cac model cho module nay.
import { MongooseModule } from '@nestjs/mongoose';
// Import User schema de InjectModel(User.name) co the hoat dong trong DatabasesService.
import { User, UserSchema } from '../users/schemas/user.schema';
// Import Permission schema de InjectModel(Permission.name) co the hoat dong.
import { Permission, PermissionSchema } from '../permissions/schemas/permission.schema';
// Import Role schema de InjectModel(Role.name) co the hoat dong.
import { Role, RoleSchema } from '../roles/schemas/role.schema';
// Import UsersModule vi DatabasesService can dung UsersService de hash password.
import { UsersModule } from '../users/users.module';

@Module({
  // Khai bao controller thuoc module databases.
  controllers: [DatabasesController],
  // Khai bao service chua logic khoi tao du lieu.
  providers: [DatabasesService],
  imports: [
    // Import UsersModule de Nest co the inject UsersService vao DatabasesService dung cach.
    UsersModule,
    // Dang ky cac mongoose model can su dung trong module nay.
    MongooseModule.forFeature([
      // Model user.
      { name: User.name, schema: UserSchema },
      // Model permission.
      { name: Permission.name, schema: PermissionSchema },
      // Model role.
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
})
export class DatabasesModule {}
