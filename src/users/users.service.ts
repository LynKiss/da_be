import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
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
import {
  OrderEntity,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { PaymentTransactionEntity } from '../orders/entities/payment-transaction.entity';
import { ReturnEntity, ReturnStatus } from '../orders/entities/return.entity';
import { ShippingAddressEntity } from '../orders/entities/shipping-address.entity';
import { ProductImageEntity } from '../products/entities/product-image.entity';
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

type UploadedImageFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

const PASSWORD_RESET_OTP_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW = 3;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_INVALID_MESSAGE = 'Email hoac ma OTP khong hop le';
const ONLINE_RETRY_PAYMENT_METHODS = [
  PaymentMethod.MOMO,
  PaymentMethod.VNPAY,
  PaymentMethod.ZALOPAY,
];
const ONLINE_PAYMENT_TTL_MS = 30 * 60 * 1000;

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
    @InjectRepository(ProductImageEntity)
    private readonly productImagesRepository: Repository<ProductImageEntity>,
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
        '(user.username LIKE :search OR user.email LIKE :search OR user.full_name LIKE :search OR user.phone_number LIKE :search)',
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
        isWholesale: user.isWholesale,
        createdAt: user.createdAt,
      })),
    };
  }

  async findProfile(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new UnauthorizedException('Nguoi dung khong ton tai');
    }

    return { ...this.toPublicUser(user), isWholesale: user.isWholesale };
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
      fullName: registerUserDto.fullName?.trim() || null,
      phoneNumber: registerUserDto.phoneNumber?.trim() || null,
      avatarUrl: registerUserDto.avatarUrl ?? null,
      role: UserRole.CUSTOMER,
      passwordHash: await this.hashPassword(registerUserDto.password),
      provider: 'local',
      providerId: null,
      isActive: true,
      resetPasswordCode: null,
      resetPasswordExpiresAt: null,
      resetPasswordRequestCount: 0,
      resetPasswordLastRequestedAt: null,
      resetPasswordAttemptCount: 0,
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

  async createPasswordResetOtp(email: string) {
    const now = Date.now();
    const user = await this.usersRepository.findOne({
      where: { email: email.trim() },
    });

    if (!user || !user.isActive || !user.passwordHash) {
      return null;
    }

    const lastRequestedAt =
      user.resetPasswordLastRequestedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const currentWindowActive =
      lastRequestedAt + PASSWORD_RESET_REQUEST_WINDOW_MS > now;
    const currentRequestCount = Number(user.resetPasswordRequestCount ?? 0);

    if (
      currentWindowActive &&
      currentRequestCount >= PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW
    ) {
      return null;
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    user.resetPasswordCode = await this.hashPassword(otp);
    user.resetPasswordExpiresAt = new Date(now + PASSWORD_RESET_OTP_TTL_MS);
    user.resetPasswordRequestCount = currentWindowActive
      ? currentRequestCount + 1
      : 1;
    user.resetPasswordLastRequestedAt = new Date(now);
    user.resetPasswordAttemptCount = 0;
    await this.usersRepository.save(user);

    return {
      email: user.email,
      fullName: user.fullName,
      username: user.username,
      otp,
      expiresInMinutes: PASSWORD_RESET_OTP_TTL_MS / 60_000,
    };
  }

  async resetPasswordByOtp(email: string, otp: string, newPassword: string) {
    const user = await this.usersRepository.findOne({
      where: { email: email.trim() },
    });

    if (!user || !user.isActive) {
      throw new BadRequestException(PASSWORD_RESET_INVALID_MESSAGE);
    }

    if (!user.resetPasswordCode || !user.resetPasswordExpiresAt) {
      throw new BadRequestException(PASSWORD_RESET_INVALID_MESSAGE);
    }

    if (user.resetPasswordExpiresAt.getTime() <= Date.now()) {
      user.resetPasswordCode = null;
      user.resetPasswordExpiresAt = null;
      user.resetPasswordAttemptCount = 0;
      await this.usersRepository.save(user);
      throw new BadRequestException(PASSWORD_RESET_INVALID_MESSAGE);
    }

    if (
      Number(user.resetPasswordAttemptCount ?? 0) >=
      PASSWORD_RESET_MAX_ATTEMPTS
    ) {
      user.resetPasswordCode = null;
      user.resetPasswordExpiresAt = null;
      user.resetPasswordAttemptCount = 0;
      await this.usersRepository.save(user);
      throw new BadRequestException(PASSWORD_RESET_INVALID_MESSAGE);
    }

    const isValidOtp = await this.checkUserPassword(
      otp,
      user.resetPasswordCode,
    );
    if (!isValidOtp) {
      user.resetPasswordAttemptCount =
        Number(user.resetPasswordAttemptCount ?? 0) + 1;
      if (user.resetPasswordAttemptCount >= PASSWORD_RESET_MAX_ATTEMPTS) {
        user.resetPasswordCode = null;
        user.resetPasswordExpiresAt = null;
        user.resetPasswordAttemptCount = 0;
      }
      await this.usersRepository.save(user);
      throw new BadRequestException(PASSWORD_RESET_INVALID_MESSAGE);
    }

    if (
      user.passwordHash &&
      (await this.checkUserPassword(newPassword, user.passwordHash))
    ) {
      throw new BadRequestException('Mat khau moi phai khac mat khau cu');
    }

    user.passwordHash = await this.hashPassword(newPassword);
    user.resetPasswordCode = null;
    user.resetPasswordExpiresAt = null;
    user.resetPasswordRequestCount = 0;
    user.resetPasswordLastRequestedAt = null;
    user.resetPasswordAttemptCount = 0;
    const savedUser = await this.usersRepository.save(user);

    await this.refreshTokensRepository.update(
      { userId: savedUser.userId, isRevoked: false },
      { isRevoked: true },
    );

    return {
      message: 'Dat lai mat khau thanh cong',
    };
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
      fullName: createAdminUserDto.fullName?.trim() || null,
      phoneNumber: createAdminUserDto.phoneNumber?.trim() || null,
      avatarUrl: createAdminUserDto.avatarUrl ?? null,
      role: createAdminUserDto.role ?? UserRole.CUSTOMER,
      passwordHash: await this.hashPassword(createAdminUserDto.password),
      provider: 'local',
      providerId: null,
      isActive: createAdminUserDto.isActive ?? true,
      isWholesale: createAdminUserDto.isWholesale ?? false,
      resetPasswordCode: null,
      resetPasswordExpiresAt: null,
    });

    const savedUser = await this.usersRepository.save(user);
    return {
      ...this.toPublicUser(savedUser),
      isActive: savedUser.isActive,
      isWholesale: savedUser.isWholesale,
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
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
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

  private getPaymentRetryInfo(order: OrderEntity) {
    const isOnline = ONLINE_RETRY_PAYMENT_METHODS.includes(order.paymentMethod);
    const paymentDeadline = isOnline
      ? new Date(order.createdAt.getTime() + ONLINE_PAYMENT_TTL_MS)
      : null;
    const paymentTimeRemainingSeconds = paymentDeadline
      ? Math.max(0, Math.floor((paymentDeadline.getTime() - Date.now()) / 1000))
      : null;
    const hasCollectedPayment = [
      PaymentStatus.PAID,
      PaymentStatus.PARTIAL_REFUNDED,
      PaymentStatus.REFUNDED,
    ].includes(order.paymentStatus);
    const isClosed = [
      OrderStatus.CANCELLED,
      OrderStatus.RETURNED,
      OrderStatus.DELIVERED,
      OrderStatus.PARTIAL_DELIVERED,
      OrderStatus.PARTIAL_RETURNED,
      OrderStatus.SHIPPING,
      OrderStatus.PROCESSING,
    ].includes(order.orderStatus);
    const expired = paymentDeadline ? paymentDeadline.getTime() <= Date.now() : false;
    let paymentBlockedReason: string | null = null;

    if (!isOnline) {
      paymentBlockedReason = 'UNSUPPORTED_PAYMENT_METHOD';
    } else if (hasCollectedPayment) {
      paymentBlockedReason = 'ALREADY_PAID';
    } else if (isClosed) {
      paymentBlockedReason = 'ORDER_CANCELLED';
    } else if (expired) {
      paymentBlockedReason = 'PAYMENT_EXPIRED';
    }

    return {
      paymentDeadline,
      paymentTimeRemainingSeconds,
      canRetryPayment:
        !paymentBlockedReason &&
        [OrderStatus.PENDING, OrderStatus.BACKORDERED].includes(order.orderStatus) &&
        [PaymentStatus.UNPAID, PaymentStatus.FAILED].includes(order.paymentStatus),
      canCancelUnpaid:
        !hasCollectedPayment &&
        [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.BACKORDERED].includes(
          order.orderStatus,
        ),
      paymentBlockedReason,
    };
  }

  private toOrderSummaryResponse(order: OrderEntity) {
    return {
      id: order.orderId,
      status: order.orderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      ...this.getPaymentRetryInfo(order),
      totalPayment: order.totalPayment,
      totalQuantity: order.totalQuantity,
      createdAt: order.createdAt,
      fullName: order.fullName,
      phone: order.phone,
      address: order.address,
      fulfillmentType: order.fulfillmentType,
      deliveryMethodName: order.deliveryMethodNameSnapshot,
      freeShippingApplied: order.freeShippingApplied,
      pickupContactName: order.pickupContactName,
      pickupContactPhone: order.pickupContactPhone,
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

    if (updateUserDto.fullName !== undefined) {
      user.fullName = updateUserDto.fullName.trim() || null;
    }

    if (updateUserDto.phoneNumber !== undefined) {
      user.phoneNumber = updateUserDto.phoneNumber.trim() || null;
    }

    const savedUser = await this.usersRepository.save(user);
    return this.toPublicUser(savedUser);
  }

  async uploadMyAvatar(userId: string, file: UploadedImageFile | undefined) {
    const user = await this.ensureUserExists(userId);
    user.avatarUrl = await this.uploadAvatarToCloudinary(file, userId);
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

  async findMyOrders(
    userId: string,
    opts: {
      page: number;
      limit: number;
      status?: string;
      search?: string;
      from?: string;
      to?: string;
      paymentStatus?: string;
      paymentMethod?: string;
    },
  ) {
    await this.ensureUserExists(userId);

    const query = this.ordersRepository
      .createQueryBuilder('order')
      .where('order.user_id = :userId', { userId });
    if (opts.status && opts.status !== 'all') {
      if (!Object.values(OrderStatus).includes(opts.status as OrderStatus)) {
        throw new BadRequestException('Trạng thái đơn hàng không hợp lệ');
      }
      query.andWhere('order.order_status = :status', { status: opts.status });
    }

    if (opts.paymentStatus && opts.paymentStatus !== 'all') {
      if (!Object.values(PaymentStatus).includes(opts.paymentStatus as PaymentStatus)) {
        throw new BadRequestException('Trạng thái thanh toán không hợp lệ');
      }
      query.andWhere('order.payment_status = :paymentStatus', {
        paymentStatus: opts.paymentStatus,
      });
    }

    if (opts.paymentMethod && opts.paymentMethod !== 'all') {
      if (!Object.values(PaymentMethod).includes(opts.paymentMethod as PaymentMethod)) {
        throw new BadRequestException('Phương thức thanh toán không hợp lệ');
      }
      query.andWhere('order.payment_method = :paymentMethod', {
        paymentMethod: opts.paymentMethod,
      });
    }

    if (opts.from?.trim()) {
      const fromDate = new Date(`${opts.from.trim()}T00:00:00`);
      if (Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException('Từ ngày không hợp lệ');
      }
      query.andWhere('order.created_at >= :fromDate', { fromDate });
    }

    if (opts.to?.trim()) {
      const toDate = new Date(`${opts.to.trim()}T23:59:59.999`);
      if (Number.isNaN(toDate.getTime())) {
        throw new BadRequestException('Đến ngày không hợp lệ');
      }
      query.andWhere('order.created_at <= :toDate', { toDate });
    }

    const search = opts.search?.trim();
    if (search) {
      query.andWhere(
        [
          '(order.order_id LIKE :search',
          'order.full_name LIKE :search',
          'order.phone LIKE :search',
          'order.address LIKE :search',
          'order.payment_method LIKE :search',
          `EXISTS (
            SELECT 1
            FROM order_items item
            WHERE item.order_id = order.order_id
              AND item.product_name LIKE :search
          ))`,
        ].join(' OR '),
        { search: `%${search}%` },
      );
    }

    const total = await query.clone().getCount();
    const rows = await query
      .clone()
      .select('order.order_id', 'orderId')
      .orderBy('order.created_at', 'DESC')
      .addOrderBy('order.order_id', 'DESC')
      .offset((opts.page - 1) * opts.limit)
      .limit(opts.limit)
      .getRawMany<{ orderId: string }>();

    const orderIds = rows.map((row) => row.orderId).filter(Boolean);
    const orders = orderIds.length
      ? await this.ordersRepository.find({
          where: { orderId: In(orderIds) },
        })
      : [];
    const orderById = new Map(orders.map((order) => [order.orderId, order]));
    const sortedOrders = orderIds
      .map((orderId) => orderById.get(orderId))
      .filter((order): order is OrderEntity => Boolean(order));

    return {
      items: sortedOrders.map((order) => this.toOrderSummaryResponse(order)),
      total,
      page: opts.page,
      limit: opts.limit,
      totalPages: Math.max(1, Math.ceil(total / opts.limit)),
    };
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
    const productImageByProductId = await this.getPrimaryImageMap(
      items.map((item) => item.productId),
    );

    // ── Return window (đồng bộ với OrdersService.buildOrderDetail) ──
    const RETURN_WINDOW_DAYS = 7;
    const RETURN_WINDOW_MS = RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const returnableStatuses = [
      OrderStatus.DELIVERED,
      OrderStatus.PARTIAL_DELIVERED,
      OrderStatus.PARTIAL_RETURNED,
    ];
    let canCreateReturn = false;
    let returnDeadline: string | null = null;
    let returnBlockedReason: string | null = 'RETURN_NOT_DELIVERED_YET';
    if (returnableStatuses.includes(order.orderStatus)) {
      const deliveredAt = order.updatedAt ?? order.createdAt ?? new Date();
      const deadline = new Date(deliveredAt.getTime() + RETURN_WINDOW_MS);
      const expired = deadline.getTime() < Date.now();
      returnDeadline = deadline.toISOString();
      canCreateReturn = !expired;
      returnBlockedReason = expired ? 'RETURN_WINDOW_EXPIRED' : null;
    }

    // Số lượng đã trả (các yêu cầu đang mở / đã hoàn) theo từng orderItem
    const reservedStatuses: ReturnStatus[] = [
      ReturnStatus.REQUESTED,
      ReturnStatus.APPROVED,
      ReturnStatus.RECEIVED,
      ReturnStatus.INSPECTED,
      ReturnStatus.REFUNDED,
    ];
    const existingReturns = await this.returnsRepository.find({
      where: { orderId: order.orderId },
    });
    const returnedQtyByItem = new Map<string, number>();
    for (const r of existingReturns) {
      if (!reservedStatuses.includes(r.returnStatus)) continue;
      returnedQtyByItem.set(
        r.orderItemId,
        (returnedQtyByItem.get(r.orderItemId) ?? 0) + Number(r.returnQuantity ?? 0),
      );
    }

    const isPartial = [
      OrderStatus.PARTIAL_DELIVERED,
      OrderStatus.PARTIAL_RETURNED,
    ].includes(order.orderStatus);

    return {
      ...this.toOrderSummaryResponse(order),
      shippingAddressId: order.shippingAddressId,
      deliveryId: order.deliveryId,
      discountId: order.discountId,
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
      deliveryCost: order.deliveryCost,
      note: order.note,
      returnWindowDays: RETURN_WINDOW_DAYS,
      returnDeadline,
      canCreateReturn,
      returnBlockedReason,
      items: items.map((item) => {
        const base = isPartial
          ? Math.max(0, Number(item.quantityDelivered ?? 0))
          : Math.max(0, Number(item.quantity ?? 0));
        const alreadyReturned = returnedQtyByItem.get(item.orderItemId) ?? 0;
        const returnableQuantity = canCreateReturn
          ? Math.max(0, base - alreadyReturned)
          : 0;
        return {
          id: item.orderItemId,
          productId: item.productId,
          productName: item.productName,
          primaryImageUrl: productImageByProductId.get(item.productId) ?? null,
          quantity: item.quantity,
          quantityDelivered: item.quantityDelivered ?? item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          returnableQuantity,
        };
      }),
    };
  }

  private async getPrimaryImageMap(productIds: string[]) {
    const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
    if (uniqueProductIds.length === 0) {
      return new Map<string, string>();
    }

    const images = await this.productImagesRepository.find({
      where: { productId: In(uniqueProductIds) },
      order: { isPrimary: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
    });

    const imageByProductId = new Map<string, string>();
    for (const image of images) {
      if (!imageByProductId.has(image.productId)) {
        imageByProductId.set(image.productId, image.imageUrl);
      }
    }

    return imageByProductId;
  }

  async findAdminUserDetail(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new NotFoundException('Nguoi dung khong ton tai');
    }

    const [addressesCount, ordersCount, addresses, recentOrders] = await Promise.all([
      this.shippingAddressesRepository.count({ where: { userId } }),
      this.ordersRepository.count({ where: { userId } }),
      this.shippingAddressesRepository.find({
        where: { userId },
        order: { isDefault: 'DESC', updatedAt: 'DESC', createdAt: 'DESC' },
        take: 3,
      }),
      this.ordersRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
    ]);

    return {
      ...this.toPublicUser(user),
      isActive: user.isActive,
      isWholesale: user.isWholesale,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      statistics: {
        addressesCount,
        ordersCount,
      },
      addresses: addresses.map((address) => this.toShippingAddressResponse(address)),
      recentOrders: recentOrders.map((order) => this.toOrderSummaryResponse(order)),
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

    if (updateAdminUserDto.fullName !== undefined) {
      user.fullName = updateAdminUserDto.fullName.trim() || null;
    }

    if (updateAdminUserDto.phoneNumber !== undefined) {
      user.phoneNumber = updateAdminUserDto.phoneNumber.trim() || null;
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

    if (updateAdminUserDto.isWholesale !== undefined) {
      user.isWholesale = updateAdminUserDto.isWholesale;
    }

    const savedUser = await this.usersRepository.save(user);
    return {
      ...this.toPublicUser(savedUser),
      isActive: savedUser.isActive,
      isWholesale: savedUser.isWholesale,
      createdAt: savedUser.createdAt,
      updatedAt: savedUser.updatedAt,
    };
  }

  async uploadAdminUserAvatar(
    actorUserId: string,
    userId: string,
    file: UploadedImageFile | undefined,
  ) {
    await this.ensureUserExists(actorUserId);
    const user = await this.ensureUserExists(userId);
    user.avatarUrl = await this.uploadAvatarToCloudinary(file, userId);
    const savedUser = await this.usersRepository.save(user);
    return {
      ...this.toPublicUser(savedUser),
      isActive: savedUser.isActive,
      isWholesale: savedUser.isWholesale,
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

  private async uploadAvatarToCloudinary(
    file: UploadedImageFile | undefined,
    userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Image size must be 5MB or less');
    }

    const cloudName = process.env.CLOUD_NAME;
    const apiKey = process.env.API_KEY;
    const apiSecret = process.env.API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Cloudinary environment variables are missing',
      );
    }

    const folder = 'agri_ecommerce/avatars';
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `${userId}-${Date.now()}`;
    const signature = createHash('sha1')
      .update(
        `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`,
      )
      .digest('hex');

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
    formData.append('api_key', apiKey);
    formData.append('timestamp', String(timestamp));
    formData.append('signature', signature);
    formData.append('folder', folder);
    formData.append('public_id', publicId);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: formData },
    );

    const payload = (await response.json()) as {
      secure_url?: string;
      error?: { message?: string };
    };

    if (!response.ok || !payload.secure_url) {
      throw new InternalServerErrorException(
        payload.error?.message ?? 'Unable to upload image to Cloudinary',
      );
    }

    return payload.secure_url;
  }
}
