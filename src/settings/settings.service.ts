import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { SystemSettingEntity } from './entities/system-setting.entity';

export const PAYMENT_METHOD_KEYS = [
  'cod',
  'bank_transfer',
  'momo',
  'vnpay',
  'zalopay',
] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

export type PaymentMethodConfig = {
  isActive: boolean;
  description: string;
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  partnerCode?: string;
  accessKey?: string;
  secretKey?: string;
  tmnCode?: string;
  hashSecret?: string;
  appId?: string;
  key1?: string;
  key2?: string;
};

export type PaymentSettings = Record<PaymentMethodKey, PaymentMethodConfig>;

export type PublicPaymentMethodConfig = Pick<
  PaymentMethodConfig,
  'isActive' | 'description' | 'bankName' | 'accountNumber' | 'accountHolder'
>;

export type PublicPaymentSettings = Record<
  PaymentMethodKey,
  PublicPaymentMethodConfig
>;

export type SmtpSettings = {
  host: string;
  port: string;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
};

const PAYMENT_SETTINGS_KEY = 'commerce_payments';
const SMTP_SETTINGS_KEY = 'commerce_smtp';

export const createDefaultPaymentSettings = (): PaymentSettings => ({
  cod: {
    isActive: true,
    description: 'Khach hang thanh toan khi nhan hang.',
  },
  bank_transfer: {
    isActive: true,
    description: 'Chuyen khoan ngan hang va doi doi chieu giao dich.',
    bankName: '',
    accountNumber: '',
    accountHolder: '',
  },
  momo: {
    isActive: false,
    description: 'Thanh toan qua vi MoMo.',
    partnerCode: '',
    accessKey: '',
    secretKey: '',
  },
  vnpay: {
    isActive: false,
    description: 'Thanh toan qua cong VNPay.',
    tmnCode: '',
    hashSecret: '',
  },
  zalopay: {
    isActive: false,
    description: 'Thanh toan qua vi ZaloPay.',
    appId: '',
    key1: '',
    key2: '',
  },
});

export const createDefaultSmtpSettings = (): SmtpSettings => ({
  host: '',
  port: '587',
  user: '',
  pass: '',
  from: '',
  secure: false,
});

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(SystemSettingEntity)
    private readonly settingsRepository: Repository<SystemSettingEntity>,
    private readonly configService: ConfigService,
  ) {}

  async getAdminCommerceSettings() {
    const [payments, smtp] = await Promise.all([
      this.getPaymentSettings(),
      this.getSmtpSettings(),
    ]);

    return { payments, smtp };
  }

  async getPublicCommerceSettings() {
    const payments = await this.getPaymentSettings();

    const publicPayments = PAYMENT_METHOD_KEYS.reduce<PublicPaymentSettings>(
      (accumulator, key) => {
        const current = payments[key];
        accumulator[key] = {
          isActive: current.isActive,
          description: current.description,
          bankName: current.bankName ?? '',
          accountNumber: current.accountNumber ?? '',
          accountHolder: current.accountHolder ?? '',
        };
        return accumulator;
      },
      this.createDefaultPublicPaymentSettings(),
    );

    return { payments: publicPayments };
  }

  async getPaymentSettings() {
    return this.getJsonSetting(
      PAYMENT_SETTINGS_KEY,
      createDefaultPaymentSettings(),
      (value) => this.normalizePaymentSettings(value),
    );
  }

  async savePaymentSettings(value: unknown) {
    const nextValue = this.normalizePaymentSettings(value);
    await this.saveJsonSetting(PAYMENT_SETTINGS_KEY, nextValue);
    return nextValue;
  }

  async getSmtpSettings() {
    return this.getJsonSetting(
      SMTP_SETTINGS_KEY,
      createDefaultSmtpSettings(),
      (value) => this.normalizeSmtpSettings(value),
    );
  }

  async saveSmtpSettings(value: unknown) {
    const nextValue = this.normalizeSmtpSettings(value);
    await this.saveJsonSetting(SMTP_SETTINGS_KEY, nextValue);
    return nextValue;
  }

  async getResolvedSmtpConfig() {
    const smtp = await this.getSmtpSettings();
    const port = Number(
      smtp.port || this.configService.get<string>('SMTP_PORT') || '587',
    );

    return {
      host: smtp.host || this.configService.get<string>('SMTP_HOST') || '',
      port,
      user: smtp.user || this.configService.get<string>('SMTP_USER') || '',
      pass: smtp.pass || this.configService.get<string>('SMTP_PASS') || '',
      from:
        smtp.from ||
        this.configService.get<string>('SMTP_FROM') ||
        'no-reply@example.com',
      secure: smtp.secure || port === 465,
    };
  }

  async getMomoConfig() {
    const payments = await this.getPaymentSettings();
    const momo = payments.momo;

    return {
      partnerCode:
        momo.partnerCode ||
        this.configService.get<string>('MOMO_PARTNER_CODE') ||
        '',
      accessKey:
        momo.accessKey || this.configService.get<string>('MOMO_ACCESS_KEY') || '',
      secretKey:
        momo.secretKey || this.configService.get<string>('MOMO_SECRET_KEY') || '',
    };
  }

  async isPaymentMethodActive(method: string) {
    if (!PAYMENT_METHOD_KEYS.includes(method as PaymentMethodKey)) {
      return false;
    }

    const payments = await this.getPaymentSettings();
    return payments[method as PaymentMethodKey]?.isActive ?? false;
  }

  private createDefaultPublicPaymentSettings(): PublicPaymentSettings {
    const defaults = createDefaultPaymentSettings();

    return PAYMENT_METHOD_KEYS.reduce<PublicPaymentSettings>((accumulator, key) => {
      accumulator[key] = {
        isActive: defaults[key].isActive,
        description: defaults[key].description,
        bankName: defaults[key].bankName ?? '',
        accountNumber: defaults[key].accountNumber ?? '',
        accountHolder: defaults[key].accountHolder ?? '',
      };
      return accumulator;
    }, {} as PublicPaymentSettings);
  }

  private normalizePaymentSettings(value: unknown): PaymentSettings {
    const source = this.asRecord(value);
    const defaults = createDefaultPaymentSettings();

    return PAYMENT_METHOD_KEYS.reduce<PaymentSettings>((accumulator, key) => {
      const current = this.asRecord(source?.[key]);
      const fallback = defaults[key];
      accumulator[key] = {
        ...fallback,
        isActive: this.asBoolean(current?.isActive, fallback.isActive),
        description: this.asString(current?.description) || fallback.description,
        bankName: this.asString(current?.bankName),
        accountNumber: this.asString(current?.accountNumber),
        accountHolder: this.asString(current?.accountHolder),
        partnerCode: this.asString(current?.partnerCode),
        accessKey: this.asString(current?.accessKey),
        secretKey: this.asString(current?.secretKey),
        tmnCode: this.asString(current?.tmnCode),
        hashSecret: this.asString(current?.hashSecret),
        appId: this.asString(current?.appId),
        key1: this.asString(current?.key1),
        key2: this.asString(current?.key2),
      };
      return accumulator;
    }, createDefaultPaymentSettings());
  }

  private normalizeSmtpSettings(value: unknown): SmtpSettings {
    const source = this.asRecord(value);
    const defaults = createDefaultSmtpSettings();

    return {
      host: this.asString(source?.host),
      port: this.asString(source?.port) || defaults.port,
      user: this.asString(source?.user),
      pass: this.asString(source?.pass),
      from: this.asString(source?.from),
      secure: this.asBoolean(source?.secure, defaults.secure),
    };
  }

  private async getJsonSetting<T>(
    key: string,
    fallback: T,
    normalize: (value: unknown) => T,
  ): Promise<T> {
    try {
      const current = await this.settingsRepository.findOneBy({ settingKey: key });
      if (!current) {
        return fallback;
      }

      return normalize(JSON.parse(current.settingValue) as unknown);
    } catch (error) {
      if (this.isMissingSettingsTable(error)) {
        this.logger.warn(
          'System settings table is missing. Returning default configuration.',
        );
        return fallback;
      }

      if (error instanceof SyntaxError) {
        return fallback;
      }

      throw error;
    }
  }

  private async saveJsonSetting(key: string, value: unknown) {
    try {
      const current = await this.settingsRepository.findOneBy({ settingKey: key });
      if (current) {
        current.settingValue = JSON.stringify(value);
        await this.settingsRepository.save(current);
        return;
      }

      await this.settingsRepository.save(
        this.settingsRepository.create({
          settingKey: key,
          settingValue: JSON.stringify(value),
        }),
      );
    } catch (error) {
      if (this.isMissingSettingsTable(error)) {
        throw new BadRequestException(
          'Bang system_settings chua ton tai. Hay chay updatev8_system_settings.sql truoc.',
        );
      }

      throw error;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asBoolean(value: unknown, fallback: boolean) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return fallback;
  }

  private isMissingSettingsTable(error: unknown) {
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
        "Table 'agri_ecommerce.system_settings' doesn't exist",
      ) === true
    );
  }
}
