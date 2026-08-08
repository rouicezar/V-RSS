import { Module } from '@nestjs/common';
import { TrpcService } from '@server/trpc/trpc.service';
import { TrpcRouter } from '@server/trpc/trpc.router';
import { PrismaModule } from '@server/prisma/prisma.module';
import { MpModule } from '@server/mp/mp.module';
import { WereadModule } from '@server/weread/weread.module';
import { ArticleModule } from '@server/article/article.module';
import { AnalysisModule } from '@server/analysis/analysis.module';
import { CryptoModule } from '@server/crypto/crypto.module';

@Module({
  imports: [
    PrismaModule,
    MpModule,
    WereadModule,
    ArticleModule,
    AnalysisModule,
    CryptoModule,
  ],
  controllers: [],
  providers: [TrpcService, TrpcRouter],
  exports: [TrpcService, TrpcRouter],
})
export class TrpcModule {}
