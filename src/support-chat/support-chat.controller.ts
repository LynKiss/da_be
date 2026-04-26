import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  Public,
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateSupportBotReplyDto } from './dto/create-support-bot-reply.dto';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { StartSupportConversationDto } from './dto/start-support-conversation.dto';
import { UpdateSupportConversationStatusDto } from './dto/update-support-conversation-status.dto';
import { SupportBotService } from './support-bot.service';
import { SupportConversationStatus } from './entities/support-conversation.entity';
import { SupportChatPublisher } from './support-chat.publisher';
import { SupportChatService } from './support-chat.service';

@Controller('support-chat')
export class SupportChatController {
  constructor(
    private readonly supportChatService: SupportChatService,
    private readonly supportChatPublisher: SupportChatPublisher,
    private readonly supportBotService: SupportBotService,
  ) {}

  @Public()
  @Post('bot/reply')
  @ResponseMessage('Generate support bot reply')
  createBotReply(@Body() createSupportBotReplyDto: CreateSupportBotReplyDto) {
    return this.supportBotService.createReply(createSupportBotReplyDto);
  }

  @Post('bot/reply/me')
  @ResponseMessage('Generate support bot reply for current user')
  createMyBotReply(
    @User() currentUser: IUser,
    @Body() createSupportBotReplyDto: CreateSupportBotReplyDto,
  ) {
    return this.supportBotService.createReply(
      createSupportBotReplyDto,
      currentUser,
    );
  }

  @Post('conversations/me/start')
  @ResponseMessage('Start my support conversation')
  async startMyConversation(@User() currentUser: IUser) {
    const conversation =
      await this.supportChatService.startConversationForCustomer(currentUser);
    this.supportChatPublisher.emitConversationUpdated(conversation);
    return conversation;
  }

  @Get('conversations/me')
  @ResponseMessage('Get my support conversations')
  getMyConversations(@User() currentUser: IUser) {
    return this.supportChatService.listMyConversations(currentUser);
  }

  @Get('conversations/:id')
  @ResponseMessage('Get support conversation detail')
  getConversation(@User() currentUser: IUser, @Param('id') id: string) {
    return this.supportChatService.getConversation(currentUser, id);
  }

  @Get('conversations/:id/messages')
  @ResponseMessage('Get support conversation messages')
  getConversationMessages(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.supportChatService.getConversationMessages(
      currentUser,
      id,
      limit,
    );
  }

  @Patch('conversations/:id/read')
  @ResponseMessage('Mark support conversation as read')
  async markConversationRead(
    @User() currentUser: IUser,
    @Param('id') id: string,
  ) {
    const conversation = await this.supportChatService.markConversationRead(
      currentUser,
      id,
    );
    this.supportChatPublisher.emitConversationUpdated(conversation);
    return conversation;
  }

  @Post('conversations/:id/messages')
  @ResponseMessage('Create support message')
  async createMessage(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() createSupportMessageDto: CreateSupportMessageDto,
  ) {
    const result = await this.supportChatService.createMessage(
      currentUser,
      id,
      createSupportMessageDto,
    );
    this.supportChatPublisher.emitMessageCreated(
      result.conversation,
      result.message,
    );
    return result;
  }

  @Get('admin/conversations')
  @RequirePermissions('manage_support')
  @ResponseMessage('Get admin support conversations')
  getAdminConversations(
    @User() currentUser: IUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: SupportConversationStatus,
    @Query('search') search?: string,
  ) {
    return this.supportChatService.listAdminConversations(currentUser, {
      page,
      limit,
      status,
      search,
    });
  }

  @Post('admin/conversations/start')
  @RequirePermissions('manage_support')
  @ResponseMessage('Start support conversation for customer')
  async startConversationForCustomer(
    @User() currentUser: IUser,
    @Body() startSupportConversationDto: StartSupportConversationDto,
  ) {
    const conversation =
      await this.supportChatService.startConversationForManager(
        currentUser,
        startSupportConversationDto.customerLookup,
      );
    this.supportChatPublisher.emitConversationUpdated(conversation);
    return conversation;
  }

  @Patch('admin/conversations/:id/assign')
  @RequirePermissions('manage_support')
  @ResponseMessage('Assign support conversation')
  async assignConversation(
    @User() currentUser: IUser,
    @Param('id') id: string,
  ) {
    const conversation = await this.supportChatService.assignConversation(
      currentUser,
      id,
    );
    this.supportChatPublisher.emitConversationUpdated(conversation);
    return conversation;
  }

  @Patch('admin/conversations/:id/status')
  @RequirePermissions('manage_support')
  @ResponseMessage('Update support conversation status')
  async updateConversationStatus(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body()
    updateSupportConversationStatusDto: UpdateSupportConversationStatusDto,
  ) {
    const conversation = await this.supportChatService.updateConversationStatus(
      currentUser,
      id,
      updateSupportConversationStatusDto.status,
    );
    this.supportChatPublisher.emitConversationUpdated(conversation);
    return conversation;
  }
}
