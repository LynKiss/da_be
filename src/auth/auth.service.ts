import { Response } from 'express';
import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import ms, { StringValue } from 'ms';
import * as nodemailer from 'nodemailer';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { SettingsService } from '../settings/settings.service';
import { RegisterUserDto } from '../users/dto/create-user.dto';
import { UserEntity } from '../users/entities/user.entity';
import { IUser, IUserRoleSummary } from '../users/users.interface';
import { UsersService } from '../users/users.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

type JwtPayload = {
  _id: string;
  username: string;
  email: string;
  role: IUserRoleSummary;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly effectivePermissionsService: EffectivePermissionsService,
    private readonly settingsService: SettingsService,
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

    const permissions = await this.loadEffectivePermissions(user);

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

  async forgotPassword(dto: ForgotPasswordDto) {
    const resetOtp = await this.usersService.createPasswordResetOtp(dto.email);

    if (resetOtp) {
      try {
        await this.sendPasswordResetOtpEmail(resetOtp);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Password reset OTP email was not sent: ${message}`);
      }
    }

    return {
      message:
        'Neu email ton tai, ma OTP dat lai mat khau da duoc gui trong it phut nua',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    return this.usersService.resetPasswordByOtp(
      dto.email,
      dto.otp,
      dto.newPassword,
    );
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
        permissions: await this.loadEffectivePermissions(user),
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

  private async loadEffectivePermissions(user: IUser) {
    if (!user._id || !user.role?._id) {
      return [];
    }

    return this.effectivePermissionsService.getEffectivePermissions(
      user._id,
      user.role._id,
    );
  }

  private toAuthUser(user: UserEntity): IUser {
    return {
      _id: user.userId,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
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

  private async sendPasswordResetOtpEmail(input: {
    email: string;
    fullName: string | null;
    username: string;
    otp: string;
    expiresInMinutes: number;
  }) {
    const smtp = await this.settingsService.getResolvedSmtpConfig();
    if (!smtp.host || !smtp.user || !smtp.pass) {
      this.logger.warn('SMTP is not configured for password reset OTP email');
      return;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
      });

      await transporter.sendMail({
        from: smtp.from,
        to: input.email,
        subject: 'Ma OTP dat lai mat khau Cultivated Ledger',
        text: [
          `Xin chao ${input.fullName || input.username},`,
          '',
          `Ma OTP dat lai mat khau cua ban la: ${input.otp}`,
          `Ma co hieu luc trong ${input.expiresInMinutes} phut.`,
          '',
          'Neu ban khong yeu cau dat lai mat khau, vui long bo qua email nay.',
        ].join('\n'),
        html: this.buildPasswordResetEmailHtml(input),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Cannot send password reset OTP email: ${message}`);
    }
  }

  private buildPasswordResetEmailHtml(input: {
    fullName: string | null;
    username: string;
    otp: string;
    expiresInMinutes: number;
  }) {
    const displayName = this.escapeHtml(input.fullName || input.username);

    return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f0eb;font-family:Arial,sans-serif;color:#1E3932">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0eb;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
        <tr><td style="background:#1E3932;padding:24px 32px">
          <p style="margin:0;color:#D4E9E2;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Cultivated Ledger</p>
          <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px">Dat lai mat khau</h1>
        </td></tr>
        <tr><td style="padding:28px 32px">
          <p style="margin:0 0 12px;font-size:15px;line-height:24px">Xin chao <strong>${displayName}</strong>,</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:24px">Dung ma OTP ben duoi de dat lai mat khau tai khoan cua ban.</p>
          <div style="margin:20px 0;padding:18px 24px;background:#f2f0eb;border-radius:12px;text-align:center">
            <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#006241">${input.otp}</div>
          </div>
          <p style="margin:0;font-size:14px;line-height:22px;color:#4a6155">Ma co hieu luc trong <strong>${input.expiresInMinutes} phut</strong>. Neu ban khong yeu cau dat lai mat khau, hay bo qua email nay.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
