import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import { QueryFailedError, Repository } from 'typeorm';
import { ProductEntity } from '../products/entities/product.entity';
import { UserEntity } from '../users/entities/user.entity';
import {
  NotificationChannel,
  NotificationEntity,
  NotificationStatus,
} from './entities/notification.entity';

type CreateNotificationInput = {
  userId?: string | null;
  email?: string | null;
  channel?: NotificationChannel;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationsRepository: Repository<NotificationEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
    private readonly configService: ConfigService,
  ) {}

  async createNotification(input: CreateNotificationInput) {
    const notification = this.notificationsRepository.create({
      userId: input.userId ?? null,
      email: input.email ?? null,
      channel: input.channel ?? NotificationChannel.SYSTEM,
      status: NotificationStatus.PENDING,
      title: input.title,
      message: input.message,
      metadata: input.metadata ?? null,
      deliveryError: null,
      sentAt: null,
    });

    try {
      const saved = await this.notificationsRepository.save(notification);
      return this.dispatchNotification(saved);
    } catch (error) {
      if (this.isMissingNotificationsTable(error)) {
        this.logger.warn(
          'Notifications table is missing. Notification was skipped.',
        );
        return this.toFallbackResponse(notification);
      }

      throw error;
    }
  }

  async getAdminSummary() {
    try {
      const items = await this.notificationsRepository.find({
        where: [
          { channel: NotificationChannel.SYSTEM },
        ],
        order: { createdAt: 'DESC' },
        take: 20,
      });
      const dbNotifications = items.map((item) => this.toResponse(item));
      const lowStockAlerts = await this.getLowStockAlerts();
      const merged = [...dbNotifications, ...lowStockAlerts];
      merged.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
      return merged.slice(0, 30);
    } catch (error) {
      if (this.isMissingNotificationsTable(error)) {
        return [];
      }
      throw error;
    }
  }

  async getLowStockAlerts(): Promise<
    {
      id: string | null;
      userId: string | null;
      email: string | null;
      channel: NotificationChannel;
      status: NotificationStatus;
      title: string;
      message: string;
      metadata: Record<string, unknown> | null;
      deliveryError: string | null;
      sentAt: Date | null;
      createdAt: Date | null;
      updatedAt: Date | null;
    }[]
  > {
    try {
      const lowStockProducts = await this.productsRepository.find({
        where: { isShow: true },
        order: { quantityAvailable: 'ASC' },
        take: 10,
      });

      const filtered = lowStockProducts.filter(
        (p) => p.quantityAvailable <= 10,
      );

      return filtered.map((p) => ({
        id: `low-stock-${p.productId}`,
        userId: null,
        email: null,
        channel: NotificationChannel.SYSTEM,
        status: NotificationStatus.SENT,
        title: 'Sản phẩm sắp hết hàng',
        message: `${p.productName} chỉ còn ${p.quantityAvailable} đơn vị`,
        metadata: {
          productId: p.productId,
          type: 'low_stock',
          quantity: p.quantityAvailable,
        },
        deliveryError: null,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    } catch {
      return [];
    }
  }

  async listMyNotifications(userId: string) {
    try {
      const items = await this.notificationsRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      });

      return items.map((item) => this.toResponse(item));
    } catch (error) {
      if (this.isMissingNotificationsTable(error)) {
        this.logger.warn(
          'Notifications table is missing. Returning empty notifications list.',
        );
        return [];
      }

      throw error;
    }
  }

  async sendOrderCreatedNotification(userId: string, orderId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      return null;
    }

    return Promise.all([
      this.createNotification({
        userId,
        channel: NotificationChannel.SYSTEM,
        title: 'Don hang da duoc tao',
        message: `Don hang ${orderId} da duoc tao thanh cong.`,
        metadata: { orderId, type: 'order_created' },
      }),
      this.createNotification({
        userId,
        email: user.email,
        channel: NotificationChannel.EMAIL,
        title: 'Xac nhan don hang',
        message: `He thong da ghi nhan don hang ${orderId} cua ban.`,
        metadata: { orderId, type: 'order_created' },
      }),
    ]);
  }

  async sendOrderStatusNotification(
    userId: string,
    orderId: string,
    status: string,
  ) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      return null;
    }

    return Promise.all([
      this.createNotification({
        userId,
        channel: NotificationChannel.SYSTEM,
        title: 'Don hang da thay doi trang thai',
        message: `Don hang ${orderId} hien dang o trang thai ${status}.`,
        metadata: { orderId, status, type: 'order_status_changed' },
      }),
      this.createNotification({
        userId,
        email: user.email,
        channel: NotificationChannel.EMAIL,
        title: 'Cap nhat trang thai don hang',
        message: `Don hang ${orderId} da chuyen sang trang thai ${status}.`,
        metadata: { orderId, status, type: 'order_status_changed' },
      }),
    ]);
  }

  async sendPaymentNotification(
    userId: string,
    orderId: string,
    paymentStatus: string,
    provider: string,
  ) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      return null;
    }

    return Promise.all([
      this.createNotification({
        userId,
        channel: NotificationChannel.SYSTEM,
        title: 'Cap nhat thanh toan',
        message: `Thanh toan ${provider} cho don ${orderId} da o trang thai ${paymentStatus}.`,
        metadata: { orderId, paymentStatus, provider, type: 'payment_status' },
      }),
      this.createNotification({
        userId,
        email: user.email,
        channel: NotificationChannel.EMAIL,
        title: 'Cap nhat thanh toan don hang',
        message: `Don hang ${orderId} co ket qua thanh toan ${paymentStatus} qua ${provider}.`,
        metadata: { orderId, paymentStatus, provider, type: 'payment_status' },
      }),
    ]);
  }

  private async dispatchNotification(notification: NotificationEntity) {
    if (notification.channel === NotificationChannel.SYSTEM) {
      notification.status = NotificationStatus.SENT;
      notification.sentAt = new Date();
      return this.toResponse(
        await this.notificationsRepository.save(notification),
      );
    }

    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT') ?? '587');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const from =
      this.configService.get<string>('SMTP_FROM') ?? 'no-reply@example.com';

    if (!host || !user || !pass || !notification.email) {
      notification.status = NotificationStatus.SKIPPED;
      notification.deliveryError = 'SMTP not configured';
      return this.toResponse(
        await this.notificationsRepository.save(notification),
      );
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to: notification.email,
        subject: notification.title,
        text: notification.message,
      });

      notification.status = NotificationStatus.SENT;
      notification.sentAt = new Date();
      notification.deliveryError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notification.status = NotificationStatus.FAILED;
      notification.deliveryError = message;
      this.logger.error(`Failed to send email notification: ${message}`);
    }

    return this.toResponse(
      await this.notificationsRepository.save(notification),
    );
  }

  private toResponse(notification: NotificationEntity) {
    return {
      id: notification.notificationId,
      userId: notification.userId,
      email: notification.email,
      channel: notification.channel,
      status: notification.status,
      title: notification.title,
      message: notification.message,
      metadata: notification.metadata,
      deliveryError: notification.deliveryError,
      sentAt: notification.sentAt,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
  }

  private toFallbackResponse(notification: Partial<NotificationEntity>) {
    return {
      id: null,
      userId: notification.userId ?? null,
      email: notification.email ?? null,
      channel: notification.channel ?? NotificationChannel.SYSTEM,
      status: NotificationStatus.SKIPPED,
      title: notification.title ?? '',
      message: notification.message ?? '',
      metadata: notification.metadata ?? null,
      deliveryError: 'Notifications table is missing',
      sentAt: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  private isMissingNotificationsTable(error: unknown) {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as {
      code?: string;
      errno?: number;
      sqlMessage?: string;
    };

    return (
      driverError?.code === 'ER_NO_SUCH_TABLE' ||
      driverError?.errno === 1146 ||
      driverError?.sqlMessage?.includes(
        "Table 'agri_ecommerce.notifications_v2' doesn't exist",
      ) === true
    );
  }
}
