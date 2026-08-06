import { Module } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { PrismaModule } from '@server/prisma/prisma.module';
import { TrpcModule } from '@server/trpc/trpc.module';
import { ArticleModule } from '@server/article/article.module';

@Module({
  imports: [PrismaModule, TrpcModule, ArticleModule],
  controllers: [FeedsController],
  providers: [FeedsService],
})
export class FeedsModule {}
