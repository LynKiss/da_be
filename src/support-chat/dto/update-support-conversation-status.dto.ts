import { IsEnum } from 'class-validator';
import { SupportConversationStatus } from '../entities/support-conversation.entity';

export class UpdateSupportConversationStatusDto {
  @IsEnum(SupportConversationStatus)
  status: SupportConversationStatus;
}
