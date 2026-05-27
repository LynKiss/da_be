import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  uploadImageToCloudinary,
  type UploadedImageFile,
} from '../common/cloudinary.util';
import {
  Public,
  RequirePermissions,
  ResponseMessage,
  User,
} from '../decorator/customize';
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

  @Public()
  @Post(':id/like')
  @ResponseMessage('Like review')
  likeReview(@Param('id') id: string) {
    return this.commentsService.likeComment(id);
  }

  @Public()
  @Delete(':id/like')
  @ResponseMessage('Unlike review')
  unlikeReview(@Param('id') id: string) {
    return this.commentsService.unlikeComment(id);
  }

  @Public()
  @Post(':id/dislike')
  @ResponseMessage('Dislike review')
  dislikeReview(@Param('id') id: string) {
    return this.commentsService.dislikeComment(id);
  }

  @Public()
  @Delete(':id/dislike')
  @ResponseMessage('Undislike review')
  undislikeReview(@Param('id') id: string) {
    return this.commentsService.undislikeComment(id);
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

  /**
   * Upload 1 áº£nh review lÃªn Cloudinary, tráº£ vá» URL.
   * Client gá»i nhiá»u láº§n (max 5) trÆ°á»›c khi submit review.
   */
  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file'))
  @ResponseMessage('Review image uploaded')
  async uploadReviewImage(
    @User() currentUser: IUser,
    @UploadedFile() file: UploadedImageFile | undefined,
  ) {
    const url = await uploadImageToCloudinary(file, {
      folder: 'agri_ecommerce/reviews',
      publicIdPrefix: `review-${currentUser._id}`,
      maxBytes: 5 * 1024 * 1024,
    });
    return { url };
  }

  @Get('me')
  @ResponseMessage('Get my product reviews')
  getMyReviews(
    @User() currentUser: IUser,
    @Query('page') page = '1',
    @Query('limit') limit = '12',
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.commentsService.findMyReviews(currentUser._id, {
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 12)),
      status,
      search,
    });
  }
  // â”€â”€â”€ Admin endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @RequirePermissions('manage_reviews')
  @Get('admin/stats')
  @ResponseMessage('Get review stats')
  getAdminStats() {
    return this.commentsService.getAdminStats();
  }

  @RequirePermissions('manage_reviews')
  @Get('admin')
  @ResponseMessage('List all reviews')
  listAdminReviews(
    @Query('page') page = '1',
    @Query('limit') limit = '12',
    @Query('status') status?: string,
    @Query('rating') rating?: string,
    @Query('productId') productId?: string,
    @Query('search') search?: string,
    @Query('hasImages') hasImages?: string,
  ) {
    return this.commentsService.findAdminReviews({
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 12)),
      status,
      rating: rating ? parseInt(rating, 10) : undefined,
      productId,
      search,
      hasImages: hasImages === 'true' ? true : undefined,
    });
  }

  @RequirePermissions('manage_reviews')
  @Patch('admin/:id/hide')
  @ResponseMessage('Review hidden')
  hideReview(@Param('id') id: string) {
    return this.commentsService.hideReview(id);
  }

  @RequirePermissions('manage_reviews')
  @Patch('admin/:id/show')
  @ResponseMessage('Review shown')
  showReview(@Param('id') id: string) {
    return this.commentsService.showReview(id);
  }

  @RequirePermissions('manage_reviews')
  @Delete('admin/:id')
  @ResponseMessage('Review deleted')
  deleteReview(@Param('id') id: string) {
    return this.commentsService.deleteReview(id);
  }

  @Delete(':id')
  @ResponseMessage('Delete own review')
  deleteOwnReview(@User() currentUser: IUser, @Param('id') id: string) {
    return this.commentsService.deleteOwnReview(currentUser._id, id);
  }
}

