import {
  Controller,
  BadRequestException,
  DefaultValuePipe,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Query,
  Response,
} from '@nestjs/common';
import { FeedsService } from './feeds.service';
import { Response as Res } from 'express';

const FEED_TYPES = new Set(['json', 'rss', 'atom']);

@Controller('feeds')
export class FeedsController {
  private readonly logger = new Logger(this.constructor.name);

  constructor(private readonly feedsService: FeedsService) {}

  @Get('/')
  async getFeedList() {
    return this.feedsService.getFeedList();
  }

  @Get('/all.:type')
  async getFeeds(
    @Response() res: Res,
    @Param('type') type: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number = 30,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('mode') mode: string,
    @Query('title_include') title_include: string,
    @Query('title_exclude') title_exclude: string,
  ) {
    if (!FEED_TYPES.has(type)) {
      throw new BadRequestException('仅支持 json、rss 或 atom 格式');
    }

    const { content, mimeType } = await this.feedsService.handleGenerateFeed({
      type,
      limit,
      page,
      mode,
      title_include,
      title_exclude,
    });

    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Get('/:feed')
  async getFeed(
    @Response() res: Res,
    @Param('feed') feed: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number = 10,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('mode') mode: string,
    @Query('title_include') title_include: string,
    @Query('title_exclude') title_exclude: string,
    @Query('update') update: boolean = false,
  ) {
    const [id, type] = feed.split('.');
    if (!id || !type || !FEED_TYPES.has(type)) {
      throw new BadRequestException('订阅地址格式无效');
    }
    this.logger.log('getFeed: ', id);

    if (update) {
      this.feedsService.updateFeed(id);
    }

    const { content, mimeType } = await this.feedsService.handleGenerateFeed({
      id,
      type,
      limit,
      page,
      mode,
      title_include,
      title_exclude,
    });

    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }
}
