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

  @Public()
  @Post('subscribe')
  @ResponseMessage('Dang ky nhan tin thanh cong')
  subscribe(@Body() body: { email: string; name?: string }) {
    return this.newsletterService.subscribe(body.email, body.name);
  }

  @Public()
  @Get('unsubscribe')
  @ResponseMessage('Huy dang ky thanh cong')
  unsubscribe(@Query('token') token: string) {
    return this.newsletterService.unsubscribeByToken(token);
  }

  @RequirePermissions('manage_orders')
  @Get('subscribers')
  @ResponseMessage('Danh sach nguoi dang ky')
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
  @ResponseMessage('Xoa nguoi dang ky thanh cong')
  deleteSubscriber(@Param('id') id: string) {
    return this.newsletterService.deleteSubscriber(id);
  }

  @RequirePermissions('manage_orders')
  @Get('campaigns')
  @ResponseMessage('Danh sach chien dich')
  getCampaigns() {
    return this.newsletterService.findCampaigns();
  }

  @RequirePermissions('manage_orders')
  @Get('automation')
  @ResponseMessage('Cau hinh gui mail tu dong')
  getAutomationSettings() {
    return this.newsletterService.getAutomationSettings();
  }

  @RequirePermissions('manage_orders')
  @Post('campaigns')
  @ResponseMessage('Tao chien dich thanh cong')
  createCampaign(
    @Body() body: { subject: string; body: string; scheduledAt?: string },
  ) {
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    return this.newsletterService.createCampaign(
      body.subject,
      body.body,
      scheduledAt,
    );
  }

  @RequirePermissions('manage_orders')
  @Put('campaigns/:id')
  @ResponseMessage('Cap nhat chien dich thanh cong')
  updateCampaign(
    @Param('id') id: string,
    @Body() body: { subject: string; body: string; scheduledAt?: string },
  ) {
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    return this.newsletterService.updateCampaign(
      id,
      body.subject,
      body.body,
      scheduledAt,
    );
  }

  @RequirePermissions('manage_orders')
  @Put('automation/smtp')
  @ResponseMessage('Cap nhat cau hinh SMTP thanh cong')
  updateAutomationSmtpSettings(
    @Body() body: { smtp?: Record<string, unknown> },
  ) {
    return this.newsletterService.updateAutomationSmtpSettings(
      body.smtp ?? {},
    );
  }

  @RequirePermissions('manage_orders')
  @Delete('campaigns/:id')
  @ResponseMessage('Xoa chien dich thanh cong')
  deleteCampaign(@Param('id') id: string) {
    return this.newsletterService.deleteCampaign(id);
  }

  @RequirePermissions('manage_orders')
  @Post('campaigns/:id/send')
  @ResponseMessage('Gui chien dich thanh cong')
  sendCampaign(@Param('id') id: string) {
    return this.newsletterService.sendCampaign(id);
  }
}
