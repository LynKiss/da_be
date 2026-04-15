import { Controller, Get } from '@nestjs/common';
import { RequirePermissions, ResponseMessage } from '../decorator/customize';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('manage_permissions')
  @ResponseMessage('Get roles list')
  getRoles() {
    return this.rolesService.findAll();
  }
}
