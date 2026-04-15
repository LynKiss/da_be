import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { RequirePermissions, ResponseMessage } from '../decorator/customize';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { PermissionsService } from './permissions.service';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermissions('manage_permissions')
  @ResponseMessage('Get permissions list')
  getPermissions() {
    return this.permissionsService.findAll();
  }

  @Get('roles/:role')
  @RequirePermissions('manage_permissions')
  @ResponseMessage('Get permissions by role')
  getPermissionsByRole(@Param('role') role: string) {
    return this.permissionsService.findPermissionsByRole(role);
  }

  @Put('roles/:role')
  @RequirePermissions('manage_permissions')
  @ResponseMessage('Update permissions by role')
  updateRolePermissions(
    @Param('role') role: string,
    @Body() updateRolePermissionsDto: UpdateRolePermissionsDto,
  ) {
    return this.permissionsService.updateRolePermissions(
      role,
      updateRolePermissionsDto,
    );
  }
}
