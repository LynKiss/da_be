// ConfigService dung de doc secret JWT tu .env.
import { ConfigService } from '@nestjs/config';
// ExtractJwt/Strategy la cac thanh phan passport-jwt de doc va verify bearer token.
import { ExtractJwt, Strategy } from 'passport-jwt';
// PassportStrategy giup khai bao strategy "jwt" trong NestJS.
import { PassportStrategy } from '@nestjs/passport';
// Injectable de Nest co the inject strategy nay.
import { Injectable } from '@nestjs/common';
// IUser la shape du lieu user ma app dang su dung.
import { IUser } from '../../users/users.interface';
// RolesService dung de load full permissions theo role.
import { RolesService } from '../../roles/roles.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // Constructor inject ConfigService va RolesService.
  constructor(
    private configService: ConfigService,
    private rolesService: RolesService,
  ) {
    // super() khai bao cach lay JWT va secret de verify token.
    super({
      // JWT duoc lay tu Authorization: Bearer <token>.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Khong bo qua viec kiem tra han su dung cua token.
      ignoreExpiration: false,
      // Secret verify access token.
      secretOrKey: configService.get<string>('JWT__ACCESS_SECRET'),
    });
  }

  // validate() chay sau khi JWT hop le.
  // Object tra ve tu ham nay se duoc gan vao req.user.
  async validate(payload: IUser) {
    // Tach cac field identity co trong payload.
    const { _id, name, email, role } = payload;

    // role trong token chi la role tom tat {_id, name}.
    // Can query them role trong DB de lay permissions day du cho req.user.
    const fullRole = role?._id
      ? await this.rolesService.findOne(role._id)
      : null;

    // Chuan hoa permissions truoc khi gan vao req.user.
    const permissions =
      fullRole?.permissions?.map((permission: any) => ({
        _id: permission._id?.toString?.() ?? permission._id,
        name: permission.name,
        apiPath: permission.apiPath,
        method: permission.method,
        module: permission.module,
      })) ?? [];

    // Tra ve req.user sau khi bo sung permissions.
    return {
      _id,
      name,
      email,
      role,
      permissions,
    };
  }
}
