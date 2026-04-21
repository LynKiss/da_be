import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions, ResponseMessage, User } from '../decorator/customize';
import type { IUser } from '../users/users.interface';
import { CreateNewsDto } from './dto/create-news.dto';
import { QueryNewsDto } from './dto/query-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { NewsService } from './news.service';

@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

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

  @Delete(':id')
  @RequirePermissions('manage_news')
  @ResponseMessage('Delete news article')
  deleteNews(@Param('id') id: string) {
    return this.newsService.remove(id);
  }
}
