import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  Public,
  RequirePermissions,
  ResponseMessage,
} from '../decorator/customize';
import { NewsletterService } from './newsletter.service';

@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  // ─── PUBLIC ──────────────────────────────────────────────────────────────────

  @Public()
  @Post('subscribe')
  @ResponseMessage('Đăng ký nhận tin thành công')
  subscribe(@Body() body: { email: string; name?: string }) {
    return this.newsletterService.subscribe(body.email, body.name);
  }

  @Public()
  @Get('unsubscribe')
  @ResponseMessage('Hủy đăng ký thành công')
  unsubscribe(@Query('token') token: string) {
    return this.newsletterService.unsubscribeByToken(token);
  }

  // ─── ADMIN ────────────────────────────────────────────────────────────────────

  @RequirePermissions('manage_orders')
  @Get('subscribers')
  @ResponseMessage('Danh sách người đăng ký')
  getSubscribers(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('status') status?: string,
  ) {
    return this.newsletterService.findSubscribers(
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(200, Math.max(1, parseInt(limit, 10) || 50)),
      status,
    );
  }

  @RequirePermissions('manage_orders')
  @Delete('subscribers/:id')
  @ResponseMessage('Xóa người đăng ký thành công')
  deleteSubscriber(@Param('id') id: string) {
    return this.newsletterService.deleteSubscriber(id);
  }

  @RequirePermissions('manage_orders')
  @Get('campaigns')
  @ResponseMessage('Danh sách chiến dịch')
  getCampaigns() {
    return this.newsletterService.findCampaigns();
  }

  @RequirePermissions('manage_orders')
  @Post('campaigns')
  @ResponseMessage('Tạo chiến dịch thành công')
  createCampaign(@Body() body: { subject: string; body: string }) {
    return this.newsletterService.createCampaign(body.subject, body.body);
  }

  @RequirePermissions('manage_orders')
  @Put('campaigns/:id')
  @ResponseMessage('Cập nhật chiến dịch thành công')
  updateCampaign(
    @Param('id') id: string,
    @Body() body: { subject: string; body: string },
  ) {
    return this.newsletterService.updateCampaign(id, body.subject, body.body);
  }

  @RequirePermissions('manage_orders')
  @Delete('campaigns/:id')
  @ResponseMessage('Xóa chiến dịch thành công')
  deleteCampaign(@Param('id') id: string) {
    return this.newsletterService.deleteCampaign(id);
  }

  @RequirePermissions('manage_orders')
  @Post('campaigns/:id/send')
  @ResponseMessage('Gửi chiến dịch thành công')
  sendCampaign(@Param('id') id: string) {
    return this.newsletterService.sendCampaign(id);
  }
}
