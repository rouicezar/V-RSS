import { Module } from '@nestjs/common';
import { PrismaModule } from '@server/prisma/prisma.module';
import { AnalysisService } from './analysis.service';

@Module({
  imports: [PrismaModule],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
