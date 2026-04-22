import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { Repository } from 'typeorm';
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
  ) {}

  // ─── PUBLIC ──────────────────────────────────────────────────────────────────

  async subscribe(email: string, name?: string) {
    const existing = await this.subscribersRepository.findOneBy({ email });
    if (existing) {
      if (existing.status === SubscriberStatus.ACTIVE) {
        return { message: 'Email đã được đăng ký' };
      }
      existing.status = SubscriberStatus.ACTIVE;
      existing.name = name ?? existing.name;
      await this.subscribersRepository.save(existing);
      return { message: 'Đăng ký thành công' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const subscriber = this.subscribersRepository.create({
      email,
      name: name ?? null,
      status: SubscriberStatus.ACTIVE,
      unsubscribeToken: token,
    });
    await this.subscribersRepository.save(subscriber);
    return { message: 'Đăng ký thành công' };
  }

  async unsubscribeByToken(token: string) {
    const subscriber = await this.subscribersRepository.findOneBy({
      unsubscribeToken: token,
    });
    if (!subscriber) throw new NotFoundException('Token không hợp lệ');
    subscriber.status = SubscriberStatus.UNSUBSCRIBED;
    await this.subscribersRepository.save(subscriber);
    return { message: 'Hủy đăng ký thành công' };
  }

  // ─── ADMIN ────────────────────────────────────────────────────────────────────

  async findSubscribers(page: number, limit: number, status?: string) {
    const qb = this.subscribersRepository
      .createQueryBuilder('s')
      .orderBy('s.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('s.status = :status', { status });

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((s) => this.mapSubscriber(s)),
      total,
      page,
      limit,
    };
  }

  async deleteSubscriber(subscriberId: string) {
    const subscriber = await this.subscribersRepository.findOneBy({ subscriberId });
    if (!subscriber) throw new NotFoundException('Không tìm thấy người đăng ký');
    await this.subscribersRepository.delete({ subscriberId });
    return { success: true };
  }

  async createCampaign(subject: string, body: string) {
    const campaign = this.campaignsRepository.create({
      subject,
      body,
      status: CampaignStatus.DRAFT,
      sentAt: null,
      recipientCount: 0,
    });
    const saved = await this.campaignsRepository.save(campaign);
    return this.mapCampaign(saved);
  }

  async updateCampaign(campaignId: string, subject: string, body: string) {
    const campaign = await this.campaignsRepository.findOneBy({ campaignId });
    if (!campaign) throw new NotFoundException('Không tìm thấy chiến dịch');
    if (campaign.status === CampaignStatus.SENT) {
      throw new BadRequestException('Không thể chỉnh sửa chiến dịch đã gửi');
    }
    campaign.subject = subject;
    campaign.body = body;
    const saved = await this.campaignsRepository.save(campaign);
    return this.mapCampaign(saved);
  }

  async deleteCampaign(campaignId: string) {
    const campaign = await this.campaignsRepository.findOneBy({ campaignId });
    if (!campaign) throw new NotFoundException('Không tìm thấy chiến dịch');
    if (campaign.status === CampaignStatus.SENT) {
      throw new BadRequestException('Không thể xóa chiến dịch đã gửi');
    }
    await this.campaignsRepository.delete({ campaignId });
    return { success: true };
  }

  async findCampaigns() {
    const campaigns = await this.campaignsRepository.find({
      order: { createdAt: 'DESC' },
    });
    return campaigns.map((c) => this.mapCampaign(c));
  }

  async sendCampaign(campaignId: string) {
    const campaign = await this.campaignsRepository.findOneBy({ campaignId });
    if (!campaign) throw new NotFoundException('Không tìm thấy chiến dịch');
    if (campaign.status === CampaignStatus.SENT) {
      throw new BadRequestException('Chiến dịch đã được gửi');
    }

    const subscribers = await this.subscribersRepository.find({
      where: { status: SubscriberStatus.ACTIVE },
    });

    if (subscribers.length === 0) {
      return { sent: 0, message: 'Không có người đăng ký nào' };
    }

    const transporter = this.createTransporter();
    if (!transporter) {
      throw new BadRequestException('SMTP chưa được cấu hình');
    }

    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    let sent = 0;

    await Promise.allSettled(
      subscribers.map(async (sub) => {
        try {
          const unsubscribeUrl = `${backendUrl}/api/v1/newsletter/unsubscribe?token=${sub.unsubscribeToken}`;
          await transporter.sendMail({
            from: this.configService.get<string>('SMTP_FROM') ?? 'no-reply@example.com',
            to: sub.email,
            subject: campaign.subject,
            html: this.wrapCampaignHtml(campaign.body, campaign.subject, unsubscribeUrl),
          });
          sent++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to send to ${sub.email}: ${msg}`);
        }
      }),
    );

    campaign.status = CampaignStatus.SENT;
    campaign.sentAt = new Date();
    campaign.recipientCount = sent;
    await this.campaignsRepository.save(campaign);

    return { sent, total: subscribers.length };
  }

  // Called from NewsService when an article is published
  async notifyNewArticle(title: string, slug: string, excerpt: string) {
    const subscribers = await this.subscribersRepository.find({
      where: { status: SubscriberStatus.ACTIVE },
    });
    if (!subscribers.length) return;

    const transporter = this.createTransporter();
    if (!transporter) return;

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';

    const articleUrl = `${frontendUrl}/client/news/${slug}`;
    const subject = `Bài viết mới: ${title}`;
    const body = `<p>${excerpt}</p><p><a href="${articleUrl}" style="color:#006241;font-weight:bold;">Đọc bài viết →</a></p>`;

    await Promise.allSettled(
      subscribers.map(async (sub) => {
        const unsubscribeUrl = `${backendUrl}/api/v1/newsletter/unsubscribe?token=${sub.unsubscribeToken}`;
        try {
          await transporter.sendMail({
            from: this.configService.get<string>('SMTP_FROM') ?? 'no-reply@example.com',
            to: sub.email,
            subject,
            html: this.wrapCampaignHtml(body, subject, unsubscribeUrl),
          });
        } catch {}
      }),
    );
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────────

  private createTransporter() {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT') ?? '587');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    if (!host || !user || !pass) return null;
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
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
          <p style="margin:0;color:#D4E9E2;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Nông nghiệp Việt</p>
          <h1 style="margin:4px 0 0;color:#fff;font-size:22px">${subject}</h1>
        </td></tr>
        <tr><td style="padding:32px;color:#374151;font-size:15px;line-height:1.7">
          ${body}
        </td></tr>
        <tr><td style="background:#f9f9f9;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb">
          <p style="margin:0;color:#9ca3af;font-size:12px">
            Bạn nhận email này vì đã đăng ký nhận tin tức từ chúng tôi.<br>
            <a href="${unsubscribeUrl}" style="color:#006241">Hủy đăng ký</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private mapSubscriber(s: NewsletterSubscriberEntity) {
    return {
      id: s.subscriberId,
      email: s.email,
      name: s.name,
      status: s.status,
      createdAt: s.createdAt,
    };
  }

  private mapCampaign(c: NewsletterCampaignEntity) {
    return {
      id: c.campaignId,
      subject: c.subject,
      body: c.body,
      status: c.status,
      sentAt: c.sentAt,
      recipientCount: c.recipientCount,
      createdAt: c.createdAt,
    };
  }
}
