import { INestApplication, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { TrpcService } from '@server/trpc/trpc.service';
import * as trpcExpress from '@trpc/server/adapters/express';
import { TRPCError } from '@trpc/server';
import { PrismaService } from '@server/prisma/prisma.service';
import { statusMap } from '@server/constants';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';
import { CryptoService } from '@server/crypto/crypto.service';
import { isWeixinArticleUrl } from '@server/common/url-security';

@Injectable()
export class TrpcRouter {
  constructor(
    private readonly trpcService: TrpcService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly cryptoService: CryptoService,
  ) {}

  private readonly logger = new Logger(this.constructor.name);

  accountRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(1000).nullish(),
          cursor: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 1000;
        const { cursor } = input;
        const pipeline = this.trpcService.getActivePipeline();

        const items = await this.prismaService.account.findMany({
          take: limit + 1,
          where: { pipeline },
          select: {
            id: true,
            name: true,
            status: true,
            pipeline: true,
            createdAt: true,
            updatedAt: true,
            token: false,
          },
          cursor: cursor
            ? {
                id: cursor,
              }
            : undefined,
          orderBy: {
            createdAt: 'asc',
          },
        });
        let nextCursor: typeof cursor | undefined = undefined;
        if (items.length > limit) {
          // Remove the last item and use it as next cursor

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const nextItem = items.pop()!;
          nextCursor = nextItem.id;
        }

        const disabledAccounts = this.trpcService.getBlockedAccountIds();
        return {
          blocks: disabledAccounts,
          items,
          nextCursor,
        };
      }),
    byId: this.trpcService.protectedProcedure
      .input(z.string())
      .query(async ({ input: id }) => {
        const pipeline = this.trpcService.getActivePipeline();
        const account = await this.prismaService.account.findUnique({
          where: { id, pipeline },
          select: {
            id: true,
            name: true,
            status: true,
            pipeline: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        if (!account) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No account with id '${id}'`,
          });
        }
        return account;
      }),
    add: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string().min(1).max(32),
          token: z.string().min(1),
          name: z.string().min(1),
          status: z.number().default(statusMap.ENABLE),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const pipeline = this.trpcService.getActivePipeline();
        const existing = await this.prismaService.account.findUnique({
          where: { id },
          select: { pipeline: true },
        });
        if (existing && existing.pipeline !== pipeline) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `该账号已归属方案${existing.pipeline}，不能改绑到方案${pipeline}`,
          });
        }
        const encryptedToken = this.cryptoService.encrypt(data.token);
        const account = await this.prismaService.account.upsert({
          where: {
            id,
          },
          update:
            pipeline === 2
              ? { name: data.name, status: data.status, pipeline }
              : { ...data, token: encryptedToken, pipeline },
          create: { ...input, token: encryptedToken, pipeline },
          select: {
            id: true,
            name: true,
            status: true,
            pipeline: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        this.trpcService.removeBlockedAccount(id);

        return account;
      }),
    edit: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          data: z.object({
            token: z.string().min(1).optional(),
            name: z.string().min(1).optional(),
            status: z.number().optional(),
          }),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, data } = input;
        const pipeline = this.trpcService.getActivePipeline();
        const safeData = {
          ...data,
          ...(data.token
            ? { token: this.cryptoService.encrypt(data.token) }
            : {}),
        };
        const account = await this.prismaService.account.update({
          where: { id, pipeline },
          data: safeData,
          select: {
            id: true,
            name: true,
            status: true,
            pipeline: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        this.trpcService.removeBlockedAccount(id);
        return account;
      }),
    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        const pipeline = this.trpcService.getActivePipeline();
        await this.prismaService.account.delete({ where: { id, pipeline } });
        this.trpcService.removeBlockedAccount(id);

        return id;
      }),
  });

  feedRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(1000).nullish(),
          cursor: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 1000;
        const { cursor } = input;

        const items = await this.prismaService.feed.findMany({
          take: limit + 1,
          where: {},
          cursor: cursor
            ? {
                id: cursor,
              }
            : undefined,
          orderBy: {
            createdAt: 'asc',
          },
        });
        let nextCursor: typeof cursor | undefined = undefined;
        if (items.length > limit) {
          // Remove the last item and use it as next cursor

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const nextItem = items.pop()!;
          nextCursor = nextItem.id;
        }

        return {
          items: items,
          nextCursor,
        };
      }),
    byId: this.trpcService.protectedProcedure
      .input(z.string())
      .query(async ({ input: id }) => {
        const feed = await this.prismaService.feed.findUnique({
          where: { id },
        });
        if (!feed) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No feed with id '${id}'`,
          });
        }
        return feed;
      }),
    add: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          mpName: z.string(),
          mpCover: z.string().optional().default(''),
          mpIntro: z.string().optional().default(''),
          fakerId: z.string().nullish(),
          syncTime: z
            .number()
            .optional()
            .default(Math.floor(Date.now() / 1e3)),
          updateTime: z.number(),
          status: z.number().default(statusMap.ENABLE),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const feed = await this.prismaService.feed.upsert({
          where: {
            id,
          },
          update: data,
          create: input,
        });

        return feed;
      }),
    edit: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          data: z.object({
            mpName: z.string().optional(),
            mpCover: z.string().optional(),
            mpIntro: z.string().optional(),
            syncTime: z.number().optional(),
            updateTime: z.number().optional(),
            status: z.number().optional(),
          }),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, data } = input;
        const feed = await this.prismaService.feed.update({
          where: { id },
          data,
        });
        return feed;
      }),
    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        await this.prismaService.feed.delete({ where: { id } });
        return id;
      }),

    refreshArticles: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().optional(),
        }),
      )
      .mutation(async ({ input: { mpId } }) => {
        if (mpId) {
          return this.trpcService.refreshMpArticlesAndUpdateFeed(mpId);
        }
        return this.trpcService.refreshAllMpArticlesAndUpdateFeed();
      }),

    isRefreshAllMpArticlesRunning: this.trpcService.protectedProcedure.query(
      async () => {
        return this.trpcService.isRefreshAllMpArticlesRunning;
      },
    ),
    cleanupOrphans: this.trpcService.protectedProcedure.mutation(async () => {
      return this.trpcService.cleanupOrphanArticles();
    }),
    syncMpAvatars: this.trpcService.protectedProcedure.mutation(async () => {
      return this.trpcService.syncAllMpAvatars();
    }),
    getHistoryArticles: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().optional(),
        }),
      )
      .mutation(async ({ input: { mpId = '' } }) => {
        await this.trpcService.getHistoryMpArticles(mpId);
        return { ok: true };
      }),
    getInProgressHistoryMp: this.trpcService.protectedProcedure.query(
      async () => {
        return this.trpcService.inProgressHistoryMp;
      },
    ),
  });

  articleRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(1000).nullish(),
          cursor: z.string().nullish(),
          page: z.number().min(1).nullish(),
          mpId: z.string().nullish(),
          keyword: z.string().nullish(),
          isFavorite: z.boolean().nullish(),
          startTime: z.number().nullish(),
          endTime: z.number().nullish(),
          tagId: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 1000;
        const {
          cursor,
          page,
          mpId,
          keyword,
          isFavorite,
          startTime,
          endTime,
          tagId,
        } = input;

        // 动态构建筛选条件
        const where: any = { status: 1 };
        if (mpId) where.mpId = mpId;
        if (keyword) {
          // 优先使用 FTS5 全文搜索（大幅提升中大型库搜索性能）
          try {
            const ftsIds = await this.prismaService.$queryRawUnsafe<
              { rowid: number }[]
            >(
              `SELECT rowid FROM articles_fts WHERE articles_fts MATCH ? LIMIT 500`,
              `"${keyword.replace(/"/g, '""')}"`,
            );
            if (ftsIds.length > 0) {
              // FTS 命中：按 rowid IN 过滤（SQLite 无 id 字段，用 rowid 映射）
              // 注意：不要 LIMIT 截断 id 集合，否则 total 偏小且后续页无数据
              const ftsMatchedIds = ftsIds.map((r) => r.rowid);
              const matched = await this.prismaService.$queryRawUnsafe<
                { id: string }[]
              >(
                `SELECT id FROM articles WHERE rowid IN (${ftsMatchedIds.join(',')}) AND status = 1`,
              );
              const ids = matched.map((m) => m.id);
              // 合并 FTS 结果到筛选条件
              where.id = { in: ids };
              // 不设置 OR（已被 ID 过滤替代）
            } else {
              // FTS 无结果，降级到 LIKE
              where.OR = [
                { title: { contains: keyword } },
                { contentText: { contains: keyword } },
                { digest: { contains: keyword } },
              ];
            }
          } catch {
            // FTS 不可用（表不存在等），降级到 LIKE
            where.OR = [
              { title: { contains: keyword } },
              { contentText: { contains: keyword } },
              { digest: { contains: keyword } },
            ];
          }
        }
        if (isFavorite !== undefined && isFavorite !== null) {
          where.isFavorite = isFavorite;
        }
        if (startTime || endTime) {
          where.publishTime = {};
          if (startTime) where.publishTime.gte = startTime;
          if (endTime) where.publishTime.lte = endTime;
        }
        if (tagId) where.tags = { some: { tagId } };

        // 传统分页模式（page 传入时）：skip/take + 返回总数
        const isPageMode = !!page && page > 0;
        let items: any[] = [];
        let nextCursor: typeof cursor | undefined = undefined;
        let total = 0;

        if (isPageMode) {
          total = await this.prismaService.article.count({ where });
          items = await this.prismaService.article.findMany({
            orderBy: [{ publishTime: 'desc' }],
            skip: (page! - 1) * limit,
            take: limit,
            where,
            include: { tags: { include: { tag: true } } },
          });
        } else {
          items = await this.prismaService.article.findMany({
            orderBy: [{ publishTime: 'desc' }],
            take: limit + 1,
            where,
            include: { tags: { include: { tag: true } } },
            cursor: cursor ? { id: cursor } : undefined,
          });
          if (items.length > limit) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const nextItem = items.pop()!;
            nextCursor = nextItem.id;
          }
        }

        // 拍平 tags 关联
        const flat = items.map(({ tags, ...rest }) => ({
          ...rest,
          tags: tags.map((t) => t.tag),
        }));

        return {
          items: flat,
          nextCursor,
          total,
          pageSize: isPageMode ? limit : 0,
        };
      }),
    byId: this.trpcService.protectedProcedure
      .input(z.string())
      .query(async ({ input: id }) => {
        const article = await this.prismaService.article.findUnique({
          where: { id },
        });
        if (!article) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No article with id '${id}'`,
          });
        }
        return article;
      }),

    add: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          mpId: z.string(),
          title: z.string(),
          picUrl: z.string().optional().default(''),
          publishTime: z.number(),
          url: z.string().optional(),
          digest: z.string().optional(),
          content: z.string().optional(),
          contentText: z.string().optional(),
          isFavorite: z.boolean().optional(),
          status: z.number().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const article = await this.prismaService.article.upsert({
          where: {
            id,
          },
          update: data,
          create: input,
        });

        return article;
      }),
    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        await this.prismaService.article.delete({ where: { id } });
        return id;
      }),

    // ===== WeRSS 扩展：收藏 =====
    favorite: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          isFavorite: z.boolean(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, isFavorite } = input;
        return this.prismaService.article.update({
          where: { id },
          data: {
            isFavorite,
            favoriteTime: isFavorite ? new Date() : null,
          },
        });
      }),

    // ===== WeRSS 扩展：单篇补全正文 =====
    fetchContent: this.trpcService.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input: { id } }) => {
        const content = await this.trpcService.fetchArticleContent(id);
        return { id, content };
      }),

    // ===== WeRSS 扩展：已有正文图片本地化 =====
    localizeImages: this.trpcService.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input: { id } }) => {
        return this.trpcService.localizeArticle(id);
      }),

    // ===== WeRSS 扩展：批量补全缺失正文 =====
    backfillContent: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(200).optional().default(20),
          delayMs: z.number().min(200).max(10000).optional().default(1500),
        }),
      )
      .mutation(async ({ input }) => {
        return this.trpcService.backfillMissingContent(
          input.limit,
          input.delayMs,
        );
      }),

    // ===== WeRSS 扩展：设置文章标签（按名称，不存在自动创建） =====
    setTags: this.trpcService.protectedProcedure
      .input(
        z.object({
          articleId: z.string(),
          tagNames: z.array(z.string().min(1)).max(20),
        }),
      )
      .mutation(async ({ input }) => {
        const { articleId, tagNames } = input;
        // 1. 清空现有关联
        await this.prismaService.articleTag.deleteMany({
          where: { articleId },
        });
        // 2. 逐标签 upsert 并建立关联
        const tags: { id: string; name: string }[] = [];
        for (const name of tagNames) {
          const tag = await this.prismaService.tag.upsert({
            where: { name },
            update: {},
            create: { name },
          });
          tags.push(tag);
        }
        await this.prismaService.$transaction(
          tags.map((tag) =>
            this.prismaService.articleTag.upsert({
              where: {
                articleId_tagId: { articleId, tagId: tag.id },
              },
              update: {},
              create: { articleId, tagId: tag.id },
            }),
          ),
        );
        return { articleId, tags };
      }),

    // 基于标签相似度的文章推荐（共享标签数降序）
    related: this.trpcService.protectedProcedure
      .input(
        z.object({
          articleId: z.string(),
          limit: z.number().min(1).max(10).optional().default(5),
        }),
      )
      .query(async ({ input }) => {
        const { articleId, limit } = input;

        const currentTags = await this.prismaService.articleTag.findMany({
          where: { articleId },
          select: { tagId: true },
        });
        const currentTagIds = currentTags.map((t) => t.tagId);
        if (currentTagIds.length === 0) return [];

        const placeholders = currentTagIds.map(() => '?').join(',');
        const rows = await this.prismaService.$queryRawUnsafe<
          { article_id: string; shared: number }[]
        >(
          `SELECT at2.article_id, COUNT(DISTINCT at2.tag_id) AS shared
           FROM article_tags at2
           WHERE at2.tag_id IN (${placeholders})
             AND at2.article_id != ?
           GROUP BY at2.article_id
           ORDER BY shared DESC
           LIMIT ?`,
          ...currentTagIds,
          articleId,
          limit,
        );

        if (rows.length === 0) return [];

        const ids = rows.map((r) => r.article_id);
        // SQLite 下 COUNT() 返回 BigInt，必须转 number（否则 sort 比较器抛 TypeError）
        const scores = new Map(
          rows.map((r) => [r.article_id, Number(r.shared)]),
        );

        const articles = await this.prismaService.article.findMany({
          where: { id: { in: ids }, status: 1 },
          select: {
            id: true,
            title: true,
            mpId: true,
            tags: { include: { tag: true } },
          },
        });

        return articles
          .map(({ tags, ...rest }) => ({
            ...rest,
            tags: tags.map((t) => t.tag),
            score: scores.get(rest.id) ?? 0,
          }))
          .sort((a, b) => b.score - a.score);
      }),
  });

  platformRouter = this.trpcService.router({
    pipeline: this.trpcService.protectedProcedure.query(async () => {
      return this.trpcService.getPipelineInfo();
    }),
    switchPipeline: this.trpcService.protectedProcedure
      .input(z.object({ pipeline: z.union([z.literal(1), z.literal(2)]) }))
      .mutation(async ({ input }) => {
        return this.trpcService.switchPipeline(input.pipeline);
      }),
    getMpArticles: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string(),
        }),
      )
      .mutation(async ({ input: { mpId } }) => {
        try {
          const results = await this.trpcService.getMpArticles(mpId);
          return results;
        } catch (err: any) {
          this.logger.log('getMpArticles err: ', err);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: err.response?.data?.message || err.message,
          });
        }
      }),
    getMpInfo: this.trpcService.protectedProcedure
      .input(
        z.object({
          wxsLink: z.string().refine(isWeixinArticleUrl, {
            message: '请输入有效的微信公众号文章链接',
          }),
        }),
      )
      .mutation(async ({ input: { wxsLink: url } }) => {
        try {
          const results = await this.trpcService.getMpInfo(url);
          return results;
        } catch (err: any) {
          this.logger.log('getMpInfo err: ', err);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: err.response?.data?.message || err.message,
          });
        }
      }),

    createLoginUrl: this.trpcService.protectedProcedure.mutation(async () => {
      return this.trpcService.createLoginUrl();
    }),
    getLoginResult: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
        }),
      )
      .query(async ({ input }) => {
        return this.trpcService.getLoginResult(input.id);
      }),
    // 公众号后台：按关键词搜索公众号（返回 fakeid 等）
    syncStatus: this.trpcService.protectedProcedure.query(async () => {
      return this.trpcService.getSyncStatus();
    }),
    searchBiz: this.trpcService.protectedProcedure
      .input(
        z.object({
          keyword: z.string().min(1).max(50),
        }),
      )
      .mutation(async ({ input }) => {
        return this.trpcService.searchBiz(input.keyword);
      }),
  });

  // ===== WeRSS 扩展：标签路由（步骤3） =====
  tagRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure.query(async () => {
      const tags = await this.prismaService.tag.findMany({
        include: { _count: { select: { articles: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return tags.map(({ _count, ...t }) => ({
        ...t,
        articleCount: _count.articles,
      }));
    }),

    create: this.trpcService.protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(50),
          category: z.string().max(50).nullish(),
        }),
      )
      .mutation(async ({ input }) => {
        const { name, category } = input;
        return this.prismaService.tag.upsert({
          where: { name },
          update: category ? { category } : {},
          create: { name, category },
        });
      }),

    rename: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(50),
        }),
      )
      .mutation(async ({ input }) => {
        return this.prismaService.tag.update({
          where: { id: input.id },
          data: { name: input.name },
        });
      }),

    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        await this.prismaService.tag.delete({ where: { id } });
        return id;
      }),

    // 标签统计（雷达分析数据源）
    stats: this.trpcService.protectedProcedure.query(async () => {
      const [groups, tags] = await Promise.all([
        this.prismaService.articleTag.groupBy({
          by: ['tagId'],
          _count: { _all: true },
        }),
        this.prismaService.tag.findMany(),
      ]);
      const tagMap = new Map(tags.map((t) => [t.id, t]));
      return groups
        .map((g) => ({
          tagId: g.tagId,
          name: tagMap.get(g.tagId)?.name || g.tagId,
          category: tagMap.get(g.tagId)?.category || '',
          articleCount: g._count._all,
        }))
        .sort((a, b) => b.articleCount - a.articleCount);
    }),

    // ===== WeRSS 扩展：AI 标签提取 =====
    // 单篇：AI 提取标签 + 领域归因并入库
    extractArticle: this.trpcService.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input: { id } }) => {
        return this.trpcService.tagArticleWithAI(id);
      }),
    // 批量：给无标签文章自动打标签（串行 + 节流）
    extractAll: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).optional().default(20),
          delayMs: z.number().min(1000).max(30000).optional().default(3000),
        }),
      )
      .mutation(async ({ input }) => {
        return this.trpcService.tagAllArticlesWithAI(
          input.limit,
          input.delayMs,
        );
      }),
  });

  // ===== WeRSS 扩展：雷达分析与学习计划（步骤4） =====
  analysisRouter = this.trpcService.router({
    // 计算关注领域雷达
    radar: this.trpcService.protectedProcedure.query(async () => {
      return this.trpcService.computeRadar();
    }),
    // 生成雷达分析报告（含雷达数据）
    report: this.trpcService.protectedProcedure.mutation(async () => {
      return this.trpcService.generateRadarReport();
    }),
    // 生成学习计划并入库
    learningPlan: this.trpcService.protectedProcedure.mutation(async () => {
      return this.trpcService.generateLearningPlan();
    }),
    // 历史学习计划列表
    plans: this.trpcService.protectedProcedure.query(async () => {
      return this.prismaService.learningPlan.findMany({
        orderBy: { createdAt: 'desc' },
      });
    }),
    // 最新分析报告（持久化恢复用）
    distill: this.trpcService.protectedProcedure.mutation(async () => {
      return this.trpcService.distillKnowledge();
    }),
    knowledgeList: this.trpcService.protectedProcedure.query(async () => {
      return this.trpcService.listKnowledgeBase();
    }),
    latestReport: this.trpcService.protectedProcedure.query(async () => {
      return this.prismaService.analysisReport.findFirst({
        orderBy: { createdAt: 'desc' },
      });
    }),
    // 历史报告列表
    reports: this.trpcService.protectedProcedure.query(async () => {
      return this.prismaService.analysisReport.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    }),
    // 热点主题洞察：近期多源同题聚类
    hotTopics: this.trpcService.protectedProcedure
      .input(
        z.object({
          days: z.number().min(1).max(60).optional().default(14),
          limit: z.number().min(1).max(20).optional().default(5),
        }),
      )
      .query(async ({ input }) => {
        return this.trpcService.collectHotTopics(input.days, input.limit);
      }),
    // 热点主题深度拆解
    analyzeTopic: this.trpcService.protectedProcedure
      .input(z.object({ tag: z.string().min(1).max(50) }))
      .mutation(async ({ input }) => {
        return this.trpcService.analyzeHotTopic(input.tag);
      }),
  });

  appRouter = this.trpcService.router({
    feed: this.feedRouter,
    account: this.accountRouter,
    article: this.articleRouter,
    platform: this.platformRouter,
    tag: this.tagRouter,
    analysis: this.analysisRouter,
  });

  // 认证失败计数器（内存，防暴力破解）
  private readonly authFailures = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly AUTH_MAX_FAIL = 20;
  private readonly AUTH_WINDOW_MS = 5 * 60 * 1e3; // 5 分钟窗口

  async applyMiddleware(app: INestApplication) {
    app.use(
      `/trpc`,
      trpcExpress.createExpressMiddleware({
        router: this.appRouter,
        createContext: ({ req }) => {
          const authCode =
            this.configService.get<ConfigurationType['auth']>('auth')!.code;

          if (authCode && req.headers.authorization !== authCode) {
            const clientId = req.socket.remoteAddress || 'unknown';
            const now = Date.now();
            const previous = this.authFailures.get(clientId);
            const state =
              !previous || now >= previous.resetAt
                ? { count: 1, resetAt: now + this.AUTH_WINDOW_MS }
                : { ...previous, count: previous.count + 1 };
            this.authFailures.set(clientId, state);
            if (state.count > this.AUTH_MAX_FAIL) {
              this.logger.warn(`客户端认证失败次数过多，已暂时限制请求`);
              return {
                errorMsg: '认证尝试过多，请稍后再试',
                rateLimited: true,
              };
            }
            return {
              errorMsg: 'authCode不正确！',
            };
          }
          return {
            errorMsg: null,
            rateLimited: false,
          };
        },
        middleware: (req, res, next) => {
          next();
        },
      }),
    );
  }
}

export type AppRouter = TrpcRouter[`appRouter`];
