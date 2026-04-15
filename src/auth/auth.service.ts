import { Response } from 'express';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import ms, { StringValue } from 'ms';
import { RolesService } from '../roles/roles.service';
import { RegisterUserDto } from '../users/dto/create-user.dto';
import { UserEntity } from '../users/entities/user.entity';
import { IUser, IUserRoleSummary } from '../users/users.interface';
import { UsersService } from '../users/users.service';

type JwtPayload = {
  _id: string;
  username: string;
  email: string;
  role: IUserRoleSummary;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly rolesService: RolesService,
  ) {}

  async validateUser(username: string, pass: string): Promise<IUser | null> {
    const user = await this.usersService.findOneByUsername(username);
    if (!user || !user.isActive) {
      return null;
    }

    const isPasswordValid = await this.usersService.checkUserPassword(
      pass,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      return null;
    }

    return this.toAuthUser(user);
  }

  async login(user: IUser, response?: Response) {
    const payload = this.buildTokenPayload(user);
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.createRefreshToken(payload);
    const refreshExpiresAt = new Date(
      Date.now() + ms(this.getRefreshTokenExpires()),
    );

    if (response) {
      this.setRefreshTokenCookie(response, refreshToken);
    }

    await this.usersService.updateUserRefreshToken(
      user._id,
      refreshToken,
      refreshExpiresAt,
    );

    const permissions = await this.loadPermissionsForRole(user.role);

    return {
      access_token: accessToken,
      access_token_expires_in: this.toExpiresInSeconds(
        this.getAccessTokenExpires(),
      ),
      refresh_token: refreshToken,
      refresh_token_expires_in: this.toExpiresInSeconds(
        this.getRefreshTokenExpires(),
      ),
      user: {
        ...user,
        permissions,
      },
    };
  }

  async register(registerUserDto: RegisterUserDto) {
    return this.usersService.register(registerUserDto);
  }

  async refreshToken(refreshToken: string | undefined, response: Response) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
      secret: this.getRefreshTokenSecret(),
    });

    await this.usersService.validateStoredRefreshToken(
      payload._id,
      refreshToken,
    );

    const userEntity = await this.usersService.findOneByIdForAuth(payload._id);
    if (!userEntity || !userEntity.isActive) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại hoặc đã bị khóa',
      );
    }

    const user = this.toAuthUser(userEntity);
    const newPayload = this.buildTokenPayload(user);
    const newAccessToken = this.jwtService.sign(newPayload);
    const newRefreshToken = this.createRefreshToken(newPayload);
    const refreshExpiresAt = new Date(
      Date.now() + ms(this.getRefreshTokenExpires()),
    );

    this.setRefreshTokenCookie(response, newRefreshToken);
    await this.usersService.updateUserRefreshToken(
      user._id,
      newRefreshToken,
      refreshExpiresAt,
    );

    return {
      access_token: newAccessToken,
      access_token_expires_in: this.toExpiresInSeconds(
        this.getAccessTokenExpires(),
      ),
      user: {
        ...user,
        permissions: await this.loadPermissionsForRole(user.role),
      },
    };
  }

  async logout(user: IUser, response: Response) {
    await this.usersService.updateUserRefreshToken(user._id, null);
    response.clearCookie('refresh_token', {
      httpOnly: true,
      sameSite: 'lax',
    });

    return { success: true };
  }

  createRefreshToken(payload: JwtPayload) {
    return this.jwtService.sign(payload, {
      secret: this.getRefreshTokenSecret(),
      expiresIn: this.getRefreshTokenExpires(),
    });
  }

  private buildTokenPayload(user: IUser): JwtPayload {
    return {
      _id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }

  private async loadPermissionsForRole(role: IUserRoleSummary) {
    if (!role?._id) {
      return [];
    }

    const fullRole = await this.rolesService.findOne(role._id);
    return fullRole.permissions;
  }

  private toAuthUser(user: UserEntity): IUser {
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

  private getAccessTokenExpires(): StringValue {
    return (
      (this.configService.get<string>('JWT__ACCESS_EXPIRED') as StringValue) ??
      '300s'
    );
  }

  private getRefreshTokenExpires(): StringValue {
    return (
      (this.configService.get<string>('JWT_REFRESH_EXPIRED') as StringValue) ??
      '6000s'
    );
  }

  private getRefreshTokenSecret() {
    return this.configService.get<string>('JWT_REFRESH_TOKEN') ?? 'change-me';
  }

  private toExpiresInSeconds(duration: StringValue) {
    return Math.floor(ms(duration) / 1000);
  }

  private setRefreshTokenCookie(response: Response, refreshToken: string) {
    response.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: ms(this.getRefreshTokenExpires()),
    });
  }
}
