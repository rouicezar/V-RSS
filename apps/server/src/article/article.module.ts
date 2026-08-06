import { Module } from '@nestjs/common';
import { PrismaModule } from '@server/prisma/prisma.module';
import { ArticleService } from './article.service';

@Module({
  imports: [PrismaModule],
  providers: [ArticleService],
  exports: [ArticleService],
})
export class ArticleModule {}
