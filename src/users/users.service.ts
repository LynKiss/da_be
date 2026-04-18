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
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { ShippingAddressEntity } from '../orders/entities/shipping-address.entity';
import { Repository } from 'typeorm';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateShippingAddressDto } from './dto/create-shipping-address.dto';
import { RegisterUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateShippingAddressDto } from './dto/update-shipping-address.dto';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserEntity, UserRole } from './entities/user.entity';
import { IUser } from './users.interface';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokensRepository: Repository<RefreshTokenEntity>,
    @InjectRepository(ShippingAddressEntity)
    private readonly shippingAddressesRepository: Repository<ShippingAddressEntity>,
    @InjectRepository(OrderEntity)
    private readonly ordersRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemsRepository: Repository<OrderItemEntity>,
  ) {}

  async findOneByUsername(username: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({
      where: [{ username }, { email: username }],
    });
  }

  async findOneByIdForAuth(userId: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({
      where: { userId },
      relations: { refreshToken: true },
    });
  }

  async findAll() {
    const users = await this.usersRepository.find({
      order: { createdAt: 'DESC' },
    });

    return users.map((user) => this.toPublicUser(user));
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
}
