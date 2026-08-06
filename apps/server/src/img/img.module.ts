import { Module } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { PrismaModule } from '@server/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AvatarController],
})
export class ImgModule {}
