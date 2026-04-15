import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { PermissionEntity } from '../permissions/entities/permission.entity';
import { RolePermissionEntity } from '../roles/entities/role-permission.entity';
import { RefreshTokenEntity } from '../users/entities/refresh-token.entity';
import { UserEntity } from '../users/entities/user.entity';

export const typeOrmConfig: TypeOrmModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    type: 'mysql' as const,
    host: configService.get<string>('MYSQL_HOST') ?? '127.0.0.1',
    port: Number(configService.get<string>('MYSQL_PORT') ?? '3306'),
    username: configService.get<string>('MYSQL_USER') ?? 'root',
    password: configService.get<string>('MYSQL_PASSWORD') ?? '',
    database: configService.get<string>('MYSQL_DB') ?? 'agri_ecommerce',
    entities: [
      UserEntity,
      PermissionEntity,
      RolePermissionEntity,
      RefreshTokenEntity,
    ],
    synchronize: true,
    autoLoadEntities: true,
  }),
};
