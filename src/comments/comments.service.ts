import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
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

  async likeComment(commentId: string) {
    const comment = await this.commentsRepository.findOneBy({ commentId });
    if (!comment) throw new NotFoundException('Review not found');
    await this.commentsRepository.increment({ commentId }, 'likeCount', 1);
    return { likeCount: comment.likeCount + 1, dislikeCount: comment.dislikeCount };
  }

  async unlikeComment(commentId: string) {
    const comment = await this.commentsRepository.findOneBy({ commentId });
    if (!comment) throw new NotFoundException('Review not found');
    if (comment.likeCount > 0) {
      await this.commentsRepository.decrement({ commentId }, 'likeCount', 1);
    }
    return { likeCount: Math.max(0, comment.likeCount - 1), dislikeCount: comment.dislikeCount };
  }

  async dislikeComment(commentId: string) {
    const comment = await this.commentsRepository.findOneBy({ commentId });
    if (!comment) throw new NotFoundException('Review not found');
    await this.commentsRepository.increment({ commentId }, 'dislikeCount', 1);
    return { likeCount: comment.likeCount, dislikeCount: comment.dislikeCount + 1 };
  }

  async undislikeComment(commentId: string) {
    const comment = await this.commentsRepository.findOneBy({ commentId });
    if (!comment) throw new NotFoundException('Review not found');
    if (comment.dislikeCount > 0) {
      await this.commentsRepository.decrement({ commentId }, 'dislikeCount', 1);
    }
    return { likeCount: comment.likeCount, dislikeCount: Math.max(0, comment.dislikeCount - 1) };
  }

  async findAdminReviews(params: {
    page: number;
    limit: number;
    status?: string;
    rating?: number;
    productId?: string;
    search?: string;
  }) {
    const { page, limit, status, rating, productId, search } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (status && status !== 'all') {
      where['status'] = status as ProductCommentStatus;
    }

    if (rating) {
      where['rating'] = rating;
    }

    if (productId) {
      where['productId'] = productId;
    }

    if (search && search.trim()) {
      where['content'] = Like(`%${search.trim()}%`);
    }

    const [reviews, total] = await this.commentsRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const userIds = [...new Set(reviews.map((r) => r.userId))];
    const productIds = [...new Set(reviews.map((r) => r.productId))];

    const [users, products] = await Promise.all([
      userIds.length > 0
        ? this.usersRepository
            .createQueryBuilder('u')
            .select(['u.userId', 'u.username'])
            .whereInIds(userIds)
            .getMany()
        : Promise.resolve([]),
      productIds.length > 0
        ? this.productsRepository
            .createQueryBuilder('p')
            .select(['p.productId', 'p.productName'])
            .whereInIds(productIds)
            .getMany()
        : Promise.resolve([]),
    ]);

    const userMap = new Map(users.map((u) => [u.userId, u]));
    const productMap = new Map(products.map((p) => [p.productId, p]));

    const items = reviews.map((r) => {
      const user = userMap.get(r.userId);
      const product = productMap.get(r.productId);
      return {
        commentId: r.commentId,
        content: r.content,
        rating: r.rating,
        status: r.status,
        likeCount: r.likeCount,
        dislikeCount: r.dislikeCount,
        createdAt: r.createdAt,
        user: {
          username: user?.username ?? null,
        },
        product: {
          productName: product?.productName ?? null,
        },
      };
    });

    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      items,
    };
  }

  async hideReview(id: string) {
    const review = await this.commentsRepository.findOneBy({ commentId: id });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    review.status = ProductCommentStatus.HIDDEN;
    await this.commentsRepository.save(review);
    await this.refreshProductRating(review.productId);
    return { commentId: review.commentId, status: review.status };
  }

  async showReview(id: string) {
    const review = await this.commentsRepository.findOneBy({ commentId: id });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    review.status = ProductCommentStatus.VISIBLE;
    await this.commentsRepository.save(review);
    await this.refreshProductRating(review.productId);
    return { commentId: review.commentId, status: review.status };
  }

  async deleteReview(id: string) {
    const review = await this.commentsRepository.findOneBy({ commentId: id });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    review.status = ProductCommentStatus.DELETED;
    await this.commentsRepository.save(review);
    await this.refreshProductRating(review.productId);
    return { commentId: review.commentId, status: review.status };
  }

  async getAdminStats() {
    const [totalVisible, totalHidden, totalDeleted, allVisible] =
      await Promise.all([
        this.commentsRepository.count({
          where: { status: ProductCommentStatus.VISIBLE },
        }),
        this.commentsRepository.count({
          where: { status: ProductCommentStatus.HIDDEN },
        }),
        this.commentsRepository.count({
          where: { status: ProductCommentStatus.DELETED },
        }),
        this.commentsRepository.find({
          where: { status: ProductCommentStatus.VISIBLE },
          select: ['rating'],
        }),
      ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const reviewsToday = await this.commentsRepository
      .createQueryBuilder('c')
      .where('c.created_at >= :today', { today })
      .andWhere('c.created_at < :tomorrow', { tomorrow })
      .getCount();

    const ratings = allVisible
      .map((r) => r.rating)
      .filter((r): r is number => typeof r === 'number');
    const averageRating =
      ratings.length === 0
        ? 0
        : ratings.reduce((sum, r) => sum + r, 0) / ratings.length;

    return {
      total: totalVisible + totalHidden + totalDeleted,
      totalVisible,
      totalHidden,
      totalDeleted,
      averageRating: Number(averageRating.toFixed(2)),
      reviewsToday,
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
