import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { RolesService } from '../roles/roles.service';
import { UserRole } from '../users/entities/user.entity';
import type { IUser } from '../users/users.interface';
import {
  SUPPORT_CHAT_NAMESPACE,
  SUPPORT_CHAT_STAFF_ROOM,
  supportChatConversationRoom,
  supportChatUserRoom,
} from './support-chat.constants';
import { SupportChatPublisher } from './support-chat.publisher';
import { SupportChatService } from './support-chat.service';

type JwtPayload = {
  _id: string;
  username: string;
  email: string;
  role: {
    _id: UserRole;
    name: UserRole;
  };
};

@WebSocketGateway({
  namespace: SUPPORT_CHAT_NAMESPACE,
  cors: {
    origin: true,
    credentials: true,
  },
})
export class SupportChatGateway
  implements OnGatewayInit, OnGatewayConnection
{
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(SupportChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly rolesService: RolesService,
    private readonly supportChatService: SupportChatService,
    private readonly supportChatPublisher: SupportChatPublisher,
  ) {}

  afterInit(server: Server) {
    this.supportChatPublisher.attach(server);
  }

  async handleConnection(client: Socket) {
    try {
      const currentUser = await this.authenticateClient(client);
      client.data.user = currentUser;
      client.join(supportChatUserRoom(currentUser._id));

      if (this.supportChatService.canManageSupport(currentUser)) {
        client.join(SUPPORT_CHAT_STAFF_ROOM);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Socket authentication failed';
      this.logger.warn(`Reject support socket ${client.id}: ${message}`);
      client.emit('support:error', { message });
      client.disconnect();
    }
  }

  @SubscribeMessage('conversation:join')
  async handleConversationJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const currentUser = this.getCurrentUser(client);
    const conversationId = body?.conversationId?.trim();

    if (!conversationId) {
      throw new ForbiddenException('conversationId is required');
    }

    client.join(supportChatConversationRoom(conversationId));
    await this.supportChatService.markConversationRead(currentUser, conversationId);

    return {
      event: 'conversation:joined',
      data: {
        conversation: await this.supportChatService.getConversation(
          currentUser,
          conversationId,
        ),
        messages: await this.supportChatService.getConversationMessages(
          currentUser,
          conversationId,
          100,
        ),
      },
    };
  }

  @SubscribeMessage('conversation:leave')
  handleConversationLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const conversationId = body?.conversationId?.trim();

    if (conversationId) {
      client.leave(supportChatConversationRoom(conversationId));
    }

    return {
      event: 'conversation:left',
      data: {
        conversationId,
      },
    };
  }

  @SubscribeMessage('conversation:read')
  async handleConversationRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const currentUser = this.getCurrentUser(client);
    const conversationId = body?.conversationId?.trim();

    if (!conversationId) {
      throw new ForbiddenException('conversationId is required');
    }

    const conversation = await this.supportChatService.markConversationRead(
      currentUser,
      conversationId,
    );
    this.supportChatPublisher.emitConversationUpdated(conversation);

    return {
      event: 'conversation:read',
      data: conversation,
    };
  }

  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string; content?: string },
  ) {
    const currentUser = this.getCurrentUser(client);
    const conversationId = body?.conversationId?.trim();
    const content = body?.content?.trim();

    if (!conversationId || !content) {
      throw new ForbiddenException('conversationId and content are required');
    }

    client.join(supportChatConversationRoom(conversationId));

    const result = await this.supportChatService.createMessage(
      currentUser,
      conversationId,
      { content },
    );
    this.supportChatPublisher.emitMessageCreated(
      result.conversation,
      result.message,
    );

    return {
      event: 'message:sent',
      data: result,
    };
  }

  private getCurrentUser(client: Socket) {
    const currentUser = client.data.user as IUser | undefined;

    if (!currentUser) {
      throw new UnauthorizedException('Socket user is missing');
    }

    return currentUser;
  }

  private async authenticateClient(client: Socket): Promise<IUser> {
    const token = this.extractToken(client);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    const role = payload.role?._id
      ? await this.rolesService.findOne(payload.role._id)
      : null;

    const currentUser: IUser = {
      _id: payload._id,
      username: payload.username,
      email: payload.email,
      role: payload.role,
      permissions: role?.permissions ?? [],
    };

    const isCustomer = currentUser.role?._id === UserRole.CUSTOMER;
    const canManageSupport =
      this.supportChatService.canManageSupport(currentUser);

    if (!isCustomer && !canManageSupport) {
      throw new ForbiddenException('You cannot access support chat');
    }

    return currentUser;
  }

  private extractToken(client: Socket) {
    const authToken =
      typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token
        : null;
    const authorizationHeader = client.handshake.headers.authorization;

    if (authToken) {
      return authToken.replace(/^Bearer\s+/i, '').trim();
    }

    if (typeof authorizationHeader === 'string') {
      return authorizationHeader.replace(/^Bearer\s+/i, '').trim();
    }

    return null;
  }
}
