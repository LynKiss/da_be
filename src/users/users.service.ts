import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { RegisterUserDto } from './dto/create-user.dto';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserEntity, UserRole } from './entities/user.entity';
import { IUser } from './users.interface';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokensRepository: Repository<RefreshTokenEntity>,
  ) {}

  async findOneByUsername(username: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({
      where: [{ username }, { email: username }],
    });
  }

  async findOneByIdForAuth(userId: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({
      where: { userId },
      relations: { refreshToken: true },
    });
  }

  async findAll() {
    const users = await this.usersRepository.find({
      order: { createdAt: 'DESC' },
    });

    return users.map((user) => this.toPublicUser(user));
  }

  async findProfile(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new UnauthorizedException('Nguoi dung khong ton tai');
    }

    return this.toPublicUser(user);
  }

  async register(registerUserDto: RegisterUserDto) {
    const existedUser = await this.usersRepository.findOne({
      where: [
        { username: registerUserDto.username },
        { email: registerUserDto.email },
      ],
    });

    if (existedUser) {
      throw new ConflictException('Username hoac email da ton tai');
    }

    const user = this.usersRepository.create({
      userId: randomUUID(),
      username: registerUserDto.username,
      email: registerUserDto.email,
      avatarUrl: registerUserDto.avatarUrl ?? null,
      role: UserRole.CUSTOMER,
      passwordHash: await this.hashPassword(registerUserDto.password),
      provider: 'local',
      providerId: null,
      isActive: true,
      resetPasswordCode: null,
      resetPasswordExpiresAt: null,
    });

    const savedUser = await this.usersRepository.save(user);

    return {
      _id: savedUser.userId,
      username: savedUser.username,
      email: savedUser.email,
      role: savedUser.role,
      message: 'Dang ky tai khoan thanh cong',
    };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async checkUserPassword(
    password: string,
    hash: string | null,
  ): Promise<boolean> {
    if (!hash) {
      return false;
    }

    return bcrypt.compare(password, hash);
  }

  async updateUserRefreshToken(
    userId: string,
    refreshToken: string | null,
    expiredAt?: Date,
  ) {
    if (!refreshToken) {
      await this.refreshTokensRepository.update(
        { userId, isRevoked: false },
        { isRevoked: true },
      );
      return;
    }

    await this.refreshTokensRepository.update(
      { userId, isRevoked: false },
      { isRevoked: true },
    );

    const hashedRefreshToken = await this.hashPassword(refreshToken);
    const entity = this.refreshTokensRepository.create({
      userId,
      refreshToken: hashedRefreshToken,
      expiredAt: expiredAt ?? new Date(),
      isRevoked: false,
    });

    await this.refreshTokensRepository.save(entity);
  }

  async validateStoredRefreshToken(userId: string, refreshToken: string) {
    const storedToken = await this.refreshTokensRepository.findOne({
      where: { userId, isRevoked: false },
      order: { createdAt: 'DESC' },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token khong hop le');
    }

    const isValid = await this.checkUserPassword(
      refreshToken,
      storedToken.refreshToken,
    );

    if (!isValid) {
      throw new UnauthorizedException('Refresh token khong hop le');
    }

    if (storedToken.expiredAt.getTime() <= Date.now()) {
      await this.refreshTokensRepository.update(
        { tokenId: storedToken.tokenId },
        { isRevoked: true },
      );
      throw new UnauthorizedException('Refresh token da het han');
    }
  }

  private toPublicUser(user: UserEntity): IUser {
    return {
      _id: user.userId,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: {
        _id: user.role,
        name: user.role,
      },
      permissions: [],
    };
  }
}
