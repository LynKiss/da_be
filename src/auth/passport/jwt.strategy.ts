import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RolesService } from '../../roles/roles.service';
import { UserRole } from '../../users/entities/user.entity';

type JwtPayload = {
  _id: string;
  username: string;
  email: string;
  role: {
    _id: UserRole;
    name: UserRole;
  };
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly rolesService: RolesService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT__ACCESS_SECRET') ?? 'change-me',
    });
  }

  async validate(payload: JwtPayload) {
    const fullRole = payload.role?._id
      ? await this.rolesService.findOne(payload.role._id)
      : null;

    return {
      _id: payload._id,
      username: payload.username,
      email: payload.email,
      role: payload.role,
      permissions: fullRole?.permissions ?? [],
    };
  }
}
