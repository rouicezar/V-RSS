import { Module } from '@nestjs/common';
import { PrismaModule } from '@server/prisma/prisma.module';
import { CryptoModule } from '@server/crypto/crypto.module';
import { WereadService } from './weread.service';

@Module({
  imports: [PrismaModule, CryptoModule],
  providers: [WereadService],
  exports: [WereadService],
})
export class WereadModule {}
