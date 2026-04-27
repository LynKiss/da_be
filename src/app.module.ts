import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging/logging.interceptor';
import { HealthModule } from './health/health.module';
import { IntelligenceModule } from './intelligence/intelligence.module';
import { typeOrmConfig } from './config/typeorm.config';
import { DatabasesModule } from './databases/databases.module';
import { PermissionsModule } from './permissions/permissions.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { CartsModule } from './carts/carts.module';
import { OrdersModule } from './orders/orders.module';
import { DiscountsModule } from './discounts/discounts.module';
import { NewsModule } from './news/news.module';
import { CommentsModule } from './comments/comments.module';
import { ContactsModule } from './contacts/contacts.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { RiceDiagnosisModule } from './rice-diagnosis/rice-diagnosis.module';
import { SettingsModule } from './settings/settings.module';
import { SupportChatModule } from './support-chat/support-chat.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ProcurementModule } from './procurement/procurement.module';
import { PricingModule } from './pricing/pricing.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { CreditLimitsModule } from './credit-limits/credit-limits.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AdminSearchModule } from './admin-search/admin-search.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync(typeOrmConfig),
    CommonModule,
    AuthModule,
    DatabasesModule,
    PermissionsModule,
    CategoriesModule,
    ProductsModule,
    CartsModule,
    OrdersModule,
    DiscountsModule,
    NewsModule,
    CommentsModule,
    ContactsModule,
    NotificationsModule,
    ReportsModule,
    NewsletterModule,
    RiceDiagnosisModule,
    SettingsModule,
    SupportChatModule,
    SuppliersModule,
    ProcurementModule,
    PricingModule,
    WarehousesModule,
    CreditLimitsModule,
    AuditLogsModule,
    AdminSearchModule,
    IntelligenceModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
