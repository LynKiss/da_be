import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Log mọi HTTP request: method, URL, status, response time, user.
 * Format: "[HTTP] GET /api/v1/orders 200 12ms user=admin"
 *
 * Bỏ qua /health và /favicon (giảm noise).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly SKIP_PATHS = new Set(['/health', '/favicon.ico']);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest();
    const res = httpCtx.getResponse();

    const url: string = req.originalUrl ?? req.url ?? '';
    if (this.SKIP_PATHS.has(url)) {
      return next.handle();
    }

    const method: string = req.method ?? 'UNKNOWN';
    const startedAt = Date.now();
    const userInfo: string = req.user?.username
      ? ` user=${req.user.username}`
      : '';

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startedAt;
          const status = res.statusCode ?? 200;
          this.logger.log(`${method} ${url} ${status} ${duration}ms${userInfo}`);
        },
        error: (err) => {
          const duration = Date.now() - startedAt;
          const status =
            err?.status ?? err?.response?.statusCode ?? res.statusCode ?? 500;
          this.logger.warn(
            `${method} ${url} ${status} ${duration}ms${userInfo} — ${err?.message ?? 'error'}`,
          );
        },
      }),
    );
  }
}
