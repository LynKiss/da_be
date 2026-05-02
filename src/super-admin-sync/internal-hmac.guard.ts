import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

type SignedRequest = Request & {
  originalUrl: string;
  body?: unknown;
};

@Injectable()
export class InternalHmacGuard implements CanActivate {
  private readonly maxSkewMs = 5 * 60 * 1000;

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SignedRequest>();
    const secret = this.configService.get<string>('SUPER_ADMIN_SYNC_SECRET');

    if (!secret) {
      throw new UnauthorizedException('Project sync secret is not configured');
    }

    const timestamp = this.getHeader(request, 'x-sa-timestamp');
    const signature = this.getHeader(request, 'x-sa-signature');

    if (!timestamp || !signature) {
      throw new UnauthorizedException('Missing super admin sync signature');
    }

    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > this.maxSkewMs) {
      throw new UnauthorizedException('Super admin sync signature expired');
    }

    const body = request.body === undefined ? '' : JSON.stringify(request.body);
    const payload = [
      timestamp,
      request.method.toUpperCase(),
      request.originalUrl,
      body,
    ].join('.');
    const expected = createHmac('sha256', secret).update(payload).digest('hex');

    if (!this.safeEqual(signature, expected)) {
      throw new UnauthorizedException('Invalid super admin sync signature');
    }

    return true;
  }

  private getHeader(request: Request, name: string) {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }
}
