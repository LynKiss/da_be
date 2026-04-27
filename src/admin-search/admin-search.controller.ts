import { Controller, Get, Query } from '@nestjs/common';
import { ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { AdminSearchService } from './admin-search.service';
import { AdminSearchQueryDto } from './dto/admin-search-query.dto';

@Controller('admin-search')
export class AdminSearchController {
  constructor(private readonly adminSearchService: AdminSearchService) {}

  @Get()
  @ResponseMessage('Global admin search')
  search(@User() currentUser: IUser, @Query() query: AdminSearchQueryDto) {
    return this.adminSearchService.search(currentUser, query);
  }
}
