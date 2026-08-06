import { Module } from '@nestjs/common';
import { PrismaModule } from '@server/prisma/prisma.module';
import { MpService } from './mp.service';

@Module({
  imports: [PrismaModule],
  providers: [MpService],
  exports: [MpService],
})
export class MpModule {}
