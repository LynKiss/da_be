import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../products/entities/product.entity';
import { ProductImageEntity } from '../products/entities/product-image.entity';
import { UserEntity } from '../users/entities/user.entity';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartItemEntity } from './entities/cart-item.entity';
import { ShoppingCartEntity } from './entities/shopping-cart.entity';

@Injectable()
export class CartsService {
  constructor(
    @InjectRepository(ShoppingCartEntity)
    private readonly cartsRepository: Repository<ShoppingCartEntity>,
    @InjectRepository(CartItemEntity)
    private readonly cartItemsRepository: Repository<CartItemEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
    @InjectRepository(ProductImageEntity)
    private readonly productImagesRepository: Repository<ProductImageEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  private async ensureUserExists(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new UnauthorizedException('Nguoi dung khong ton tai');
    }
  }

  private getEffectivePrice(product: ProductEntity) {
    const sale = product.productPriceSale != null ? Number(product.productPriceSale) : null;
    return sale != null && sale > 0 ? product.productPriceSale! : product.productPrice;
  }

  private toMoney(value: string | number | null | undefined) {
    return Number(value ?? 0).toFixed(2);
  }

  private getStockIssue(item: CartItemEntity, product?: ProductEntity | null) {
    if (!product || !product.isShow) {
      return 'unavailable';
    }
    if (product.quantityAvailable <= 0) {
      return 'out_of_stock';
    }
    if (item.quantity > product.quantityAvailable) {
      return 'insufficient_stock';
    }
    return null;
  }

  private buildCartHash(
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: string;
      isUnavailable: boolean;
      stockIssue: string | null;
    }>,
  ) {
    const stableItems = items
      .map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: this.toMoney(item.unitPrice),
        isUnavailable: item.isUnavailable,
        stockIssue: item.stockIssue,
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId));

    return createHash('sha256')
      .update(JSON.stringify(stableItems))
      .digest('hex');
  }

  private toCartItemResponse(
    item: CartItemEntity,
    product?: ProductEntity | null,
    primaryImageUrl?: string | null,
  ) {
    const unitPrice = product
      ? this.toMoney(this.getEffectivePrice(product))
      : this.toMoney(item.priceAtAdded);
    const priceAtAdded = this.toMoney(item.priceAtAdded);
    const quantity = item.quantity;
    const lineTotal = (Number(unitPrice) * quantity).toFixed(2);
    const stockIssue = this.getStockIssue(item, product);
    const isUnavailable = !product || !product.isShow;

    return {
      id: item.cartItemId,
      productId: item.productId,
      productName: product?.productName ?? null,
      primaryImageUrl: primaryImageUrl ?? null,
      quantity,
      unitPrice,
      priceAtAdded,
      priceChanged: unitPrice !== priceAtAdded,
      isUnavailable,
      stockIssue,
      lineTotal,
      availableQuantity: product?.quantityAvailable ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private async getOrCreateCart(userId: string) {
    let cart = await this.cartsRepository.findOneBy({ userId });
    if (!cart) {
      cart = this.cartsRepository.create({ userId });
      cart = await this.cartsRepository.save(cart);
    }

    return cart;
  }

  private async findOwnedCartItem(userId: string, cartItemId: string) {
    const cart = await this.getOrCreateCart(userId);
    const item = await this.cartItemsRepository.findOneBy({
      cartItemId,
      cartId: cart.cartId,
    });

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    return { cart, item };
  }

  private async findAvailableProduct(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product || !product.isShow) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async getMyCart(userId: string) {
    await this.ensureUserExists(userId);
    const cart = await this.getOrCreateCart(userId);
    const items = await this.cartItemsRepository.find({
      where: { cartId: cart.cartId },
      order: { createdAt: 'DESC' },
    });

    const productIds = [...new Set(items.map((item) => item.productId))];
    const [products, primaryImages] = await Promise.all([
      productIds.length
        ? this.productsRepository.findBy(
            productIds.map((productId) => ({ productId })),
          )
        : Promise.resolve([]),
      productIds.length
        ? this.productImagesRepository.findBy(
            productIds.map((productId) => ({ productId, isPrimary: true })),
          )
        : Promise.resolve([]),
    ]);
    const productsById = new Map(
      products.map((product) => [product.productId, product]),
    );
    const primaryImageByProductId = new Map(
      primaryImages.map((img) => [img.productId, img.imageUrl]),
    );
    const mappedItems = items.map((item) =>
      this.toCartItemResponse(
        item,
        productsById.get(item.productId),
        primaryImageByProductId.get(item.productId),
      ),
    );
    const totalQuantity = mappedItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const totalAmount = mappedItems
      .reduce((sum, item) => sum + Number(item.lineTotal), 0)
      .toFixed(2);
    const cartHash = this.buildCartHash(mappedItems);
    const hasBlockedItem = mappedItems.some(
      (item) => item.isUnavailable || item.stockIssue,
    );
    const hasPriceChange = mappedItems.some((item) => item.priceChanged);

    return {
      id: cart.cartId,
      totalItems: mappedItems.length,
      totalQuantity,
      totalAmount,
      cartHash,
      validationStatus: hasBlockedItem
        ? 'blocked'
        : hasPriceChange
          ? 'needs_review'
          : 'ok',
      items: mappedItems,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
    };
  }

  async addItem(userId: string, addCartItemDto: AddCartItemDto) {
    await this.ensureUserExists(userId);
    const cart = await this.getOrCreateCart(userId);
    const product = await this.findAvailableProduct(addCartItemDto.productId);

    const existingItem = await this.cartItemsRepository.findOneBy({
      cartId: cart.cartId,
      productId: addCartItemDto.productId,
    });

    const nextQuantity =
      (existingItem?.quantity ?? 0) + addCartItemDto.quantity;

    if (nextQuantity > product.quantityAvailable) {
      throw new BadRequestException('Quantity exceeds available stock');
    }

    const item =
      existingItem ??
      this.cartItemsRepository.create({
        cartId: cart.cartId,
        productId: addCartItemDto.productId,
        quantity: 0,
        priceAtAdded: this.getEffectivePrice(product),
      });

    item.quantity = nextQuantity;
    item.priceAtAdded = this.getEffectivePrice(product);

    const primaryImg = await this.productImagesRepository.findOneBy({
      productId: product.productId,
      isPrimary: true,
    });
    const savedItem = await this.cartItemsRepository.save(item);
    return this.toCartItemResponse(savedItem, product, primaryImg?.imageUrl);
  }

  async updateItem(
    userId: string,
    cartItemId: string,
    updateCartItemDto: UpdateCartItemDto,
  ) {
    await this.ensureUserExists(userId);
    const { item } = await this.findOwnedCartItem(userId, cartItemId);
    const product = await this.findAvailableProduct(item.productId);

    if (updateCartItemDto.quantity > product.quantityAvailable) {
      throw new BadRequestException('Quantity exceeds available stock');
    }

    item.quantity = updateCartItemDto.quantity;
    item.priceAtAdded = this.getEffectivePrice(product);

    const primaryImg = await this.productImagesRepository.findOneBy({
      productId: product.productId,
      isPrimary: true,
    });
    const savedItem = await this.cartItemsRepository.save(item);
    return this.toCartItemResponse(savedItem, product, primaryImg?.imageUrl);
  }

  async deleteItem(userId: string, cartItemId: string) {
    await this.ensureUserExists(userId);
    const { item } = await this.findOwnedCartItem(userId, cartItemId);

    await this.cartItemsRepository.delete({ cartItemId: item.cartItemId });

    return {
      id: item.cartItemId,
      deleted: true,
    };
  }
}
