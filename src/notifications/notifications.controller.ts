import { Controller, Get } from '@nestjs/common';
import { RequirePermissions, ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  @ResponseMessage('Get my notifications')
  getMyNotifications(@User() currentUser: IUser) {
    return this.notificationsService.listMyNotifications(currentUser._id);
  }

  @Get('admin/summary')
  @RequirePermissions('manage_orders')
  @ResponseMessage('Get admin notification summary')
  async getAdminSummary() {
    return this.notificationsService.getAdminSummary();
  }
}
