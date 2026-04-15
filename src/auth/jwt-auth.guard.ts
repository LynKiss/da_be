import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorator/customize';
import { IUser } from '../users/users.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = IUser>(
    err: unknown,
    user: IUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw new UnauthorizedException(
        'Token không hợp lệ hoặc bạn chưa đăng nhập',
      );
    }

    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredPermissions.length === 0) {
      return user as TUser;
    }

    const currentPermissions = new Set(
      user.permissions.map((permission) => permission.key),
    );

    const hasAllPermissions = requiredPermissions.every((permission) =>
      currentPermissions.has(permission),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException('Bạn không có quyền truy cập tính năng này');
    }

    return user as TUser;
  }
}
