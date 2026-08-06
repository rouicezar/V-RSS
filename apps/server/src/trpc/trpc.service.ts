import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';
import { PrismaService } from '@server/prisma/prisma.service';
import { MpService } from '@server/mp/mp.service';
import { ArticleService } from '@server/article/article.service';
import { AnalysisService } from '@server/analysis/analysis.service';
import { TRPCError, initTRPC } from '@trpc/server';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * 读书账号每日小黑屋
 */
const blockedAccountsMap = new Map<string, string[]>();

@Injectable()
export class TrpcService {
  trpc = initTRPC.create();
  publicProcedure = this.trpc.procedure;
  protectedProcedure = this.trpc.procedure.use(({ ctx, next }) => {
    const errorMsg = (ctx as any).errorMsg;
    if (errorMsg) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: errorMsg });
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
    private readonly articleService: ArticleService,
    private readonly analysisService: AnalysisService,
  ) {
    this.updateDelayTime =
      this.configService.get<ConfigurationType['feed']>(
        'feed',
      )!.updateDelayTime;
  }

  removeBlockedAccount = (vid: string) => {
    const today = this.getTodayDate();

    const blockedAccounts = blockedAccountsMap.get(today);
    if (Array.isArray(blockedAccounts)) {
      const newBlockedAccounts = blockedAccounts.filter((id) => id !== vid);
      blockedAccountsMap.set(today, newBlockedAccounts);
    }
  };

  private getTodayDate() {
    return dayjs.tz(new Date(), 'Asia/Shanghai').format('YYYY-MM-DD');
  }

  getBlockedAccountIds() {
    const today = this.getTodayDate();
    const disabledAccounts = blockedAccountsMap.get(today) || [];
    this.logger.debug('disabledAccounts: ', disabledAccounts);
    return disabledAccounts.filter(Boolean);
  }

  // ===== 委托给 ArticleService =====
  cleanArticleHtml = this.articleService.cleanArticleHtml.bind(this.articleService);
  localizeArticleImages = this.articleService.localizeArticleImages.bind(this.articleService);
  fetchArticleContent = this.articleService.fetchArticleContent.bind(this.articleService);
  localizeArticle = this.articleService.localizeArticle.bind(this.articleService);
  backfillMissingContent = this.articleService.backfillMissingContent.bind(this.articleService);
  htmlToText = this.articleService.htmlToText.bind(this.articleService);

  // ===== 委托给 AnalysisService =====
  extractTagsWithAI = this.analysisService.extractTagsWithAI.bind(this.analysisService);
  tagArticleWithAI = this.analysisService.tagArticleWithAI.bind(this.analysisService);
  tagAllArticlesWithAI = this.analysisService.tagAllArticlesWithAI.bind(this.analysisService);
  askDeepSeek = this.analysisService.askDeepSeek.bind(this.analysisService);
  computeRadar = this.analysisService.computeRadar.bind(this.analysisService);
  generateRadarReport = this.analysisService.generateRadarReport.bind(this.analysisService);
  generateLearningPlan = this.analysisService.generateLearningPlan.bind(this.analysisService);
  distillKnowledge = this.analysisService.distillKnowledge.bind(this.analysisService);
  listKnowledgeBase = this.analysisService.listKnowledgeBase.bind(this.analysisService);


  /**
   * 获取公众号文章（公众号后台采集）
   * @param mpId 订阅源 id（Feed 表主键）
   * @param page 页码（1 起始）
   */
  async getMpArticles(mpId: string, page = 1) {
    const feed = await this.prismaService.feed.findUnique({
      where: { id: mpId },
    });
    if (!feed?.fakerId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '该订阅源未配置公众号后台采集标识(fakeid)，请重新添加',
      });
    }
    return this.mpService.getMpArticles(feed.fakerId, page - 1);
  }

  async refreshMpArticlesAndUpdateFeed(mpId: string, page = 1) {
    // 公众号后台采集：先查订阅源的 fakeid
    const feed = await this.prismaService.feed.findUnique({
      where: { id: mpId },
    });
    if (!feed?.fakerId) {
      this.logger.error(
        `refreshMpArticlesAndUpdateFeed(${mpId}) 缺少 fakerId，请重新添加订阅源`,
      );
      return { hasHistory: 0 };
    }
    let articles: any[] = [];
    try {
      articles = await this.mpService.getMpArticles(feed.fakerId, page - 1);
    } catch (e: any) {
      this.logger.error(`refreshMpArticlesAndUpdateFeed(${mpId}) error: ${e.message}`);
      return { hasHistory: 0, rateLimited: (this.mpService as any).isRateLimited?.() === true };
    }
    const rateLimited = (this.mpService as any).isRateLimited?.() === true;

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
          data: articles.map(({ id, picUrl, publishTime, title, url, digest }) => ({
            id,
            mpId,
            picUrl,
            publishTime,
            title,
            url,
            digest,
          })),
          skipDuplicates: true,
        });
      }

      this.logger.debug(
        `refreshMpArticlesAndUpdateFeed create results: ${JSON.stringify(results)}`,
      );
    }

    // 限流/失败时：不修改 hasHistory（避免误关"获取历史文章"）
    if (!rateLimited) {
      // 公众号后台每页 5 篇，不满一页则认为没有更多历史文章
      const hasHistory = articles.length < 5 ? 0 : 1;

      await this.prismaService.feed.update({
        where: { id: mpId },
        data: {
          syncTime: Math.floor(Date.now() / 1e3),
          hasHistory,
        },
      });
      return { hasHistory, rateLimited };
    }
    return { hasHistory: 0, rateLimited };
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
      // 熔断期间：不再尝试（避免每个订阅都触发一次限流）
      if ((this.mpService as any).isRateLimited?.()) {
        break;
      }
      let info: any = null;
      // 1. 优先：取该订阅最新一篇文章，公网抓文章页反查（不耗后台额度）
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
      // 2. 兜底：无文章或反查无头像时，按公众号名搜索拿头像
      if (!info?.cover && feed.mpName) {
        try {
          const list = await this.mpService.searchBiz(feed.mpName, 1);
          const hit = list?.[0];
          if (hit) {
            info = {
              name: hit.nickname || feed.mpName,
              cover: hit.headimgurl || '',
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
    const rateLimited = (this.mpService as any).isRateLimited?.() === true;
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

  /** 上次"更新全部"时间戳 */
  lastSyncAllAt = 0;

  /** 采集同步状态（供 dashboard 展示） */
  getSyncStatus() {
    const rl = (this.mpService as any).getRateLimitInfo?.() || {
      limited: false,
      retryAfterSec: 0,
      dailyCount: 0,
      dailyLimit: 100,
      minIntervalSec: 0,
    };
    const todayTrips = (this.mpService as any).getTodayTripCount?.() || 0;
    const sinceLastMin =
      this.lastSyncAllAt > 0
        ? Math.floor((Date.now() - this.lastSyncAllAt) / 6e4)
        : null;

    // 风险分级（与真实风控数据对齐，不承诺虚假"正常"）：
    //  danger  → 熔断中 / 今日已多次触发（>=2）→ 按钮禁用，建议明天再试
    //  warn    → 今日触发过 1 次 / 距上次操作 <10 分钟 / 今日请求偏高 → 谨慎，建议等待
    //  ok      → 今日零触发 + 距上次足够久 + 请求量低
    let level: 'ok' | 'warn' | 'danger' = 'ok';
    let levelText = '正常';
    if (rl.limited || todayTrips >= 2) {
      level = 'danger';
      levelText = todayTrips >= 2
        ? `今日已触发限流 ${todayTrips} 次，接口受限，建议明天再试`
        : `限流中 · 约 ${Math.ceil((rl.retryAfterSec || 0) / 60)} 分钟后可试`;
    } else if (todayTrips >= 1 || (sinceLastMin !== null && sinceLastMin < 10)) {
      level = 'warn';
      levelText = '谨慎操作 · 建议间隔 10 分钟以上';
    }

    return {
      rateLimitRemainHours:
        (this.mpService as any).getRateLimitInfo?.().rateLimitRemainHours || 0,
      lastSyncAllAt: (this.mpService as any).getLastSyncAll?.() || 0,
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
        this.lastSyncAllAt > 0
          ? this.lastSyncAllAt +
            (todayTrips > 0 ? 30 : 10) * 60 * 1e3
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
        // 限流：立即停止翻页，避免继续触发
        if (result.rateLimited) {
          this.logger.warn(`getHistoryMpArticles(${mpId}) 触发限流，停止翻页`);
          break;
        }
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
    let rateLimited = false;
    await (this.mpService as any).setLastSyncAll?.(Date.now());
    try {
      for (const { id } of mps) {
        // 熔断期间：立即停止，不再遍历剩余订阅
        if ((this.mpService as any).isRateLimited?.()) {
          rateLimited = true;
          this.logger.warn('更新全部：接口熔断中，提前停止');
          break;
        }
        const r = await this.refreshMpArticlesAndUpdateFeed(id);
        if (r.rateLimited) {
          rateLimited = true;
          break;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, this.updateDelayTime * 1e3),
        );
      }
    } finally {
      this.isRefreshAllMpArticlesRunning = false;
    }
    return { rateLimited };
  }

  async getMpInfo(url: string) {
    url = url.trim();
    return this.mpService.getMpInfo(url);
  }

  async createLoginUrl() {
    return this.mpService.createLoginUrl();
  }

  async getLoginResult(id: string) {
    return this.mpService.getLoginResult(id);
  }

  /** 搜索公众号（公众号后台） */
  async searchBiz(keyword: string) {
    return this.mpService.searchBiz(keyword);
  }
}
