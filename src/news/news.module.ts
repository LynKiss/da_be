import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NewsCommentEntity } from './entities/news-comment.entity';
import { NewsImageEntity } from './entities/news-image.entity';
import { NewsTagOfNewsEntity } from './entities/news-tag-of-news.entity';
import { NewsTagEntity } from './entities/news-tag.entity';
import { NewsEntity } from './entities/news.entity';
import { UserEntity } from '../users/entities/user.entity';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NewsEntity,
      NewsCommentEntity,
      NewsImageEntity,
      NewsTagEntity,
      NewsTagOfNewsEntity,
      UserEntity,
    ]),
  ],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService, TypeOrmModule],
})
export class NewsModule {}
