import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

/**
 * 实时进度事件模块：@Global() 使 EventsService 可注入任意 Service，
 * EventsController 提供 GET /events SSE 端点。
 */
@Global()
@Module({
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
