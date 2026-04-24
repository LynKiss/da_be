import { Controller, Get, Query } from '@nestjs/common';
import { ResponseMessage } from '../decorator/customize';
import { AuditLogsService } from './audit-logs.service';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly svc: AuditLogsService) {}

  @Get()
  @ResponseMessage('Get audit logs')
  findAll(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('changedBy') changedBy?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 30,
  ) {
    return this.svc.findAll({ entityType, entityId, action, changedBy, from, to, page: +page, limit: +limit });
  }
}
