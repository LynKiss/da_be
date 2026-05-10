import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { MembershipService } from './membership.service';

@Controller('membership')
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  @Get('my-tier')
  @ResponseMessage('Lấy thông tin hạng thành viên thành công')
  getMyTier(@User() currentUser: IUser) {
    return this.membershipService.getMyTier(currentUser._id);
  }

  @Get('admin/overview')
  @ResponseMessage('Lấy danh sách thành viên thành công')
  getAdminOverview(
    @Query('tier') tier?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.membershipService.getAdminOverview({
      tier,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @Patch('admin/:userId/set-tier/:tier')
  @ResponseMessage('Cập nhật hạng thành viên thành công')
  setTier(@Param('userId') userId: string, @Param('tier') tier: string) {
    return this.membershipService.adminSetTier(userId, tier);
  }

  @Patch('admin/:userId/recalculate')
  @ResponseMessage('Đã tính lại hạng thành viên')
  recalculateOne(@Param('userId') userId: string) {
    return this.membershipService.recalculateAndReward(userId);
  }

  @Patch('admin/recalculate-all')
  @ResponseMessage('Đã tính lại hạng cho tất cả thành viên')
  recalculateAll() {
    return this.membershipService.recalculateAll();
  }

  @Get('admin/tier-config')
  @ResponseMessage('Lấy cấu hình hạng thành viên thành công')
  getTierConfig() {
    return this.membershipService.getTierConfig();
  }

  @Patch('admin/tier-config')
  @ResponseMessage('Đã lưu cấu hình hạng thành viên')
  saveTierConfig(@Body() body: unknown) {
    return this.membershipService.saveTierConfig(body);
  }
}
