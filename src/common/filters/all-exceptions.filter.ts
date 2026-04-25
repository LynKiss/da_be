import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

/**
 * Bắt MỌI exception, log theo level phù hợp, trả response thống nhất.
 *
 * Phân loại:
 *   - HttpException 4xx        → log warn (lỗi user, không cần alarm)
 *   - HttpException 5xx        → log error (lỗi server cần fix)
 *   - QueryFailedError (DB)    → log error + giấu detail SQL khỏi response
 *   - Error / unknown          → log error stack, trả 500 generic
 *
 * Response format thống nhất:
 *   { statusCode, message, error?, timestamp, path }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const path: string = request?.originalUrl ?? request?.url ?? '';
    const method: string = request?.method ?? '';
    const userInfo = request?.user?.username
      ? ` user=${request.user.username}`
      : '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let errorName: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const r = res as { message?: string | string[]; error?: string };
        message = r.message ?? exception.message;
        errorName = r.error;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof QueryFailedError) {
      // Lỗi DB — KHÔNG expose SQL ra ngoài
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Database error';
      errorName = 'QueryFailedError';
    } else if (exception instanceof Error) {
      message = exception.message || 'Internal server error';
    }

    // Logging theo level
    const logLine = `${method} ${path} ${status}${userInfo} — ${
      Array.isArray(message) ? message.join(', ') : message
    }`;
    if (status >= 500) {
      const stack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(logLine, stack);
    } else if (status >= 400) {
      this.logger.warn(logLine);
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: errorName,
      timestamp: new Date().toISOString(),
      path,
    });
  }
}
