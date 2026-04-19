import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public, ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateReviewDto } from './dto/create-review.dto';
import { CommentsService } from './comments.service';

@Controller('reviews')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Public()
  @Get('products/:productId')
  @ResponseMessage('Get product reviews')
  getProductReviews(@Param('productId') productId: string) {
    return this.commentsService.findProductReviews(productId);
  }

  @Post('products/:productId')
  @ResponseMessage('Create product review')
  createReview(
    @User() currentUser: IUser,
    @Param('productId') productId: string,
    @Body() createReviewDto: CreateReviewDto,
  ) {
    return this.commentsService.createReview(
      currentUser._id,
      productId,
      createReviewDto,
    );
  }
}
