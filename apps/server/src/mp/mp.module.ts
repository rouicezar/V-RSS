import { Module } from '@nestjs/common';
import { PrismaModule } from '@server/prisma/prisma.module';
import { CryptoModule } from '@server/crypto/crypto.module';
import { MpService } from './mp.service';

@Module({
  imports: [PrismaModule, CryptoModule],
  providers: [MpService],
  exports: [MpService],
})
export class MpModule {}
