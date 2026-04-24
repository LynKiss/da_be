import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { LessThanOrEqual, Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import {
  CampaignStatus,
  NewsletterCampaignEntity,
} from './entities/newsletter-campaign.entity';
import {
  NewsletterSubscriberEntity,
  SubscriberStatus,
} from './entities/newsletter-subscriber.entity';

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(
    @InjectRepository(NewsletterSubscriberEntity)
    private readonly subscribersRepository: Repository<NewsletterSubscriberEntity>,
    @InjectRepository(NewsletterCampaignEntity)
    private readonly campaignsRepository: Repository<NewsletterCampaignEntity>,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
  ) {}

  async subscribe(email: string, name?: string) {
    const existing = await this.subscribersRepository.findOneBy({ email });
    if (existing) {
      if (existing.status === SubscriberStatus.ACTIVE) {
        return { message: 'Email da duoc dang ky' };
      }

      existing.status = SubscriberStatus.ACTIVE;
      existing.name = name ?? existing.name;
      await this.subscribersRepository.save(existing);
      return { message: 'Dang ky thanh cong' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const subscriber = this.subscribersRepository.create({
      email,
      name: name ?? null,
      status: SubscriberStatus.ACTIVE,
      unsubscribeToken: token,
    });
    await this.subscribersRepository.save(subscriber);

    return { message: 'Dang ky thanh cong' };
  }

  async unsubscribeByToken(token: string) {
    const subscriber = await this.subscribersRepository.findOneBy({
      unsubscribeToken: token,
    });
    if (!subscriber) {
      throw new NotFoundException('Token khong hop le');
    }

    subscriber.status = SubscriberStatus.UNSUBSCRIBED;
    await this.subscribersRepository.save(subscriber);
    return { message: 'Huy dang ky thanh cong' };
  }

  async findSubscribers(page: number, limit: number, status?: string) {
    const qb = this.subscribersRepository
      .createQueryBuilder('s')
      .orderBy('s.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      qb.andWhere('s.status = :status', { status });
    }

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((subscriber) => this.mapSubscriber(subscriber)),
      total,
      page,
      limit,
    };
  }

  async deleteSubscriber(subscriberId: string) {
    const subscriber = await this.subscribersRepository.findOneBy({
      subscriberId,
    });
    if (!subscriber) {
      throw new NotFoundException('Khong tim thay nguoi dang ky');
    }

    await this.subscribersRepository.delete({ subscriberId });
    return { success: true };
  }

  async createCampaign(subject: string, body: string, scheduledAt?: Date | null) {
    const nextScheduledAt = this.normalizeScheduledAt(scheduledAt);
    const status = nextScheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT;

    const campaign = this.campaignsRepository.create({
      subject,
      body,
      status,
      sentAt: null,
      scheduledAt: nextScheduledAt,
      recipientCount: 0,
      totalRecipientCount: 0,
    });
    const saved = await this.campaignsRepository.save(campaign);
    return this.mapCampaign(saved);
  }

  async updateCampaign(
    campaignId: string,
    subject: string,
    body: string,
    scheduledAt?: Date | null,
  ) {
    const campaign = await this.campaignsRepository.findOneBy({ campaignId });
    if (!campaign) {
      throw new NotFoundException('Khong tim thay chien dich');
    }

    if (campaign.status === CampaignStatus.SENT) {
      throw new BadRequestException('Khong the chinh sua chien dich da gui');
    }

    const nextScheduledAt = this.normalizeScheduledAt(scheduledAt);
    campaign.subject = subject;
    campaign.body = body;
    campaign.scheduledAt = nextScheduledAt;
    campaign.status = nextScheduledAt
      ? CampaignStatus.SCHEDULED
      : CampaignStatus.DRAFT;

    const saved = await this.campaignsRepository.save(campaign);
    return this.mapCampaign(saved);
  }

  async deleteCampaign(campaignId: string) {
    const campaign = await this.campaignsRepository.findOneBy({ campaignId });
    if (!campaign) {
      throw new NotFoundException('Khong tim thay chien dich');
    }

    if (campaign.status === CampaignStatus.SENT) {
      throw new BadRequestException('Khong the xoa chien dich da gui');
    }

    await this.campaignsRepository.delete({ campaignId });
    return { success: true };
  }

  async findCampaigns() {
    const campaigns = await this.campaignsRepository.find({
      order: { createdAt: 'DESC' },
    });
    return campaigns.map((campaign) => this.mapCampaign(campaign));
  }

  async getAutomationSettings() {
    const [storedSmtp, resolvedSmtp, totalScheduled, nextScheduledCampaign] =
      await Promise.all([
        this.settingsService.getSmtpSettings(),
        this.settingsService.getResolvedSmtpConfig(),
        this.campaignsRepository.count({
          where: { status: CampaignStatus.SCHEDULED },
        }),
        this.campaignsRepository.findOne({
          where: { status: CampaignStatus.SCHEDULED },
          order: { scheduledAt: 'ASC' },
        }),
      ]);

    return {
      smtp: this.mapAutomationSmtp(storedSmtp, resolvedSmtp),
      scheduler: {
        isEnabled: true,
        cron: '* * * * *',
        intervalMinutes: 1,
      },
      scheduledCampaigns: {
        total: totalScheduled,
        nextScheduledAt: nextScheduledCampaign?.scheduledAt ?? null,
      },
    };
  }

  async updateAutomationSmtpSettings(value: unknown) {
    const storedSmtp = await this.settingsService.saveSmtpSettings(value);
    const resolvedSmtp = await this.settingsService.getResolvedSmtpConfig();

    return this.mapAutomationSmtp(storedSmtp, resolvedSmtp);
  }

  async sendCampaign(campaignId: string) {
    const campaign = await this.campaignsRepository.findOneBy({ campaignId });
    if (!campaign) {
      throw new NotFoundException('Khong tim thay chien dich');
    }

    if (campaign.status === CampaignStatus.SENT) {
      throw new BadRequestException('Chien dich da duoc gui');
    }

    const subscribers = await this.subscribersRepository.find({
      where: { status: SubscriberStatus.ACTIVE },
    });

    if (subscribers.length === 0) {
      return { sent: 0, message: 'Khong co nguoi dang ky nao' };
    }

    const mailer = await this.getMailer();
    if (!mailer) {
      throw new BadRequestException('SMTP chua duoc cau hinh');
    }

    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    let sent = 0;

    // Send in batches to avoid spam filters — 10 mails per batch, 1.5s between batches
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1500;
    const INTER_EMAIL_DELAY_MS = 150;

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE);

      for (const subscriber of batch) {
        try {
          const unsubscribeUrl = `${backendUrl}/api/v1/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}`;
          await mailer.transporter.sendMail({
            from: mailer.from,
            to: subscriber.email,
            subject: campaign.subject,
            html: this.wrapCampaignHtml(
              campaign.body,
              campaign.subject,
              unsubscribeUrl,
            ),
          });
          sent++;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to send campaign ${campaignId} to ${subscriber.email}: ${message}`,
          );
        }
        // Small pause between individual emails within a batch
        await new Promise((resolve) => setTimeout(resolve, INTER_EMAIL_DELAY_MS));
      }

      // Pause between batches (skip after the last batch)
      if (i + BATCH_SIZE < subscribers.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    campaign.status = CampaignStatus.SENT;
    campaign.sentAt = new Date();
    campaign.recipientCount = sent;
    campaign.totalRecipientCount = subscribers.length;
    await this.campaignsRepository.save(campaign);

    return { sent, total: subscribers.length };
  }

  @Cron('* * * * *')
  async checkScheduledCampaigns() {
    const dueCampaigns = await this.campaignsRepository.find({
      where: {
        status: CampaignStatus.SCHEDULED,
        scheduledAt: LessThanOrEqual(new Date()),
      },
    });

    for (const campaign of dueCampaigns) {
      const claimed = await this.campaignsRepository.update(
        {
          campaignId: campaign.campaignId,
          status: CampaignStatus.SCHEDULED,
        },
        { status: CampaignStatus.DRAFT },
      );

      if ((claimed.affected ?? 0) === 0) {
        continue;
      }

      try {
        await this.sendCampaign(campaign.campaignId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Scheduled send failed for ${campaign.campaignId}: ${message}`,
        );
        await this.campaignsRepository.update(
          { campaignId: campaign.campaignId },
          { status: CampaignStatus.SCHEDULED },
        );
      }
    }
  }

  async notifyNewArticle(title: string, slug: string, excerpt: string) {
    const subscribers = await this.subscribersRepository.find({
      where: { status: SubscriberStatus.ACTIVE },
    });
    if (!subscribers.length) {
      return;
    }

    const mailer = await this.getMailer();
    if (!mailer) {
      return;
    }

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';

    const articleUrl = `${frontendUrl}/client/news/${slug}`;
    const subject = `Bài viết mới: ${title}`;
    const body = `<p>${excerpt}</p><p><a href="${articleUrl}" style="color:#006241;font-weight:bold;">Đọc bài viết →</a></p>`;

    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1500;
    const INTER_EMAIL_DELAY_MS = 150;

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE);
      for (const subscriber of batch) {
        const unsubscribeUrl = `${backendUrl}/api/v1/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}`;
        try {
          await mailer.transporter.sendMail({
            from: mailer.from,
            to: subscriber.email,
            subject,
            html: this.wrapCampaignHtml(body, subject, unsubscribeUrl),
          });
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, INTER_EMAIL_DELAY_MS));
      }
      if (i + BATCH_SIZE < subscribers.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
  }

  private async getMailer() {
    const smtp = await this.settingsService.getResolvedSmtpConfig();
    if (!smtp.host || !smtp.user || !smtp.pass) {
      return null;
    }

    return {
      from: smtp.from,
      transporter: nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
      }),
    };
  }

  private wrapCampaignHtml(body: string, subject: string, unsubscribeUrl: string) {
    return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f0eb;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0eb;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px">
        <tr><td style="background:#1E3932;padding:24px 32px">
          <p style="margin:0;color:#D4E9E2;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Nong nghiep Viet</p>
          <h1 style="margin:4px 0 0;color:#fff;font-size:22px">${subject}</h1>
        </td></tr>
        <tr><td style="padding:32px;color:#374151;font-size:15px;line-height:1.7">
          ${body}
        </td></tr>
        <tr><td style="background:#f9f9f9;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb">
          <p style="margin:0;color:#9ca3af;font-size:12px">
            Ban nhan email nay vi da dang ky nhan tin tuc tu chung toi.<br>
            <a href="${unsubscribeUrl}" style="color:#006241">Huy dang ky</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private mapSubscriber(subscriber: NewsletterSubscriberEntity) {
    return {
      id: subscriber.subscriberId,
      email: subscriber.email,
      name: subscriber.name,
      status: subscriber.status,
      createdAt: subscriber.createdAt,
    };
  }

  private mapCampaign(campaign: NewsletterCampaignEntity) {
    return {
      id: campaign.campaignId,
      subject: campaign.subject,
      body: campaign.body,
      status: campaign.status,
      sentAt: campaign.sentAt,
      scheduledAt: campaign.scheduledAt,
      recipientCount: campaign.recipientCount,
      totalRecipientCount: campaign.totalRecipientCount,
      createdAt: campaign.createdAt,
    };
  }

  private mapAutomationSmtp(
    storedSmtp: Awaited<ReturnType<SettingsService['getSmtpSettings']>>,
    resolvedSmtp: Awaited<ReturnType<SettingsService['getResolvedSmtpConfig']>>,
  ) {
    const hasStoredConfig = Boolean(
      storedSmtp.host || storedSmtp.user || storedSmtp.pass || storedSmtp.from,
    );
    const hasResolvedConfig = Boolean(
      resolvedSmtp.host && resolvedSmtp.user && resolvedSmtp.pass,
    );

    return {
      ...storedSmtp,
      isConfigured: hasResolvedConfig,
      source: hasStoredConfig ? 'settings' : hasResolvedConfig ? 'env' : 'none',
    };
  }

  private normalizeScheduledAt(scheduledAt?: Date | null) {
    if (!scheduledAt) {
      return null;
    }

    const nextDate =
      scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
    if (Number.isNaN(nextDate.getTime())) {
      throw new BadRequestException('Thoi gian len lich khong hop le');
    }

    if (nextDate.getTime() <= Date.now()) {
      throw new BadRequestException('Thoi gian len lich phai o tuong lai');
    }

    return nextDate;
  }
}
