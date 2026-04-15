// ExecutionContext cho phep doc request hien tai trong guard.
// Injectable/UnauthorizedException/ForbiddenException dung cho guard auth + permission.
import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
// AuthGuard('jwt') dung strategy jwt de xac thuc token.
import { AuthGuard } from '@nestjs/passport';
// Reflector dung de doc metadata tu decorator @Public().
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
// IS_PUBLIC_KEY la metadata key duoc set boi decorator @Public().
import {
  IS_PUBLIC_KEY,
  IS_PUBLIC_PERMISSION,
} from '../decorator/customize';
// IUser la shape du lieu user duoc gan vao req.user.
import { IUser } from '../users/users.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard(['jwt']) {
  // Inject Reflector de kiem tra route co duoc danh dau public hay khong.
  constructor(private reflector: Reflector) {
    super();
  }

  // canActivate() chay truoc khi request vao controller.
  canActivate(context: ExecutionContext) {
    // Doc metadata tu decorator @Public() o method hoac controller.
    // Neu route duoc danh dau public thi bo qua buoc kiem tra JWT.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  // handleRequest() duoc goi sau khi strategy jwt xu ly xong.
  handleRequest<TUser = IUser>(
    err: any,
    user: IUser,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    const request: Request = context.switchToHttp().getRequest();
    const isSkipPermission = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_PERMISSION,
      [context.getHandler(), context.getClass()],
    );

    // Neu passport bao loi hoac khong co user thi tra 401 ngay.
    if (err || !user) {
      throw (
        err ||
        new UnauthorizedException('Token khong hop le hoac ban chua dang nhap')
      );
    }

    // Lay request hien tai de xac dinh endpoint dang duoc goi.
    // Lay method thuc te cua request, vi du GET/POST/PATCH/DELETE.
    const targetMethod = request.method;
    // request.route.path giong flow trong video, originalUrl la fallback khi can so sanh day du prefix/version.
    const routePath = request.route?.path as string | undefined;
    const originalUrl = (request.originalUrl as string | undefined) ?? '';
    const targetEndpoint = routePath || originalUrl.split('?')[0];

    // Lay danh sach permissions tu req.user do JwtStrategy da gan vao.
    const permissions = user?.permissions ?? [];

    // Neu khong xac dinh duoc route path thi bo qua check permission de tranh chan nham.
    if (!targetEndpoint) {
      return user as TUser;
    }

    // Nhom route auth noi bo duoc bo qua permission check de tranh tu khoa user.
    if (targetEndpoint.startsWith('/api/v1/auth')) {
      return user as TUser;
    }

    // Tim permission khop ca method va apiPath.
    let isExist = permissions.find(
      (permission) =>
        targetMethod === permission.method &&
        targetEndpoint === permission.apiPath,
    );

    if (!isExist && originalUrl) {
      const normalizedUrl = originalUrl.split('?')[0];
      isExist = permissions.find(
        (permission) =>
          targetMethod === permission.method &&
          normalizedUrl === permission.apiPath,
      );
    }

    // Khong tim thay permission phu hop thi chan truy cap.
    if (!isExist && !isSkipPermission) {
      throw new ForbiddenException('Ban khong co quyen de truy cap endpoint nay');
    }

    // Tra ve user de Nest gan vao request va controller co the su dung tiep.
    return user as TUser;
  }
}
