import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { Public, ResponseMessage } from '../decorator/customize';
import { ApplyAdminPermissionsDto } from './dto/apply-admin-permissions.dto';
import { InternalHmacGuard } from './internal-hmac.guard';
import { SuperAdminSyncService } from './super-admin-sync.service';

@Public()
@UseGuards(InternalHmacGuard)
@Controller('internal/super-admin')
export class SuperAdminSyncController {
  constructor(private readonly superAdminSyncService: SuperAdminSyncService) {}

  @Get('permissions')
  @ResponseMessage('Internal permissions list')
  listPermissions() {
    return this.superAdminSyncService.listPermissions();
  }

  @Get('admins')
  @ResponseMessage('Internal admin users list')
  listAdmins() {
    return this.superAdminSyncService.listAdmins();
  }

  @Put('admins/:userId/permissions')
  @ResponseMessage('Internal apply admin permissions')
  applyAdminPermissions(
    @Param('userId') userId: string,
    @Query('projectId') projectId: string | undefined,
    @Body() dto: ApplyAdminPermissionsDto,
  ) {
    return this.superAdminSyncService.applyAdminPermissions(
      userId,
      dto.permissionKeys,
      projectId,
      dto.syncedBy,
    );
  }
}
