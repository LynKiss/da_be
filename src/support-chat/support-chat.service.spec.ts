import { ForbiddenException } from '@nestjs/common';
import { UserEntity, UserRole } from '../users/entities/user.entity';
import type { IUser } from '../users/users.interface';
import {
  SupportConversationEntity,
  SupportConversationStatus,
  SupportChatActorRole,
} from './entities/support-conversation.entity';
import { SupportMessageEntity } from './entities/support-message.entity';
import { SupportChatService } from './support-chat.service';

type MockRepository = {
  findOne?: jest.Mock;
  findOneBy?: jest.Mock;
  find?: jest.Mock;
  save?: jest.Mock;
  create?: jest.Mock;
  createQueryBuilder?: jest.Mock;
};

const createRepositoryMock = (): MockRepository => ({
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn((entity: unknown) => entity),
  createQueryBuilder: jest.fn(),
});

describe('SupportChatService', () => {
  let service: SupportChatService;
  let conversationsRepository: MockRepository;
  let messagesRepository: MockRepository;
  let usersRepository: MockRepository;

  const now = new Date('2026-04-23T08:00:00.000Z');
  const customerEntity: UserEntity = {
    userId: 'customer-1',
    username: 'alice',
    email: 'alice@example.com',
    avatarUrl: null,
    role: UserRole.CUSTOMER,
    passwordHash: 'hash',
    provider: 'local',
    providerId: null,
    isActive: true,
    resetPasswordCode: null,
    resetPasswordExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const staffEntity: UserEntity = {
    userId: 'staff-1',
    username: 'supporter',
    email: 'support@example.com',
    avatarUrl: null,
    role: UserRole.STAFF,
    passwordHash: 'hash',
    provider: 'local',
    providerId: null,
    isActive: true,
    resetPasswordCode: null,
    resetPasswordExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const customerUser: IUser = {
    _id: customerEntity.userId,
    username: customerEntity.username,
    email: customerEntity.email,
    role: { _id: UserRole.CUSTOMER, name: UserRole.CUSTOMER },
    permissions: [],
  };
  const staffUser: IUser = {
    _id: staffEntity.userId,
    username: staffEntity.username,
    email: staffEntity.email,
    role: { _id: UserRole.STAFF, name: UserRole.STAFF },
    permissions: [
      {
        _id: 'perm-support',
        key: 'manage_support',
        name: 'Manage support',
      },
    ],
  };

  beforeEach(() => {
    conversationsRepository = createRepositoryMock();
    messagesRepository = createRepositoryMock();
    usersRepository = createRepositoryMock();

    service = new SupportChatService(
      conversationsRepository as never,
      messagesRepository as never,
      usersRepository as never,
    );
  });

  it('reuses the current unresolved conversation for a customer', async () => {
    const conversation: SupportConversationEntity = {
      conversationId: 'conv-1',
      customerUserId: customerEntity.userId,
      assignedStaffUserId: null,
      status: SupportConversationStatus.WAITING_STAFF,
      lastMessagePreview: null,
      lastMessageSenderRole: null,
      lastMessageAt: null,
      customerUnreadCount: 0,
      staffUnreadCount: 0,
      firstResponseAt: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    conversationsRepository.findOne?.mockResolvedValue(conversation);
    usersRepository.find?.mockResolvedValue([customerEntity]);

    const result = await service.startConversationForCustomer(customerUser);

    expect(conversationsRepository.save).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        conversationId: conversation.conversationId,
        customer: expect.objectContaining({
          _id: customerEntity.userId,
          username: customerEntity.username,
        }),
      }),
    );
  });

  it('creates a new conversation when the customer has no active session', async () => {
    conversationsRepository.findOne?.mockResolvedValue(null);
    conversationsRepository.save?.mockImplementation(
      (entity: SupportConversationEntity) =>
        Promise.resolve({
          createdAt: now,
          updatedAt: now,
          ...entity,
        }),
    );
    usersRepository.find?.mockResolvedValue([customerEntity]);

    const result = await service.startConversationForCustomer(customerUser);

    expect(conversationsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        customerUserId: customerEntity.userId,
        status: SupportConversationStatus.WAITING_STAFF,
      }),
    );
    expect(result.status).toBe(SupportConversationStatus.WAITING_STAFF);
  });

  it('increments staff unread count when the customer sends a message', async () => {
    const conversation: SupportConversationEntity = {
      conversationId: 'conv-2',
      customerUserId: customerEntity.userId,
      assignedStaffUserId: null,
      status: SupportConversationStatus.WAITING_CUSTOMER,
      lastMessagePreview: 'Old',
      lastMessageSenderRole: SupportChatActorRole.STAFF,
      lastMessageAt: now,
      customerUnreadCount: 0,
      staffUnreadCount: 1,
      firstResponseAt: null,
      resolvedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const message: SupportMessageEntity = {
      messageId: 'msg-1',
      conversationId: conversation.conversationId,
      senderUserId: customerEntity.userId,
      senderRole: SupportChatActorRole.CUSTOMER,
      content: 'Tôi cần hỗ trợ thêm',
      readAt: null,
      createdAt: now,
    };

    conversationsRepository.findOneBy?.mockResolvedValue(conversation);
    messagesRepository.save?.mockResolvedValue(message);
    conversationsRepository.save?.mockImplementation(
      (entity: SupportConversationEntity) => Promise.resolve(entity),
    );
    usersRepository.find?.mockResolvedValue([customerEntity]);

    const result = await service.createMessage(customerUser, 'conv-2', {
      content: 'Tôi cần hỗ trợ thêm',
    });

    expect(result.conversation.status).toBe(
      SupportConversationStatus.WAITING_STAFF,
    );
    expect(result.conversation.staffUnreadCount).toBe(2);
    expect(result.conversation.customerUnreadCount).toBe(0);
    expect(result.conversation.resolvedAt).toBeNull();
  });

  it('assigns the staff member and increments customer unread count on reply', async () => {
    const conversation: SupportConversationEntity = {
      conversationId: 'conv-3',
      customerUserId: customerEntity.userId,
      assignedStaffUserId: null,
      status: SupportConversationStatus.WAITING_STAFF,
      lastMessagePreview: 'Khách vừa nhắn',
      lastMessageSenderRole: SupportChatActorRole.CUSTOMER,
      lastMessageAt: now,
      customerUnreadCount: 0,
      staffUnreadCount: 1,
      firstResponseAt: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const message: SupportMessageEntity = {
      messageId: 'msg-2',
      conversationId: conversation.conversationId,
      senderUserId: staffEntity.userId,
      senderRole: SupportChatActorRole.STAFF,
      content: 'Mình đã nhận được thông tin',
      readAt: null,
      createdAt: now,
    };

    conversationsRepository.findOneBy?.mockResolvedValue(conversation);
    messagesRepository.save?.mockResolvedValue(message);
    conversationsRepository.save?.mockImplementation(
      (entity: SupportConversationEntity) => Promise.resolve(entity),
    );
    usersRepository.find?.mockResolvedValue([customerEntity, staffEntity]);

    const result = await service.createMessage(staffUser, 'conv-3', {
      content: 'Mình đã nhận được thông tin',
    });

    expect(result.conversation.status).toBe(
      SupportConversationStatus.WAITING_CUSTOMER,
    );
    expect(result.conversation.customerUnreadCount).toBe(1);
    expect(result.conversation.staffUnreadCount).toBe(0);
    expect(result.conversation.assignedStaff?._id).toBe(staffEntity.userId);
    expect(result.conversation.firstResponseAt).toEqual(expect.any(Date));
  });

  it('resets customer unread messages when the customer reads the conversation', async () => {
    const updateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    const conversation: SupportConversationEntity = {
      conversationId: 'conv-4',
      customerUserId: customerEntity.userId,
      assignedStaffUserId: staffEntity.userId,
      status: SupportConversationStatus.WAITING_CUSTOMER,
      lastMessagePreview: 'Phản hồi từ nhân viên',
      lastMessageSenderRole: SupportChatActorRole.STAFF,
      lastMessageAt: now,
      customerUnreadCount: 2,
      staffUnreadCount: 0,
      firstResponseAt: now,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    conversationsRepository.findOneBy?.mockResolvedValue(conversation);
    conversationsRepository.save?.mockImplementation(
      (entity: SupportConversationEntity) => Promise.resolve(entity),
    );
    messagesRepository.createQueryBuilder?.mockReturnValue(updateBuilder);
    usersRepository.find?.mockResolvedValue([customerEntity, staffEntity]);

    const result = await service.markConversationRead(customerUser, 'conv-4');

    expect(conversationsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        customerUnreadCount: 0,
      }),
    );
    expect(updateBuilder.execute).toHaveBeenCalled();
    expect(result.customerUnreadCount).toBe(0);
  });

  it('blocks customers from opening other users conversations', async () => {
    const conversation: SupportConversationEntity = {
      conversationId: 'conv-5',
      customerUserId: 'customer-999',
      assignedStaffUserId: null,
      status: SupportConversationStatus.WAITING_STAFF,
      lastMessagePreview: null,
      lastMessageSenderRole: null,
      lastMessageAt: null,
      customerUnreadCount: 0,
      staffUnreadCount: 0,
      firstResponseAt: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    conversationsRepository.findOneBy?.mockResolvedValue(conversation);

    await expect(
      service.getConversation(customerUser, 'conv-5'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
