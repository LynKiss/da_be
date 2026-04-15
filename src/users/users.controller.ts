import { Controller, Get } from '@nestjs/common';
import {
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import type { IUser } from './users.interface';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('manage_users')
  @ResponseMessage('Get users list')
  getUsers() {
    return this.usersService.findAll();
  }

  @Get('me')
  @ResponseMessage('Get my profile')
  getMyProfile(@User() currentUser: IUser) {
    return this.usersService.findProfile(currentUser._id);
  }
}
