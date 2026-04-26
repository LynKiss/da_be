import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CartsModule } from '../carts/carts.module';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { RolesModule } from '../roles/roles.module';
import { UserEntity } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { SupportBotService } from './support-bot.service';
import { SupportChatController } from './support-chat.controller';
import { SupportChatGateway } from './support-chat.gateway';
import { SupportChatPublisher } from './support-chat.publisher';
import { SupportChatService } from './support-chat.service';
import { SupportConversationEntity } from './entities/support-conversation.entity';
import { SupportMessageEntity } from './entities/support-message.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupportConversationEntity,
      SupportMessageEntity,
      UserEntity,
    ]),
    AuthModule,
    CartsModule,
    ProductsModule,
    OrdersModule,
    UsersModule,
    RolesModule,
  ],
  controllers: [SupportChatController],
  providers: [
    SupportBotService,
    SupportChatService,
    SupportChatPublisher,
    SupportChatGateway,
  ],
  exports: [SupportChatService],
})
export class SupportChatModule {}
