import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../decorator/customize';
import { DatabasesService } from './databases.service';

@Controller('databases')
export class DatabasesController {
  constructor(private readonly databasesService: DatabasesService) {}

  @Get('summary')
  @RequirePermissions('manage_settings')
  getSummary() {
    return this.databasesService.getSummary();
  }
}
