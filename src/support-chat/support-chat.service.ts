import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserRole } from '../users/entities/user.entity';
import type { IUser } from '../users/users.interface';
import { UserEntity } from '../users/entities/user.entity';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import {
  SupportConversationEntity,
  SupportConversationStatus,
  SupportChatActorRole,
} from './entities/support-conversation.entity';
import { SupportMessageEntity } from './entities/support-message.entity';

type ConversationListQuery = {
  page: number;
  limit: number;
  status?: SupportConversationStatus;
  search?: string;
};

@Injectable()
export class SupportChatService {
  constructor(
    @InjectRepository(SupportConversationEntity)
    private readonly conversationsRepository: Repository<SupportConversationEntity>,
    @InjectRepository(SupportMessageEntity)
    private readonly messagesRepository: Repository<SupportMessageEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  canManageSupport(currentUser: IUser) {
    return (
      currentUser.role?._id === UserRole.ADMIN ||
      currentUser.permissions.some(
        (permission) => permission.key === 'manage_support',
      )
    );
  }

  async startConversationForCustomer(currentUser: IUser) {
    this.ensureCustomer(currentUser);

    const existingConversation = await this.conversationsRepository.findOne({
      where: {
        customerUserId: currentUser._id,
        status: In([
          SupportConversationStatus.WAITING_STAFF,
          SupportConversationStatus.WAITING_CUSTOMER,
        ]),
      },
      order: {
        updatedAt: 'DESC',
      },
    });

    if (existingConversation) {
      return this.mapConversationWithUsers(existingConversation);
    }

    const conversation = this.conversationsRepository.create({
      conversationId: randomUUID(),
      customerUserId: currentUser._id,
      assignedStaffUserId: null,
      status: SupportConversationStatus.WAITING_STAFF,
      lastMessagePreview: null,
      lastMessageSenderRole: null,
      lastMessageAt: null,
      customerUnreadCount: 0,
      staffUnreadCount: 0,
      firstResponseAt: null,
      resolvedAt: null,
    });

    const savedConversation =
      await this.conversationsRepository.save(conversation);
    return this.mapConversationWithUsers(savedConversation);
  }

  async startConversationForManager(
    currentUser: IUser,
    customerLookup: string,
  ) {
    this.ensureManager(currentUser);
    const customer = await this.findCustomerByLookup(customerLookup);

    const existingConversation = await this.conversationsRepository.findOne({
      where: {
        customerUserId: customer.userId,
        status: In([
          SupportConversationStatus.WAITING_STAFF,
          SupportConversationStatus.WAITING_CUSTOMER,
        ]),
      },
      order: {
        updatedAt: 'DESC',
      },
    });

    if (existingConversation) {
      return this.mapConversationWithUsers(existingConversation);
    }

    const conversation = this.conversationsRepository.create({
      conversationId: randomUUID(),
      customerUserId: customer.userId,
      assignedStaffUserId: currentUser._id,
      status: SupportConversationStatus.WAITING_STAFF,
      lastMessagePreview: null,
      lastMessageSenderRole: null,
      lastMessageAt: null,
      customerUnreadCount: 0,
      staffUnreadCount: 0,
      firstResponseAt: null,
      resolvedAt: null,
    });

    const savedConversation =
      await this.conversationsRepository.save(conversation);
    return this.mapConversationWithUsers(savedConversation);
  }

  async listMyConversations(currentUser: IUser) {
    this.ensureCustomer(currentUser);
    const conversations = await this.conversationsRepository.find({
      where: { customerUserId: currentUser._id },
      order: {
        lastMessageAt: 'DESC',
        updatedAt: 'DESC',
      },
      take: 20,
    });

    return this.mapConversationList(conversations);
  }

  async listAdminConversations(
    currentUser: IUser,
    query: ConversationListQuery,
  ) {
    this.ensureManager(currentUser);

    const safePage = Math.max(1, query.page || 1);
    const safeLimit = Math.min(50, Math.max(1, query.limit || 20));

    const queryBuilder =
      this.conversationsRepository.createQueryBuilder('conversation');

    if (query.status) {
      queryBuilder.andWhere('conversation.status = :status', {
        status: query.status,
      });
    }

    if (query.search?.trim()) {
      queryBuilder.leftJoin(
        UserEntity,
        'customer',
        'customer.userId = conversation.customerUserId',
      );
      queryBuilder.andWhere(
        '(conversation.conversationId LIKE :search OR customer.userId LIKE :search OR customer.username LIKE :search OR customer.email LIKE :search)',
        {
          search: `%${query.search.trim()}%`,
        },
      );
    }

    queryBuilder
      .orderBy('conversation.lastMessageAt', 'DESC')
      .addOrderBy('conversation.updatedAt', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [conversations, total] = await queryBuilder.getManyAndCount();
    const items = await this.mapConversationList(conversations);

    return {
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
      items,
    };
  }

  async getConversation(currentUser: IUser, conversationId: string) {
    const conversation = await this.findAccessibleConversation(
      currentUser,
      conversationId,
    );
    return this.mapConversationWithUsers(conversation);
  }

  async getConversationMessages(
    currentUser: IUser,
    conversationId: string,
    limit = 100,
  ) {
    await this.findAccessibleConversation(currentUser, conversationId);

    const safeLimit = Math.min(200, Math.max(1, limit || 100));
    const messages = await this.messagesRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: safeLimit,
    });

    return this.mapMessageList(messages.reverse());
  }

  async markConversationRead(currentUser: IUser, conversationId: string) {
    const conversation = await this.findAccessibleConversation(
      currentUser,
      conversationId,
    );
    const now = new Date();

    if (this.canManageSupport(currentUser)) {
      if (conversation.staffUnreadCount > 0) {
        conversation.staffUnreadCount = 0;
        await this.conversationsRepository.save(conversation);
      }

      await this.messagesRepository
        .createQueryBuilder()
        .update(SupportMessageEntity)
        .set({ readAt: now })
        .where('conversation_id = :conversationId', { conversationId })
        .andWhere('sender_role = :senderRole', {
          senderRole: SupportChatActorRole.CUSTOMER,
        })
        .andWhere('read_at IS NULL')
        .execute();
    } else {
      if (conversation.customerUnreadCount > 0) {
        conversation.customerUnreadCount = 0;
        await this.conversationsRepository.save(conversation);
      }

      await this.messagesRepository
        .createQueryBuilder()
        .update(SupportMessageEntity)
        .set({ readAt: now })
        .where('conversation_id = :conversationId', { conversationId })
        .andWhere('sender_role = :senderRole', {
          senderRole: SupportChatActorRole.STAFF,
        })
        .andWhere('read_at IS NULL')
        .execute();
    }

    return this.mapConversationWithUsers(conversation);
  }

  async assignConversation(currentUser: IUser, conversationId: string) {
    this.ensureManager(currentUser);
    const conversation = await this.findAccessibleConversation(
      currentUser,
      conversationId,
    );

    conversation.assignedStaffUserId = currentUser._id;
    if (conversation.status === SupportConversationStatus.WAITING_STAFF) {
      conversation.status = SupportConversationStatus.WAITING_CUSTOMER;
    }

    const savedConversation =
      await this.conversationsRepository.save(conversation);
    return this.mapConversationWithUsers(savedConversation);
  }

  async updateConversationStatus(
    currentUser: IUser,
    conversationId: string,
    status: SupportConversationStatus,
  ) {
    this.ensureManager(currentUser);
    const conversation = await this.findAccessibleConversation(
      currentUser,
      conversationId,
    );

    conversation.status = status;
    conversation.resolvedAt =
      status === SupportConversationStatus.RESOLVED ? new Date() : null;

    if (
      status === SupportConversationStatus.WAITING_CUSTOMER &&
      !conversation.assignedStaffUserId
    ) {
      conversation.assignedStaffUserId = currentUser._id;
    }

    const savedConversation =
      await this.conversationsRepository.save(conversation);
    return this.mapConversationWithUsers(savedConversation);
  }

  async createMessage(
    currentUser: IUser,
    conversationId: string,
    createMessageDto: CreateSupportMessageDto,
  ) {
    const conversation = await this.findAccessibleConversation(
      currentUser,
      conversationId,
    );
    const content = createMessageDto.content.trim();

    if (!content) {
      throw new BadRequestException('Noi dung tin nhan khong duoc de trong');
    }

    const senderRole = this.canManageSupport(currentUser)
      ? SupportChatActorRole.STAFF
      : SupportChatActorRole.CUSTOMER;
    const now = new Date();

    const message = this.messagesRepository.create({
      messageId: randomUUID(),
      conversationId,
      senderUserId: currentUser._id,
      senderRole,
      content,
      readAt: null,
    });

    const savedMessage = await this.messagesRepository.save(message);

    conversation.lastMessagePreview = this.toPreview(content);
    conversation.lastMessageSenderRole = senderRole;
    conversation.lastMessageAt = now;
    conversation.resolvedAt = null;

    if (senderRole === SupportChatActorRole.STAFF) {
      conversation.assignedStaffUserId =
        conversation.assignedStaffUserId ?? currentUser._id;
      conversation.customerUnreadCount += 1;
      conversation.staffUnreadCount = 0;
      conversation.status = SupportConversationStatus.WAITING_CUSTOMER;
      conversation.firstResponseAt = conversation.firstResponseAt ?? now;
    } else {
      conversation.customerUnreadCount = 0;
      conversation.staffUnreadCount += 1;
      conversation.status = SupportConversationStatus.WAITING_STAFF;
    }

    const savedConversation =
      await this.conversationsRepository.save(conversation);

    return {
      conversation: await this.mapConversationWithUsers(savedConversation),
      message: await this.mapMessage(savedMessage),
    };
  }

  private ensureCustomer(currentUser: IUser) {
    if (currentUser.role?._id !== UserRole.CUSTOMER) {
      throw new ForbiddenException(
        'Chi khach hang moi duoc su dung chat ho tro nay',
      );
    }
  }

  private ensureManager(currentUser: IUser) {
    if (!this.canManageSupport(currentUser)) {
      throw new ForbiddenException('Ban khong co quyen quan ly chat ho tro');
    }
  }

  private async findCustomerByLookup(customerLookup: string) {
    const lookup = customerLookup.trim();
    if (!lookup) {
      throw new BadRequestException('Khong tim thay khach hang');
    }

    const customer = await this.usersRepository.findOne({
      where: [
        { userId: lookup, role: UserRole.CUSTOMER },
        { username: lookup, role: UserRole.CUSTOMER },
        { email: lookup, role: UserRole.CUSTOMER },
      ],
    });

    if (!customer) {
      throw new NotFoundException('Khach hang khong ton tai');
    }

    return customer;
  }

  private async findAccessibleConversation(
    currentUser: IUser,
    conversationId: string,
  ) {
    const conversation = await this.conversationsRepository.findOneBy({
      conversationId,
    });

    if (!conversation) {
      throw new NotFoundException('Cuoc tro chuyen khong ton tai');
    }

    if (this.canManageSupport(currentUser)) {
      return conversation;
    }

    if (
      currentUser.role?._id !== UserRole.CUSTOMER ||
      conversation.customerUserId !== currentUser._id
    ) {
      throw new ForbiddenException(
        'Ban khong duoc truy cap cuoc tro chuyen nay',
      );
    }

    return conversation;
  }

  private async mapConversationList(conversations: SupportConversationEntity[]) {
    const userIds = [
      ...new Set(
        conversations.flatMap((conversation) =>
          [
            conversation.customerUserId,
            conversation.assignedStaffUserId,
          ].filter((value): value is string => Boolean(value)),
        ),
      ),
    ];

    const users = userIds.length
      ? await this.usersRepository.find({
          where: { userId: In(userIds) },
        })
      : [];
    const userMap = new Map(users.map((user) => [user.userId, user]));

    return conversations.map((conversation) =>
      this.mapConversation(conversation, userMap),
    );
  }

  private async mapConversationWithUsers(conversation: SupportConversationEntity) {
    const userIds = [
      conversation.customerUserId,
      conversation.assignedStaffUserId,
    ].filter((value): value is string => Boolean(value));
    const users = userIds.length
      ? await this.usersRepository.find({
          where: { userId: In(userIds) },
        })
      : [];
    const userMap = new Map(users.map((user) => [user.userId, user]));

    return this.mapConversation(conversation, userMap);
  }

  private mapConversation(
    conversation: SupportConversationEntity,
    userMap: Map<string, UserEntity>,
  ) {
    const customer = userMap.get(conversation.customerUserId);
    const assignedStaff = conversation.assignedStaffUserId
      ? userMap.get(conversation.assignedStaffUserId)
      : null;

    return {
      conversationId: conversation.conversationId,
      status: conversation.status,
      customerUnreadCount: conversation.customerUnreadCount,
      staffUnreadCount: conversation.staffUnreadCount,
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageSenderRole: conversation.lastMessageSenderRole,
      lastMessageAt: conversation.lastMessageAt,
      firstResponseAt: conversation.firstResponseAt,
      resolvedAt: conversation.resolvedAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      customer: this.mapParticipant(
        customer,
        conversation.customerUserId,
        UserRole.CUSTOMER,
      ),
      assignedStaff: assignedStaff
        ? this.mapParticipant(
            assignedStaff,
            assignedStaff.userId,
            assignedStaff.role,
          )
        : null,
    };
  }

  private async mapMessageList(messages: SupportMessageEntity[]) {
    const userIds = [...new Set(messages.map((message) => message.senderUserId))];
    const users = userIds.length
      ? await this.usersRepository.find({
          where: { userId: In(userIds) },
        })
      : [];
    const userMap = new Map(users.map((user) => [user.userId, user]));

    return messages.map((message) => this.mapMessageRecord(message, userMap));
  }

  private async mapMessage(message: SupportMessageEntity) {
    const users = await this.usersRepository.find({
      where: { userId: In([message.senderUserId]) },
    });
    const userMap = new Map(users.map((user) => [user.userId, user]));

    return this.mapMessageRecord(message, userMap);
  }

  private mapMessageRecord(
    message: SupportMessageEntity,
    userMap: Map<string, UserEntity>,
  ) {
    const sender = userMap.get(message.senderUserId);

    return {
      messageId: message.messageId,
      conversationId: message.conversationId,
      content: message.content,
      senderRole: message.senderRole,
      readAt: message.readAt,
      createdAt: message.createdAt,
      sender: this.mapParticipant(
        sender,
        message.senderUserId,
        sender?.role ?? UserRole.CUSTOMER,
      ),
    };
  }

  private mapParticipant(
    user: UserEntity | undefined,
    fallbackId: string,
    fallbackRole: UserRole,
  ) {
    return {
      _id: user?.userId ?? fallbackId,
      username: user?.username ?? fallbackId,
      email: user?.email ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      role: user?.role ?? fallbackRole,
    };
  }

  private toPreview(content: string) {
    const normalized = content.replace(/\s+/g, ' ').trim();

    if (normalized.length <= 160) {
      return normalized;
    }

    return `${normalized.slice(0, 157)}...`;
  }
}
