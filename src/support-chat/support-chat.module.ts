import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { UserEntity } from '../users/entities/user.entity';
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
    RolesModule,
  ],
  controllers: [SupportChatController],
  providers: [
    SupportChatService,
    SupportChatPublisher,
    SupportChatGateway,
  ],
  exports: [SupportChatService],
})
export class SupportChatModule {}
