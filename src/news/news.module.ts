import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NewsCommentEntity } from './entities/news-comment.entity';
import { NewsImageEntity } from './entities/news-image.entity';
import { NewsEntity } from './entities/news.entity';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([NewsEntity, NewsCommentEntity, NewsImageEntity]),
  ],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService, TypeOrmModule],
})
export class NewsModule {}
