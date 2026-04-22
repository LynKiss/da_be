import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NewsletterCampaignEntity } from './entities/newsletter-campaign.entity';
import { NewsletterSubscriberEntity } from './entities/newsletter-subscriber.entity';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([NewsletterSubscriberEntity, NewsletterCampaignEntity]),
  ],
  controllers: [NewsletterController],
  providers: [NewsletterService],
  exports: [NewsletterService],
})
export class NewsletterModule {}
