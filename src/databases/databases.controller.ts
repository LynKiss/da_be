import { Controller, Get } from '@nestjs/common';
import { DatabasesService } from './databases.service';

@Controller('databases')
export class DatabasesController {
  constructor(private readonly databasesService: DatabasesService) {}

  @Get('summary')
  getSummary() {
    return this.databasesService.getSummary();
  }
}
