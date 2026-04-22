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
import { Public, RequirePermissions, ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateNewsDto } from './dto/create-news.dto';
import { QueryNewsDto } from './dto/query-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { NewsService } from './news.service';

type UploadedImageFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get('public/list')
  @Public()
  @ResponseMessage('Get published news list')
  getPublishedNews(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.newsService.findPublishedList({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @Get('public/by-slug/:slug')
  @Public()
  @ResponseMessage('Get news by slug')
  getNewsBySlug(@Param('slug') slug: string) {
    return this.newsService.findBySlug(slug);
  }

  @Get()
  @RequirePermissions('manage_news')
  @ResponseMessage('Get news list')
  getNews(@Query() query: QueryNewsDto) {
    return this.newsService.findAll(query);
  }

  @Post()
  @RequirePermissions('manage_news')
  @ResponseMessage('Create news article')
  createNews(@User() currentUser: IUser, @Body() createNewsDto: CreateNewsDto) {
    return this.newsService.create(currentUser._id, createNewsDto);
  }

  @Patch(':id/publish')
  @RequirePermissions('manage_news')
  @ResponseMessage('Publish news article')
  publishNews(@Param('id') id: string) {
    return this.newsService.publish(id);
  }

  @Patch(':id/unpublish')
  @RequirePermissions('manage_news')
  @ResponseMessage('Unpublish news article')
  unpublishNews(@Param('id') id: string) {
    return this.newsService.unpublish(id);
  }

  @Get(':id')
  @RequirePermissions('manage_news')
  @ResponseMessage('Get news detail')
  getNewsDetail(@Param('id') id: string) {
    return this.newsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('manage_news')
  @ResponseMessage('Update news article')
  updateNews(@Param('id') id: string, @Body() updateNewsDto: UpdateNewsDto) {
    return this.newsService.update(id, updateNewsDto);
  }

  @Post(':id/cover-image')
  @RequirePermissions('manage_news')
  @ResponseMessage('Upload news cover image')
  @UseInterceptors(FileInterceptor('file'))
  uploadCoverImage(@Param('id') id: string, @UploadedFile() file: UploadedImageFile) {
    return this.newsService.uploadCoverImage(id, file);
  }

  @Patch('public/:id/view')
  @Public()
  @ResponseMessage('Increment view count')
  incrementView(@Param('id') id: string) {
    return this.newsService.incrementView(id);
  }

  @Post('public/:id/like')
  @Public()
  @ResponseMessage('Like article')
  likeArticle(@Param('id') id: string) {
    return this.newsService.likeArticle(id);
  }

  @Delete('public/:id/like')
  @Public()
  @ResponseMessage('Unlike article')
  unlikeArticle(@Param('id') id: string) {
    return this.newsService.unlikeArticle(id);
  }

  @Get('public/:id/comments')
  @Public()
  @ResponseMessage('Get news comments')
  getComments(@Param('id') id: string) {
    return this.newsService.getNewsComments(id);
  }

  @Post('public/:id/comments')
  @ResponseMessage('Add news comment')
  addComment(
    @User() currentUser: IUser,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.newsService.addNewsComment(id, currentUser._id, body.content);
  }

  @Public()
  @Post('public/comments/:commentId/like')
  @ResponseMessage('Like news comment')
  likeComment(@Param('commentId') commentId: string) {
    return this.newsService.likeNewsComment(commentId);
  }

  @Public()
  @Delete('public/comments/:commentId/like')
  @ResponseMessage('Unlike news comment')
  unlikeComment(@Param('commentId') commentId: string) {
    return this.newsService.unlikeNewsComment(commentId);
  }

  @Public()
  @Post('public/comments/:commentId/dislike')
  @ResponseMessage('Dislike news comment')
  dislikeComment(@Param('commentId') commentId: string) {
    return this.newsService.dislikeNewsComment(commentId);
  }

  @Public()
  @Delete('public/comments/:commentId/dislike')
  @ResponseMessage('Undislike news comment')
  undislikeComment(@Param('commentId') commentId: string) {
    return this.newsService.undislikeNewsComment(commentId);
  }

  @Delete(':id')
  @RequirePermissions('manage_news')
  @ResponseMessage('Delete news article')
  deleteNews(@Param('id') id: string) {
    return this.newsService.remove(id);
  }
}
