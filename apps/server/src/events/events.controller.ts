import {
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { ConfigurationType } from '@server/configuration';
import { EventsService, ServerEvent } from './events.service';

const HEARTBEAT_MS = 30_000;

/**
 * SSE 实时进度端点：GET /events?token=<AUTH_CODE>
 * 浏览器 EventSource 无法携带自定义 header，故用 query 参数鉴权（本地自托管场景可接受）。
 */
@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly eventsService: EventsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  stream(
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const authCode =
      this.configService.get<ConfigurationType['auth']>('auth')!.code;
    if (authCode && token !== authCode) {
      res.status(401).end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`: connected\n\n`);

    const send = (event: ServerEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = this.eventsService.subscribe(send);

    // 心跳：防止代理/浏览器判定空闲断连
    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
    }, HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
