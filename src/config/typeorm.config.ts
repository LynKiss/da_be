import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';

export const typeOrmConfig: TypeOrmModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    type: 'mysql' as const,
    host: configService.get<string>('MYSQL_HOST') ?? '127.0.0.1',
    port: Number(configService.get<string>('MYSQL_PORT') ?? '3306'),
    username: configService.get<string>('MYSQL_USER') ?? 'root',
    password: configService.get<string>('MYSQL_PASSWORD') ?? '',
    database: configService.get<string>('MYSQL_DB') ?? 'agri_ecommerce',
    synchronize: configService.get<string>('TYPEORM_SYNC') === 'true',
    autoLoadEntities: true,
  }),
};
