import { BadRequestException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserEntity, UserRole } from './entities/user.entity';

type MockRepository = {
  findOne?: jest.Mock;
  findOneBy?: jest.Mock;
  save?: jest.Mock;
  create?: jest.Mock;
  update?: jest.Mock;
  count?: jest.Mock;
  find?: jest.Mock;
  delete?: jest.Mock;
};

const createRepositoryMock = (): MockRepository => ({
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  count: jest.fn(),
  find: jest.fn(),
  delete: jest.fn(),
});

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: MockRepository;
  let refreshTokensRepository: MockRepository;
  let shippingAddressesRepository: MockRepository;
  let ordersRepository: MockRepository;
  let orderItemsRepository: MockRepository;

  const now = new Date('2026-04-19T08:00:00.000Z');
  const user: UserEntity = {
    userId: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    avatarUrl: null,
    role: UserRole.CUSTOMER,
    passwordHash: 'old-hash',
    provider: 'local',
    providerId: null,
    isActive: true,
    resetPasswordCode: null,
    resetPasswordExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    usersRepository = createRepositoryMock();
    refreshTokensRepository = createRepositoryMock();
    shippingAddressesRepository = createRepositoryMock();
    ordersRepository = createRepositoryMock();
    orderItemsRepository = createRepositoryMock();

    service = new UsersService(
      usersRepository as never,
      refreshTokensRepository as never,
      shippingAddressesRepository as never,
      ordersRepository as never,
      orderItemsRepository as never,
    );
  });

  it('throws ConflictException when updating profile with an existing username', async () => {
    usersRepository.findOneBy?.mockResolvedValue(user);
    usersRepository.findOne?.mockResolvedValue({
      ...user,
      userId: 'user-2',
      username: 'taken-name',
    });

    await expect(
      service.updateProfile(user.userId, { username: 'taken-name' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hashes and saves the new password when changePassword succeeds', async () => {
    usersRepository.findOneBy?.mockResolvedValue(user);
    usersRepository.save?.mockImplementation((entity: UserEntity) =>
      Promise.resolve(entity),
    );
    jest
      .spyOn(service, 'checkUserPassword')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const hashPasswordSpy = jest
      .spyOn(service, 'hashPassword')
      .mockResolvedValue('new-hash');

    const result = await service.changePassword(user.userId, {
      oldPassword: 'OldPassword123!',
      newPassword: 'NewPassword123!',
    });

    expect(hashPasswordSpy).toHaveBeenCalledWith('NewPassword123!');
    expect(usersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.userId,
        passwordHash: 'new-hash',
      }),
    );
    expect(result).toEqual({ message: 'Doi mat khau thanh cong' });
  });

  it('rejects when the new password matches the current password', async () => {
    usersRepository.findOneBy?.mockResolvedValue(user);
    jest
      .spyOn(service, 'checkUserPassword')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    await expect(
      service.changePassword(user.userId, {
        oldPassword: 'OldPassword123!',
        newPassword: 'OldPassword123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates the first shipping address as default', async () => {
    usersRepository.findOneBy?.mockResolvedValue(user);
    shippingAddressesRepository.count?.mockResolvedValue(0);
    shippingAddressesRepository.create?.mockImplementation(
      (entity: {
        userId: string;
        recipientName: string;
        phone: string;
        addressLine: string;
        ward: string | null;
        district: string | null;
        province: string | null;
        isDefault: boolean;
      }) => entity,
    );
    shippingAddressesRepository.save?.mockImplementation(
      (entity: {
        userId: string;
        recipientName: string;
        phone: string;
        addressLine: string;
        ward: string | null;
        district: string | null;
        province: string | null;
        isDefault: boolean;
      }) =>
        Promise.resolve({
          shippingAddressId: 'addr-1',
          createdAt: now,
          updatedAt: now,
          ...entity,
        }),
    );

    const result = await service.createShippingAddress(user.userId, {
      recipientName: 'Alice Nguyen',
      phone: '0900000000',
      addressLine: '123 Nguyen Trai',
      ward: 'Ward 1',
      district: 'District 5',
      province: 'HCMC',
    });

    expect(shippingAddressesRepository.update).toHaveBeenCalledWith(
      { userId: user.userId },
      { isDefault: false },
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'addr-1',
        recipientName: 'Alice Nguyen',
        isDefault: true,
      }),
    );
  });
});
