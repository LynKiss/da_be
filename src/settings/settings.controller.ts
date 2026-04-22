import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  Public,
  RequirePermissions,
  ResponseMessage,
} from '../decorator/customize';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('public/commerce')
  @ResponseMessage('Get public commerce settings')
  getPublicCommerceSettings() {
    return this.settingsService.getPublicCommerceSettings();
  }

  @RequirePermissions('manage_settings')
  @Get('admin/commerce')
  @ResponseMessage('Get commerce settings')
  getAdminCommerceSettings() {
    return this.settingsService.getAdminCommerceSettings();
  }

  @RequirePermissions('manage_settings')
  @Put('admin/payments')
  @ResponseMessage('Update payment settings')
  updatePaymentSettings(@Body() body: { payments?: Record<string, unknown> }) {
    return this.settingsService.savePaymentSettings(body.payments ?? {});
  }

  @RequirePermissions('manage_settings')
  @Put('admin/smtp')
  @ResponseMessage('Update SMTP settings')
  updateSmtpSettings(@Body() body: { smtp?: Record<string, unknown> }) {
    return this.settingsService.saveSmtpSettings(body.smtp ?? {});
  }
}
