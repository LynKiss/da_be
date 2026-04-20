import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { CartItemEntity } from '../carts/entities/cart-item.entity';
import { ShoppingCartEntity } from '../carts/entities/shopping-cart.entity';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { PaymentTransactionEntity } from '../orders/entities/payment-transaction.entity';
import { ReturnEntity } from '../orders/entities/return.entity';
import { ShippingAddressEntity } from '../orders/entities/shipping-address.entity';
import { In, Repository } from 'typeorm';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { CreateShippingAddressDto } from './dto/create-shipping-address.dto';
import { RegisterUserDto } from './dto/create-user.dto';
import { QueryAdminUsersDto } from './dto/query-admin-users.dto';
import { ResetAdminUserPasswordDto } from './dto/reset-admin-user-password.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateAdminUserStatusDto } from './dto/update-admin-user-status.dto';
import { UpdateShippingAddressDto } from './dto/update-shipping-address.dto';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserEntity, UserRole } from './entities/user.entity';
import { IUser } from './users.interface';
import { WishlistEntity } from '../products/entities/wishlist.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokensRepository: Repository<RefreshTokenEntity>,
    @InjectRepository(ContactEntity)
    private readonly contactsRepository: Repository<ContactEntity>,
    @InjectRepository(ShoppingCartEntity)
    private readonly shoppingCartsRepository: Repository<ShoppingCartEntity>,
    @InjectRepository(CartItemEntity)
    private readonly cartItemsRepository: Repository<CartItemEntity>,
    @InjectRepository(WishlistEntity)
    private readonly wishlistRepository: Repository<WishlistEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationsRepository: Repository<NotificationEntity>,
    @InjectRepository(ShippingAddressEntity)
    private readonly shippingAddressesRepository: Repository<ShippingAddressEntity>,
    @InjectRepository(OrderEntity)
    private readonly ordersRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemsRepository: Repository<OrderItemEntity>,
    @InjectRepository(ReturnEntity)
    private readonly returnsRepository: Repository<ReturnEntity>,
    @InjectRepository(PaymentTransactionEntity)
    private readonly paymentTransactionsRepository: Repository<PaymentTransactionEntity>,
  ) {}

  async findOneByUsername(username: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({
      where: [{ username }, { email: username }],
    });
  }

  async findOneByIdForAuth(userId: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({
      where: { userId },
    });
  }

  async findAll(query?: QueryAdminUsersDto) {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 10;
    const queryBuilder = this.usersRepository.createQueryBuilder('user');

    if (query?.search) {
      queryBuilder.andWhere(
        '(user.username LIKE :search OR user.email LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query?.role) {
      queryBuilder.andWhere('user.role = :role', { role: query.role });
    }

    if (query?.isActive !== undefined) {
      queryBuilder.andWhere('user.is_active = :isActive', {
        isActive: query.isActive === 'true',
      });
    }

    queryBuilder
      .orderBy('user.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [users, total] = await queryBuilder.getManyAndCount();

    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      items: users.map((user) => ({
        ...this.toPublicUser(user),
        isActive: user.isActive,
        createdAt: user.createdAt,
      })),
    };
  }

  async findProfile(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new UnauthorizedException('Nguoi dung khong ton tai');
    }

    return this.toPublicUser(user);
  }

  async register(registerUserDto: RegisterUserDto) {
    const existedUser = await this.usersRepository.findOne({
      where: [
        { username: registerUserDto.username },
        { email: registerUserDto.email },
      ],
    });

    if (existedUser) {
      throw new ConflictException('Username hoac email da ton tai');
    }

    const user = this.usersRepository.create({
      userId: randomUUID(),
      username: registerUserDto.username,
      email: registerUserDto.email,
      avatarUrl: registerUserDto.avatarUrl ?? null,
      role: UserRole.CUSTOMER,
      passwordHash: await this.hashPassword(registerUserDto.password),
      provider: 'local',
      providerId: null,
      isActive: true,
      resetPasswordCode: null,
      resetPasswordExpiresAt: null,
    });

    const savedUser = await this.usersRepository.save(user);

    return {
      _id: savedUser.userId,
      username: savedUser.username,
      email: savedUser.email,
      role: savedUser.role,
      message: 'Dang ky tai khoan thanh cong',
    };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async createAdminUser(
    actorUserId: string,
    createAdminUserDto: CreateAdminUserDto,
  ) {
    await this.ensureUserExists(actorUserId);
    await this.ensureUniqueIdentity(
      createAdminUserDto.username,
      createAdminUserDto.email,
    );

    const user = this.usersRepository.create({
      userId: randomUUID(),
      username: createAdminUserDto.username,
      email: createAdminUserDto.email,
      avatarUrl: createAdminUserDto.avatarUrl ?? null,
      role: createAdminUserDto.role ?? UserRole.CUSTOMER,
      passwordHash: await this.hashPassword(createAdminUserDto.password),
      provider: 'local',
      providerId: null,
      isActive: createAdminUserDto.isActive ?? true,
      resetPasswordCode: null,
      resetPasswordExpiresAt: null,
    });

    const savedUser = await this.usersRepository.save(user);
    return {
      ...this.toPublicUser(savedUser),
      isActive: savedUser.isActive,
      createdAt: savedUser.createdAt,
      updatedAt: savedUser.updatedAt,
    };
  }

  async checkUserPassword(
    password: string,
    hash: string | null,
  ): Promise<boolean> {
    if (!hash) {
      return false;
    }

    return bcrypt.compare(password, hash);
  }

  async updateUserRefreshToken(
    userId: string,
    refreshToken: string | null,
    expiredAt?: Date,
  ) {
    if (!refreshToken) {
      await this.refreshTokensRepository.update(
        { userId, isRevoked: false },
        { isRevoked: true },
      );
      return;
    }

    await this.refreshTokensRepository.update(
      { userId, isRevoked: false },
      { isRevoked: true },
    );

    const hashedRefreshToken = await this.hashPassword(refreshToken);
    const existingToken = await this.refreshTokensRepository.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    if (existingToken) {
      existingToken.refreshToken = hashedRefreshToken;
      existingToken.expiredAt = expiredAt ?? new Date();
      existingToken.isRevoked = false;
      await this.refreshTokensRepository.save(existingToken);
      return;
    }

    const entity = this.refreshTokensRepository.create({
      userId,
      refreshToken: hashedRefreshToken,
      expiredAt: expiredAt ?? new Date(),
      isRevoked: false,
    });

    await this.refreshTokensRepository.save(entity);
  }

  async validateStoredRefreshToken(userId: string, refreshToken: string) {
    const storedToken = await this.refreshTokensRepository.findOne({
      where: { userId, isRevoked: false },
      order: { createdAt: 'DESC' },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token khong hop le');
    }

    const isValid = await this.checkUserPassword(
      refreshToken,
      storedToken.refreshToken,
    );

    if (!isValid) {
      throw new UnauthorizedException('Refresh token khong hop le');
    }

    if (storedToken.expiredAt.getTime() <= Date.now()) {
      await this.refreshTokensRepository.update(
        { tokenId: storedToken.tokenId },
        { isRevoked: true },
      );
      throw new UnauthorizedException('Refresh token da het han');
    }
  }

  private toPublicUser(user: UserEntity): IUser {
    return {
      _id: user.userId,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: {
        _id: user.role,
        name: user.role,
      },
      permissions: [],
    };
  }

  private toShippingAddressResponse(address: ShippingAddressEntity) {
    return {
      id: address.shippingAddressId,
      recipientName: address.recipientName,
      phone: address.phone,
      addressLine: address.addressLine,
      ward: address.ward,
      district: address.district,
      province: address.province,
      isDefault: address.isDefault,
      createdAt: address.createdAt,
      updatedAt: address.updatedAt,
    };
  }

  private toOrderSummaryResponse(order: OrderEntity) {
    return {
      id: order.orderId,
      status: order.orderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      totalPayment: order.totalPayment,
      totalQuantity: order.totalQuantity,
      createdAt: order.createdAt,
      fullName: order.fullName,
      phone: order.phone,
      address: order.address,
    };
  }

  private async ensureUserExists(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new UnauthorizedException('Nguoi dung khong ton tai');
    }

    return user;
  }

  private async ensureUniqueIdentity(
    username: string,
    email: string,
    excludeUserId?: string,
  ) {
    const existedByUsername = await this.usersRepository.findOne({
      where: { username },
    });
    if (existedByUsername && existedByUsername.userId !== excludeUserId) {
      throw new ConflictException('Username da ton tai');
    }

    const existedByEmail = await this.usersRepository.findOne({
      where: { email },
    });
    if (existedByEmail && existedByEmail.userId !== excludeUserId) {
      throw new ConflictException('Email da ton tai');
    }
  }

  private async clearDefaultShippingAddress(userId: string) {
    await this.shippingAddressesRepository.update(
      { userId },
      { isDefault: false },
    );
  }

  private async findOwnedShippingAddress(
    userId: string,
    shippingAddressId: string,
  ) {
    const address = await this.shippingAddressesRepository.findOneBy({
      shippingAddressId,
      userId,
    });

    if (!address) {
      throw new NotFoundException('Dia chi giao hang khong ton tai');
    }

    return address;
  }

  async updateProfile(userId: string, updateUserDto: UpdateUserDto) {
    const user = await this.ensureUserExists(userId);

    if (updateUserDto.username !== undefined) {
      const existedUsername = await this.usersRepository.findOne({
        where: { username: updateUserDto.username },
      });

      if (existedUsername && existedUsername.userId !== userId) {
        throw new ConflictException('Username da ton tai');
      }

      user.username = updateUserDto.username;
    }

    if (updateUserDto.avatarUrl !== undefined) {
      user.avatarUrl = updateUserDto.avatarUrl;
    }

    const savedUser = await this.usersRepository.save(user);
    return this.toPublicUser(savedUser);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.ensureUserExists(userId);

    if (!user.passwordHash) {
      throw new BadRequestException('Tai khoan khong ho tro mat khau');
    }

    const isCorrectPassword = await this.checkUserPassword(
      dto.oldPassword,
      user.passwordHash,
    );

    if (!isCorrectPassword) {
      throw new BadRequestException('Mat khau cu khong dung');
    }

    const isSamePassword = await this.checkUserPassword(
      dto.newPassword,
      user.passwordHash,
    );

    if (isSamePassword) {
      throw new BadRequestException('Mat khau moi phai khac mat khau cu');
    }

    user.passwordHash = await this.hashPassword(dto.newPassword);
    await this.usersRepository.save(user);

    return {
      message: 'Doi mat khau thanh cong',
    };
  }

  async findMyShippingAddresses(userId: string) {
    await this.ensureUserExists(userId);

    const addresses = await this.shippingAddressesRepository.find({
      where: { userId },
      order: { isDefault: 'DESC', updatedAt: 'DESC' },
    });

    return addresses.map((address) => this.toShippingAddressResponse(address));
  }

  async createShippingAddress(
    userId: string,
    createShippingAddressDto: CreateShippingAddressDto,
  ) {
    await this.ensureUserExists(userId);

    const existingCount = await this.shippingAddressesRepository.count({
      where: { userId },
    });
    const shouldSetDefault =
      createShippingAddressDto.isDefault === true || existingCount === 0;

    if (shouldSetDefault) {
      await this.clearDefaultShippingAddress(userId);
    }

    const address = this.shippingAddressesRepository.create({
      userId,
      recipientName: createShippingAddressDto.recipientName,
      phone: createShippingAddressDto.phone,
      addressLine: createShippingAddressDto.addressLine,
      ward: createShippingAddressDto.ward ?? null,
      district: createShippingAddressDto.district ?? null,
      province: createShippingAddressDto.province ?? null,
      isDefault: shouldSetDefault,
    });

    const savedAddress = await this.shippingAddressesRepository.save(address);
    return this.toShippingAddressResponse(savedAddress);
  }

  async updateShippingAddress(
    userId: string,
    shippingAddressId: string,
    updateShippingAddressDto: UpdateShippingAddressDto,
  ) {
    const address = await this.findOwnedShippingAddress(
      userId,
      shippingAddressId,
    );

    if (updateShippingAddressDto.isDefault === true) {
      await this.clearDefaultShippingAddress(userId);
      address.isDefault = true;
    }

    if (updateShippingAddressDto.recipientName !== undefined) {
      address.recipientName = updateShippingAddressDto.recipientName;
    }

    if (updateShippingAddressDto.phone !== undefined) {
      address.phone = updateShippingAddressDto.phone;
    }

    if (updateShippingAddressDto.addressLine !== undefined) {
      address.addressLine = updateShippingAddressDto.addressLine;
    }

    if (updateShippingAddressDto.ward !== undefined) {
      address.ward = updateShippingAddressDto.ward ?? null;
    }

    if (updateShippingAddressDto.district !== undefined) {
      address.district = updateShippingAddressDto.district ?? null;
    }

    if (updateShippingAddressDto.province !== undefined) {
      address.province = updateShippingAddressDto.province ?? null;
    }

    const savedAddress = await this.shippingAddressesRepository.save(address);
    return this.toShippingAddressResponse(savedAddress);
  }

  async deleteShippingAddress(userId: string, shippingAddressId: string) {
    const address = await this.findOwnedShippingAddress(
      userId,
      shippingAddressId,
    );

    await this.shippingAddressesRepository.delete({
      shippingAddressId,
      userId,
    });

    if (address.isDefault) {
      const nextAddress = await this.shippingAddressesRepository.findOne({
        where: { userId },
        order: { updatedAt: 'DESC' },
      });

      if (nextAddress) {
        nextAddress.isDefault = true;
        await this.shippingAddressesRepository.save(nextAddress);
      }
    }

    return {
      id: shippingAddressId,
      deleted: true,
    };
  }

  async setDefaultShippingAddress(userId: string, shippingAddressId: string) {
    const address = await this.findOwnedShippingAddress(
      userId,
      shippingAddressId,
    );

    await this.clearDefaultShippingAddress(userId);
    address.isDefault = true;

    const savedAddress = await this.shippingAddressesRepository.save(address);
    return this.toShippingAddressResponse(savedAddress);
  }

  async findMyOrders(userId: string) {
    await this.ensureUserExists(userId);

    const orders = await this.ordersRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return orders.map((order) => this.toOrderSummaryResponse(order));
  }

  async findMyOrderDetail(userId: string, orderId: string) {
    await this.ensureUserExists(userId);

    const order = await this.ordersRepository.findOneBy({ orderId, userId });
    if (!order) {
      throw new NotFoundException('Don hang khong ton tai');
    }

    const items = await this.orderItemsRepository.find({
      where: { orderId: order.orderId },
      order: { createdAt: 'ASC', orderItemId: 'ASC' },
    });

    return {
      ...this.toOrderSummaryResponse(order),
      shippingAddressId: order.shippingAddressId,
      deliveryId: order.deliveryId,
      discountId: order.discountId,
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
      deliveryCost: order.deliveryCost,
      note: order.note,
      items: items.map((item) => ({
        id: item.orderItemId,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
    };
  }

  async findAdminUserDetail(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new NotFoundException('Nguoi dung khong ton tai');
    }

    const [addressesCount, ordersCount] = await Promise.all([
      this.shippingAddressesRepository.count({ where: { userId } }),
      this.ordersRepository.count({ where: { userId } }),
    ]);

    return {
      ...this.toPublicUser(user),
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      statistics: {
        addressesCount,
        ordersCount,
      },
    };
  }

  async updateAdminUser(
    actorUserId: string,
    userId: string,
    updateAdminUserDto: UpdateAdminUserDto,
  ) {
    const user = await this.ensureUserExists(userId);

    if (updateAdminUserDto.username !== undefined) {
      await this.ensureUniqueIdentity(
        updateAdminUserDto.username,
        updateAdminUserDto.email ?? user.email,
        userId,
      );
      user.username = updateAdminUserDto.username;
    }

    if (
      updateAdminUserDto.email !== undefined &&
      updateAdminUserDto.email !== user.email
    ) {
      await this.ensureUniqueIdentity(
        updateAdminUserDto.username ?? user.username,
        updateAdminUserDto.email,
        userId,
      );
      user.email = updateAdminUserDto.email;
    }

    if (updateAdminUserDto.avatarUrl !== undefined) {
      user.avatarUrl = updateAdminUserDto.avatarUrl;
    }

    if (updateAdminUserDto.password !== undefined) {
      user.passwordHash = await this.hashPassword(updateAdminUserDto.password);
    }

    if (updateAdminUserDto.role !== undefined) {
      if (actorUserId === userId && updateAdminUserDto.role !== user.role) {
        throw new BadRequestException('Khong the tu thay doi vai tro cua chinh minh');
      }
      user.role = updateAdminUserDto.role;
    }

    if (updateAdminUserDto.isActive !== undefined) {
      if (actorUserId === userId && updateAdminUserDto.isActive === false) {
        throw new BadRequestException('Khong the tu vo hieu hoa tai khoan cua chinh minh');
      }
      user.isActive = updateAdminUserDto.isActive;
    }

    const savedUser = await this.usersRepository.save(user);
    return {
      ...this.toPublicUser(savedUser),
      isActive: savedUser.isActive,
      createdAt: savedUser.createdAt,
      updatedAt: savedUser.updatedAt,
    };
  }

  async updateAdminUserStatus(
    actorUserId: string,
    userId: string,
    updateAdminUserStatusDto: UpdateAdminUserStatusDto,
  ) {
    const user = await this.ensureUserExists(userId);

    if (updateAdminUserStatusDto.isActive !== undefined) {
      if (actorUserId === userId && updateAdminUserStatusDto.isActive === false) {
        throw new BadRequestException('Khong the tu vo hieu hoa tai khoan cua chinh minh');
      }
      user.isActive = updateAdminUserStatusDto.isActive;
    }

    const savedUser = await this.usersRepository.save(user);
    return {
      ...this.toPublicUser(savedUser),
      isActive: savedUser.isActive,
    };
  }

  async resetAdminUserPassword(
    actorUserId: string,
    userId: string,
    dto: ResetAdminUserPasswordDto,
  ) {
    const user = await this.ensureUserExists(userId);

    if (actorUserId === userId) {
      throw new BadRequestException('Khong the tu reset mat khau cua chinh minh bang thao tac admin');
    }

    user.passwordHash = await this.hashPassword(dto.newPassword);
    const savedUser = await this.usersRepository.save(user);

    await this.refreshTokensRepository.update(
      { userId: savedUser.userId, isRevoked: false },
      { isRevoked: true },
    );

    return {
      ...this.toPublicUser(savedUser),
      passwordReset: true,
    };
  }

  async deleteAdminUser(actorUserId: string, userId: string) {
    const user = await this.ensureUserExists(userId);

    if (actorUserId === userId) {
      throw new BadRequestException('Khong the tu xoa tai khoan cua chinh minh');
    }

    const [ordersCount, returnsCount, paymentTransactionsCount] =
      await Promise.all([
        this.ordersRepository.count({ where: { userId } }),
        this.returnsRepository.count({ where: { userId } }),
        this.paymentTransactionsRepository.count({ where: { userId } }),
      ]);

    if (ordersCount > 0 || returnsCount > 0 || paymentTransactionsCount > 0) {
      throw new BadRequestException(
        'Khong the xoa tai khoan da phat sinh don hang, tra hang hoac giao dich thanh toan',
      );
    }

    const carts = await this.shoppingCartsRepository.find({
      where: { userId },
      select: { cartId: true },
    });
    const cartIds = carts.map((cart) => cart.cartId);

    if (cartIds.length > 0) {
      await this.cartItemsRepository.delete({ cartId: In(cartIds) });
      await this.shoppingCartsRepository.delete({ userId });
    }

    await Promise.all([
      this.wishlistRepository.delete({ userId }),
      this.shippingAddressesRepository.delete({ userId }),
      this.refreshTokensRepository.delete({ userId }),
      this.contactsRepository.update({ userId }, { userId: null }),
      this.notificationsRepository.update(
        { userId },
        { userId: null, email: user.email },
      ),
    ]);

    await this.usersRepository.delete({ userId });

    return {
      _id: user.userId,
      deleted: true,
    };
  }
}
