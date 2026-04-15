import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionEntity } from '../permissions/entities/permission.entity';
import { RefreshTokenEntity } from '../users/entities/refresh-token.entity';
import { UserEntity } from '../users/entities/user.entity';

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
  ) {}

  async getSummary() {
    const [users, permissions, refreshTokens] = await Promise.all([
      this.usersRepository.count(),
      this.permissionsRepository.count(),
      this.refreshTokensRepository.count(),
    ]);

    return {
      users,
      permissions,
      refreshTokens,
    };
  }

  async onModuleInit() {
    const summary = await this.getSummary();
    this.logger.log(
      `MySQL ready. users=${summary.users}, permissions=${summary.permissions}, refreshTokens=${summary.refreshTokens}`,
    );
  }
}
