import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { OrderEntity, OrderStatus } from '../orders/entities/order.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { UserEntity } from '../users/entities/user.entity';
import { CreateReviewDto } from './dto/create-review.dto';
import { CommentEntity, ProductCommentStatus } from './entities/comment.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(CommentEntity)
    private readonly commentsRepository: Repository<CommentEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
    @InjectRepository(OrderEntity)
    private readonly ordersRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemsRepository: Repository<OrderItemEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async findProductReviews(productId: string) {
    await this.ensureProductExists(productId);

    const reviews = await this.commentsRepository.find({
      where: {
        productId,
        status: ProductCommentStatus.VISIBLE,
      },
      order: { createdAt: 'DESC' },
    });

    return reviews.map((review) => ({
      id: review.commentId,
      userId: review.userId,
      orderItemId: review.orderItemId,
      content: review.content,
      rating: review.rating,
      likeCount: review.likeCount,
      dislikeCount: review.dislikeCount,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    }));
  }

  async createReview(userId: string, productId: string, dto: CreateReviewDto) {
    await this.ensureUserExists(userId);
    await this.ensureProductExists(productId);

    const orderItem = await this.orderItemsRepository.findOneBy({
      orderItemId: dto.orderItemId,
    });
    if (!orderItem || orderItem.productId !== productId) {
      throw new NotFoundException('Order item not found');
    }

    const ownedOrder = await this.ordersRepository.findOneBy({
      orderId: orderItem.orderId,
      userId,
    });
    if (!ownedOrder) {
      throw new UnauthorizedException('Ban khong so huu san pham da mua nay');
    }

    if (ownedOrder.orderStatus !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Chi duoc danh gia sau khi don hang da giao thanh cong',
      );
    }

    const existingReview = await this.commentsRepository.findOneBy({
      userId,
      orderItemId: dto.orderItemId,
    });
    if (existingReview) {
      throw new ConflictException('Ban da danh gia san pham nay roi');
    }

    const review = this.commentsRepository.create({
      userId,
      productId,
      orderItemId: dto.orderItemId,
      content: dto.content,
      rating: dto.rating,
      likeCount: 0,
      dislikeCount: 0,
      status: ProductCommentStatus.VISIBLE,
    });

    const savedReview = await this.commentsRepository.save(review);
    await this.refreshProductRating(productId);

    return {
      id: savedReview.commentId,
      userId: savedReview.userId,
      productId: savedReview.productId,
      orderItemId: savedReview.orderItemId,
      content: savedReview.content,
      rating: savedReview.rating,
      status: savedReview.status,
      createdAt: savedReview.createdAt,
      updatedAt: savedReview.updatedAt,
    };
  }

  private async refreshProductRating(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      return;
    }

    const reviews = await this.commentsRepository.find({
      where: {
        productId,
        status: ProductCommentStatus.VISIBLE,
      },
    });

    const ratingValues = reviews
      .map((review) => review.rating)
      .filter((rating): rating is number => typeof rating === 'number');
    const ratingCount = ratingValues.length;
    const ratingAverage =
      ratingCount === 0
        ? 0
        : ratingValues.reduce((sum, rating) => sum + rating, 0) / ratingCount;

    product.ratingCount = ratingCount;
    product.ratingAverage = ratingAverage.toFixed(2);
    await this.productsRepository.save(product);
  }

  private async ensureProductExists(productId: string) {
    const product = await this.productsRepository.findOneBy({ productId });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }

  private async ensureUserExists(userId: string) {
    const user = await this.usersRepository.findOneBy({ userId });
    if (!user) {
      throw new UnauthorizedException('Nguoi dung khong ton tai');
    }
  }
}
