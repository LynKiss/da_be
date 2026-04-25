import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public, ResponseMessage } from '../decorator/customize';

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Liveness probe — endpoint cho Docker/k8s/load balancer.
   * Trả về 200 nếu app còn chạy, không kiểm tra dependency.
   */
  @Public()
  @Get()
  @ResponseMessage('Health check')
  async check() {
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    return {
      status: 'ok',
      uptime: uptimeSec,
      timestamp: new Date().toISOString(),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }

  /**
   * Readiness probe — kiểm tra DB có còn kết nối không.
   * Nếu DB down → trả 503, load balancer sẽ ngừng route traffic vào instance này.
   */
  @Public()
  @Get('ready')
  @ResponseMessage('Readiness check')
  async ready() {
    try {
      // Ping nhẹ DB
      await this.dataSource.query('SELECT 1');
      return {
        status: 'ready',
        database: 'up',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      throw new ServiceUnavailableException({
        status: 'not ready',
        database: 'down',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
