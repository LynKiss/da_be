import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import {
  SUPPORT_CHAT_STAFF_ROOM,
  supportChatConversationRoom,
  supportChatUserRoom,
} from './support-chat.constants';

type ConversationPayload = {
  conversationId: string;
  customer: { _id: string };
  assignedStaff?: { _id: string } | null;
};

@Injectable()
export class SupportChatPublisher {
  private server: Server | null = null;

  attach(server: Server) {
    this.server = server;
  }

  emitConversationUpdated(
    conversation: ConversationPayload & Record<string, unknown>,
  ) {
    if (!this.server) {
      return;
    }

    this.server
      .to(supportChatUserRoom(conversation.customer._id))
      .emit('support:conversation', conversation);
    this.server
      .to(SUPPORT_CHAT_STAFF_ROOM)
      .emit('support:conversation', conversation);

    if (conversation.assignedStaff?._id) {
      this.server
        .to(supportChatUserRoom(conversation.assignedStaff._id))
        .emit('support:conversation', conversation);
    }
  }

  emitMessageCreated(
    conversation: ConversationPayload & Record<string, unknown>,
    message: Record<string, unknown>,
  ) {
    if (!this.server) {
      return;
    }

    this.server
      .to(supportChatConversationRoom(conversation.conversationId))
      .emit('support:message', {
        conversationId: conversation.conversationId,
        message,
      });

    this.emitConversationUpdated(conversation);
  }
}
