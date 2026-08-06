import { Module } from '@nestjs/common';
import { TrpcService } from '@server/trpc/trpc.service';
import { TrpcRouter } from '@server/trpc/trpc.router';
import { PrismaModule } from '@server/prisma/prisma.module';
import { MpModule } from '@server/mp/mp.module';
import { ArticleModule } from '@server/article/article.module';
import { AnalysisModule } from '@server/analysis/analysis.module';

@Module({
  imports: [PrismaModule, MpModule, ArticleModule, AnalysisModule],
  controllers: [],
  providers: [TrpcService, TrpcRouter],
  exports: [TrpcService, TrpcRouter],
})
export class TrpcModule {}
