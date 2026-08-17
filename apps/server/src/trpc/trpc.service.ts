import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';
import { PrismaService } from '@server/prisma/prisma.service';
import { MpService } from '@server/mp/mp.service';
import { PipelineId } from '@server/mp/rate-limiter.service';
import { WereadService } from '@server/weread/weread.service';
import { ArticleService } from '@server/article/article.service';
import { AnalysisService } from '@server/analysis/analysis.service';
import { TRPCError, initTRPC } from '@trpc/server';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { EventsService } from '@server/events/events.service';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class TrpcService {
  trpc = initTRPC.create();
  publicProcedure = this.trpc.procedure;
  protectedProcedure = this.trpc.procedure.use(({ ctx, next }) => {
    const { errorMsg, rateLimited } = ctx as any;
    if (errorMsg) {
      throw new TRPCError({
        code: rateLimited ? 'TOO_MANY_REQUESTS' : 'UNAUTHORIZED',
        message: errorMsg,
      });
    }
    return next({ ctx });
  });
  router = this.trpc.router;
  mergeRouters = this.trpc.mergeRouters;
  updateDelayTime = 60;

  private readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly mpService: MpService,
    private readonly wereadService: WereadService,
    private readonly articleService: ArticleService,
    private readonly analysisService: AnalysisService,
    private readonly eventsService: EventsService,
  ) {
    this.updateDelayTime =
      this.configService.get<ConfigurationType['feed']>(
        'feed',
      )!.updateDelayTime;
  }

  removeBlockedAccount = (vid: string) => {
    this.wereadService.removeBlockedAccount(vid);
  };

  private getTodayDate() {
    return dayjs.tz(new Date(), 'Asia/Shanghai').format('YYYY-MM-DD');
  }

  getBlockedAccountIds() {
    return this.wereadService.getBlockedAccountIds();
  }

  getActivePipeline(): PipelineId {
    return this.mpService.getActivePipeline();
  }

  async getPipelineInfo() {
    const activePipeline = this.getActivePipeline();
    const wereadStatus = await this.wereadService.getStatus();
    const ownStatus = this.mpService.getRateLimitInfo();
    const ownAccountCount = await this.prismaService.account.count({
      where: { status: 1, pipeline: 2 },
    });
    return {
      activePipeline,
      pipelines: [
        {
          id: 1 as const,
          name: '方案1',
          description: '.xyz 管线',
          configured: Boolean(
            this.configService.get<ConfigurationType['platform']>('platform')
              ?.url,
          ),
          limited: wereadStatus.limited,
          ready: wereadStatus.ready,
          availableAccounts: wereadStatus.availableCount,
        },
        {
          id: 2 as const,
          name: '方案2',
          description: '自有管线',
          configured: true,
          limited: ownStatus.limited,
          ready: ownAccountCount > 0 && !ownStatus.limited,
          availableAccounts: ownAccountCount,
        },
      ],
    };
  }

  async switchPipeline(pipeline: PipelineId) {
    if (
      this.isRefreshAllMpArticlesRunning ||
      Boolean(this.inProgressHistoryMp.id)
    ) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: '采集任务正在运行，请等待任务结束后再切换方案',
      });
    }
    if (pipeline === 1) {
      const url =
        this.configService.get<ConfigurationType['platform']>('platform')?.url;
      if (!url) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '方案1未配置 PLATFORM_URL',
        });
      }
    }
    await this.mpService.setActivePipeline(pipeline);
    return this.getPipelineInfo();
  }

  // ===== 委托给 ArticleService =====
  cleanArticleHtml = this.articleService.cleanArticleHtml.bind(
    this.articleService,
  );
  localizeArticleImages = this.articleService.localizeArticleImages.bind(
    this.articleService,
  );
  fetchArticleContent = this.articleService.fetchArticleContent.bind(
    this.articleService,
  );
  localizeArticle = this.articleService.localizeArticle.bind(
    this.articleService,
  );
  backfillMissingContent = this.articleService.backfillMissingContent.bind(
    this.articleService,
  );
  htmlToText = this.articleService.htmlToText.bind(this.articleService);

  // ===== 委托给 AnalysisService =====
  extractTagsWithAI = this.analysisService.extractTagsWithAI.bind(
    this.analysisService,
  );
  tagArticleWithAI = this.analysisService.tagArticleWithAI.bind(
    this.analysisService,
  );
  tagAllArticlesWithAI = this.analysisService.tagAllArticlesWithAI.bind(
    this.analysisService,
  );
  askDeepSeek = this.analysisService.askDeepSeek.bind(this.analysisService);
  computeRadar = this.analysisService.computeRadar.bind(this.analysisService);
  generateRadarReport = this.analysisService.generateRadarReport.bind(
    this.analysisService,
  );
  generateLearningPlan = this.analysisService.generateLearningPlan.bind(
    this.analysisService,
  );
  distillKnowledge = this.analysisService.distillKnowledge.bind(
    this.analysisService,
  );
  listKnowledgeBase = this.analysisService.listKnowledgeBase.bind(
    this.analysisService,
  );
  collectHotTopics = this.analysisService.collectHotTopics.bind(
    this.analysisService,
  );
  analyzeHotTopic = this.analysisService.analyzeHotTopic.bind(
    this.analysisService,
  );

  /**
   * 获取公众号文章（公众号后台采集）
   * @param mpId 订阅源 id（Feed 表主键）
   * @param page 页码（1 起始）
   */
  async getMpArticles(mpId: string, page = 1) {
    if (this.getActivePipeline() === 1) {
      return this.wereadService.getMpArticles(mpId, page);
    }
    const feed = await this.prismaService.feed.findUnique({
      where: { id: mpId },
    });
    if (!feed?.fakerId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '该订阅源缺少方案2所需的 fakeid，请用方案2重新添加订阅',
      });
    }
    return this.mpService.getMpArticles(feed.fakerId, page - 1);
  }

  async refreshMpArticlesAndUpdateFeed(mpId: string, page = 1) {
    let articles: any[] = [];
    const pipeline = this.getActivePipeline();
    const feed = await this.prismaService.feed.findUnique({
      where: { id: mpId },
    });
    if (!feed) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '订阅源不存在' });
    }
    try {
      if (pipeline === 1) {
        articles = await this.wereadService.getMpArticles(mpId, page);
      } else {
        if (!feed.fakerId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '该订阅源缺少方案2所需的 fakeid，请用方案2重新添加订阅',
          });
        }
        const before = this.mpService.getRateLimitInfo();
        if (before.limited) {
          return {
            hasHistory: feed.hasHistory ?? 1,
            rateLimited: true,
            pipeline,
          };
        }
        if (before.throttledSec > 0) {
          return {
            hasHistory: feed.hasHistory ?? 1,
            throttled: true,
            pipeline,
          };
        }
        articles = await this.mpService.getMpArticles(feed.fakerId, page - 1);
        if (this.mpService.isRateLimited()) {
          return {
            hasHistory: feed.hasHistory ?? 1,
            rateLimited: true,
            pipeline,
          };
        }
      }
    } catch (e: any) {
      this.logger.error(
        `refreshMpArticlesAndUpdateFeed(${mpId}) error: ${e.message}`,
      );
      throw e;
    }

    if (articles.length > 0) {
      let results;
      const { type } =
        this.configService.get<ConfigurationType['database']>('database')!;
      if (type === 'sqlite') {
        // sqlite3 不支持 createMany
        const inserts = articles.map(
          ({ id, picUrl, publishTime, title, url, digest }) =>
            this.prismaService.article.upsert({
              create: {
                id,
                mpId,
                picUrl,
                publishTime,
                title,
                url,
                digest,
              },
              update: {
                publishTime,
                title,
                // 接口返回的 url 优先（链接可能变更）
                url: url || undefined,
                digest: digest || undefined,
              },
              where: { id },
            }),
        );
        results = await this.prismaService.$transaction(inserts);
      } else {
        results = await (this.prismaService.article as any).createMany({
          data: articles.map(
            ({ id, picUrl, publishTime, title, url, digest }) => ({
              id,
              mpId,
              picUrl,
              publishTime,
              title,
              url,
              digest,
            }),
          ),
          skipDuplicates: true,
        });
      }

      this.logger.debug(
        `refreshMpArticlesAndUpdateFeed saved ${results.length} articles`,
      );
      // 实时推送：逐篇广播已入库文章，前端就地插入列表（无需等待任务结束）
      for (const article of results) {
        this.eventsService.emit({
          type: 'article:upserted',
          data: article as Record<string, unknown>,
        });
      }
    }

    const pageSize = pipeline === 1 ? 20 : 5;
    const hasHistory = articles.length < pageSize ? 0 : 1;

    await this.prismaService.feed.update({
      where: { id: mpId },
      data: {
        syncTime: Math.floor(Date.now() / 1e3),
        hasHistory,
      },
    });
    return { hasHistory, rateLimited: false, pipeline };
  }

  /**
   * 同步全部订阅的公众号信息（名称/头像）
   * 通过公网抓取文章页反查，不消耗公众号后台频率额度
   */
  async syncAllMpAvatars() {
    const feeds = await this.prismaService.feed.findMany({
      where: { status: 1 },
    });
    let updated = 0;
    let failed = 0;
    for (const feed of feeds) {
      let info: any = null;
      // 1. 优先：取该订阅最新一篇文章，公网抓文章页反查公众号信息（不消耗 weread 配额）
      const article = await this.prismaService.article.findFirst({
        where: { mpId: feed.id, url: { not: null }, status: 1 },
        orderBy: { publishTime: 'desc' },
      });
      if (article?.url) {
        try {
          const arr = await this.mpService.getMpInfo(article.url);
          info = arr[0] || null;
        } catch (e: any) {
          this.logger.warn(
            `syncMpAvatar 文章反查失败(${feed.mpName}): ${e.message}`,
          );
        }
      }
      // 2. 兜底：无文章或反查无头像时，按公众号名搜索拿头像（weread 主方案无搜索，走 weread 反查接口）
      if (!info?.cover && feed.mpName) {
        try {
          const arr = await this.wereadService.getMpInfo(
            `https://weixin.sogou.com/weixin?type=1&query=${encodeURIComponent(feed.mpName)}`,
          );
          const hit = arr?.[0];
          if (hit) {
            info = {
              name: hit.name || feed.mpName,
              cover: hit.cover || '',
            };
          }
        } catch (e: any) {
          this.logger.warn(
            `syncMpAvatar 搜索兜底失败(${feed.mpName}): ${e.message}`,
          );
        }
      }
      if (info?.cover || info?.name) {
        await this.prismaService.feed.update({
          where: { id: feed.id },
          data: {
            mpCover: info.cover || feed.mpCover,
            mpName: info.name || feed.mpName,
          },
        });
        updated += 1;
      } else {
        failed += 1;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    const rateLimited = this.mpService.isRateLimited();
    return { total: feeds.length, updated, failed, rateLimited };
  }

  /**
   * 清理孤儿文章：mp_id 不存在于订阅表中的文章（历史引擎遗留数据）
   * 级联删除其标签关联，返回清理数量
   */
  async cleanupOrphanArticles() {
    const feedIds = await this.prismaService.feed.findMany({
      select: { id: true },
    });
    const ids = new Set(feedIds.map((f) => f.id));
    const orphans = await this.prismaService.article.findMany({
      select: { id: true },
      where: { NOT: { mpId: { in: Array.from(ids) } } },
    });
    if (orphans.length > 0) {
      // 删除文章（ArticleTag onDelete: Cascade 会级联清理关联）
      await this.prismaService.article.deleteMany({
        where: { id: { in: orphans.map((o) => o.id) } },
      });
    }
    return { deleted: orphans.length };
  }

  /** 采集同步状态（供 dashboard 展示） */
  async getSyncStatus() {
    const pipelineInfo = await this.getPipelineInfo();
    const activePipeline = pipelineInfo.activePipeline;
    const rl = this.mpService.getRateLimitInfo() || {
      limited: false,
      retryAfterSec: 0,
      dailyCount: 0,
      dailyLimit: 100,
      minIntervalSec: 0,
    };
    const todayTrips = this.mpService.getTodayTripCount() || 0;
    // 上次“更新全部”时间戳来自限流器的持久化状态（不要用本类空字段）
    const lastSyncAllAt = this.mpService.getLastSyncAll() || 0;
    const sinceLastMin =
      lastSyncAllAt > 0 ? Math.floor((Date.now() - lastSyncAllAt) / 6e4) : null;

    // 风险分级（与真实风控数据对齐，不承诺虚假"正常"）：
    //  danger  → 熔断中 / 今日已多次触发（>=2）→ 按钮禁用，建议明天再试
    //  warn    → 今日触发过 1 次 / 距上次操作 <10 分钟 / 今日请求偏高 → 谨慎，建议等待
    //  ok      → 今日零触发 + 距上次足够久 + 请求量低
    let level: 'ok' | 'warn' | 'danger' = 'ok';
    let levelText = '正常';
    if (rl.limited || todayTrips >= 2) {
      level = 'danger';
      levelText =
        todayTrips >= 2
          ? `今日已触发限流 ${todayTrips} 次，接口受限，建议明天再试`
          : `限流中 · 约 ${Math.ceil((rl.retryAfterSec || 0) / 60)} 分钟后可试`;
    } else if (
      todayTrips >= 1 ||
      (sinceLastMin !== null && sinceLastMin < 10)
    ) {
      level = 'warn';
      levelText = '谨慎操作 · 建议间隔 10 分钟以上';
    }

    if (activePipeline === 1) {
      const selected = pipelineInfo.pipelines[0];
      const noAccount = selected.availableAccounts === 0;
      return {
        activePipeline,
        pipelineName: '方案1',
        rateLimitRemainHours: 0,
        lastSyncAllAt,
        sinceLastMin,
        rateLimited: selected.limited,
        retryAfterSec: 0,
        dailyCount: 0,
        dailyLimit: 0,
        minIntervalSec: 0,
        throttledSec: 0,
        todayTrips: 0,
        level:
          selected.limited || noAccount ? ('danger' as const) : ('ok' as const),
        levelText: noAccount
          ? '方案1暂无可用账号，请重新扫码登录'
          : selected.limited
            ? '方案1账号当前均不可用'
            : '方案1可用',
        suggestedNextSyncAt: 0,
      };
    }

    return {
      activePipeline,
      pipelineName: '方案2',
      rateLimitRemainHours:
        this.mpService.getRateLimitInfo().rateLimitRemainHours || 0,
      lastSyncAllAt,
      sinceLastMin,
      rateLimited: rl.limited,
      retryAfterSec: rl.retryAfterSec,
      dailyCount: rl.dailyCount || 0,
      dailyLimit: rl.dailyLimit || 100,
      minIntervalSec: rl.minIntervalSec || 0,
      throttledSec: rl.throttledSec || 0,
      todayTrips,
      level,
      levelText,
      // 建议下次同步：上次更新 + 10 分钟（下限），今日触发过则 +30 分钟
      suggestedNextSyncAt:
        lastSyncAllAt > 0
          ? lastSyncAllAt + (todayTrips > 0 ? 30 : 10) * 60 * 1e3
          : 0,
    };
  }

  inProgressHistoryMp = {
    id: '',
    page: 1,
  };

  async getHistoryMpArticles(mpId: string) {
    if (this.inProgressHistoryMp.id === mpId) {
      this.logger.log(`getHistoryMpArticles(${mpId}) is running`);
      return;
    }

    this.inProgressHistoryMp = {
      id: mpId,
      page: 1,
    };

    if (!this.inProgressHistoryMp.id) {
      return;
    }

    this.eventsService.emit({
      type: 'job:started',
      data: { job: 'history', mpId, total: 0 },
    });

    try {
      const feed = await this.prismaService.feed.findFirstOrThrow({
        where: {
          id: mpId,
        },
      });

      // 手动拉历史：始终允许（从第 1 页重扫，upsert 去重，幂等）
      // hasHistory 仅表示"上次扫描是否拉完"，不拦截用户主动重扫
      // 从第 1 页（API begin=0）开始，每页 5 篇（API 固定），翻到无数据为止
      this.inProgressHistoryMp.page = 1;

      // 最多尝试一千次
      let i = 1e3;
      while (i-- > 0) {
        if (this.inProgressHistoryMp.id !== mpId) {
          this.logger.log(
            `getHistoryMpArticles(${mpId}) is not running, break`,
          );
          break;
        }
        const result = await this.refreshMpArticlesAndUpdateFeed(
          mpId,
          this.inProgressHistoryMp.page,
        );
        this.eventsService.emit({
          type: 'job:progress',
          data: {
            job: 'history',
            mpId,
            current: this.inProgressHistoryMp.page,
            total: 0,
            detail: feed.mpName,
          },
        });
        if (result.hasHistory < 1) {
          this.logger.log(
            `getHistoryMpArticles(${mpId}) has no history, break`,
          );
          break;
        }
        this.inProgressHistoryMp.page++;

        await new Promise((resolve) =>
          setTimeout(resolve, this.updateDelayTime * 1e3),
        );
      }
    } finally {
      this.inProgressHistoryMp = {
        id: '',
        page: 1,
      };
      this.eventsService.emit({
        type: 'job:finished',
        data: { job: 'history', mpId },
      });
    }
  }

  isRefreshAllMpArticlesRunning = false;

  async refreshAllMpArticlesAndUpdateFeed() {
    if (this.isRefreshAllMpArticlesRunning) {
      this.logger.log('refreshAllMpArticlesAndUpdateFeed is running');
      return;
    }
    const mps = await this.prismaService.feed.findMany();
    this.isRefreshAllMpArticlesRunning = true;
    await (this.mpService as any).setLastSyncAll?.(Date.now());
    this.eventsService.emit({
      type: 'job:started',
      data: { job: 'refreshAll', total: mps.length },
    });
    let current = 0;
    try {
      for (const { id, mpName } of mps) {
        await this.refreshMpArticlesAndUpdateFeed(id);
        current += 1;
        this.eventsService.emit({
          type: 'job:progress',
          data: {
            job: 'refreshAll',
            current,
            total: mps.length,
            detail: mpName,
          },
        });

        await new Promise((resolve) =>
          setTimeout(resolve, this.updateDelayTime * 1e3),
        );
      }
    } finally {
      this.isRefreshAllMpArticlesRunning = false;
      this.eventsService.emit({
        type: 'job:finished',
        data: { job: 'refreshAll', result: { total: mps.length } },
      });
    }
  }

  async getMpInfo(url: string) {
    url = url.trim();
    return this.getActivePipeline() === 1
      ? this.wereadService.getMpInfo(url)
      : this.mpService.getMpInfo(url);
  }

  async createLoginUrl() {
    return this.getActivePipeline() === 1
      ? this.wereadService.createLoginUrl()
      : this.mpService.createLoginUrl();
  }

  async getLoginResult(id: string) {
    return this.getActivePipeline() === 1
      ? this.wereadService.getLoginResult(id)
      : this.mpService.getLoginResult(id);
  }

  /** 搜索公众号（公众号后台，仅作备选；weread 主方案用链接反查） */
  async searchBiz(keyword: string) {
    if (this.getActivePipeline() !== 2) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '方案1请粘贴公众号文章链接添加订阅；搜索功能属于方案2',
      });
    }
    return this.mpService.searchBiz(keyword);
  }
}
