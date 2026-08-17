jest.mock('axios-cookiejar-support', () => ({ wrapper: jest.fn() }));

import { TrpcService } from './trpc.service';

describe('TrpcService pipeline routing', () => {
  const prisma = {
    feed: { findUnique: jest.fn(), update: jest.fn() },
    account: { count: jest.fn(async () => 1) },
    article: { upsert: jest.fn() },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'feed') return { updateDelayTime: 0 };
      if (key === 'platform') return { url: 'https://example.xyz' };
      return {};
    }),
  };
  const mp = {
    getActivePipeline: jest.fn(),
    setActivePipeline: jest.fn(),
    getMpArticles: jest.fn(),
    getRateLimitInfo: jest.fn(() => ({
      limited: false,
      retryAfterSec: 0,
      rateLimitRemainHours: 0,
      dailyCount: 0,
      dailyLimit: 100,
      throttledSec: 0,
      minIntervalSec: 0,
    })),
    getTodayTripCount: jest.fn(() => 0),
    getLastSyncAll: jest.fn(() => 0),
  };
  const weread = {
    getMpArticles: jest.fn(),
    removeBlockedAccount: jest.fn(),
    getBlockedAccountIds: jest.fn(() => []),
    getStatus: jest.fn(async () => ({
      enabledCount: 1,
      availableCount: 1,
      blockedCount: 0,
      limited: false,
      ready: true,
    })),
  };
  const article = {
    cleanArticleHtml: jest.fn(),
    localizeArticleImages: jest.fn(),
    fetchArticleContent: jest.fn(),
    localizeArticle: jest.fn(),
    backfillMissingContent: jest.fn(),
    htmlToText: jest.fn(),
  };
  const analysis = {
    extractTagsWithAI: jest.fn(),
    tagArticleWithAI: jest.fn(),
    tagAllArticlesWithAI: jest.fn(),
    askDeepSeek: jest.fn(),
    computeRadar: jest.fn(),
    generateRadarReport: jest.fn(),
    generateLearningPlan: jest.fn(),
    distillKnowledge: jest.fn(),
    listKnowledgeBase: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
  };

  let service: TrpcService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TrpcService(
      prisma as any,
      config as any,
      mp as any,
      weread as any,
      article as any,
      analysis as any,
      events as any,
    );
  });

  it('方案1使用 Feed.id 调用 .xyz 管线', async () => {
    mp.getActivePipeline.mockReturnValue(1);
    weread.getMpArticles.mockResolvedValue([{ id: 'a1' }]);

    await expect(service.getMpArticles('MP_WXS_1', 3)).resolves.toEqual([
      { id: 'a1' },
    ]);
    expect(weread.getMpArticles).toHaveBeenCalledWith('MP_WXS_1', 3);
    expect(mp.getMpArticles).not.toHaveBeenCalled();
  });

  it('方案2使用 Feed.fakerId 调用自有管线并转换页码', async () => {
    mp.getActivePipeline.mockReturnValue(2);
    prisma.feed.findUnique.mockResolvedValue({ fakerId: 'MzFake==' });
    mp.getMpArticles.mockResolvedValue([{ id: 'a2' }]);

    await expect(service.getMpArticles('MP_WXS_2', 3)).resolves.toEqual([
      { id: 'a2' },
    ]);
    expect(mp.getMpArticles).toHaveBeenCalledWith('MzFake==', 2);
    expect(weread.getMpArticles).not.toHaveBeenCalled();
  });

  it('方案2缺少 fakeid 时明确失败', async () => {
    mp.getActivePipeline.mockReturnValue(2);
    prisma.feed.findUnique.mockResolvedValue({ fakerId: null });

    await expect(service.getMpArticles('MP_WXS_3', 1)).rejects.toThrow(
      '缺少方案2所需的 fakeid',
    );
  });

  it('空闲时持久化切换方案', async () => {
    mp.getActivePipeline.mockReturnValue(2);
    await service.switchPipeline(2);
    expect(mp.setActivePipeline).toHaveBeenCalledWith(2);
  });

  it('入库后逐篇 emit article:upserted（SSE 实时推送）', async () => {
    mp.getActivePipeline.mockReturnValue(1);
    weread.getMpArticles.mockResolvedValue([
      { id: 'a1', picUrl: '', publishTime: 1, title: 't1', url: '', digest: '' },
      { id: 'a2', picUrl: '', publishTime: 2, title: 't2', url: '', digest: '' },
    ]);
    prisma.feed.findUnique.mockResolvedValue({ id: 'MP_1', fakerId: null });
    prisma.article.upsert.mockImplementation(async ({ create }: any) => create);
    prisma.$transaction.mockImplementation(async (ops: any[]) =>
      Promise.all(ops),
    );
    prisma.feed.update.mockResolvedValue({});
    config.get.mockImplementation((key: string) => {
      if (key === 'feed') return { updateDelayTime: 0 };
      if (key === 'platform') return { url: 'https://example.xyz' };
      if (key === 'database') return { type: 'sqlite' };
      return {};
    });

    await service.refreshMpArticlesAndUpdateFeed('MP_1');

    expect(events.emit).toHaveBeenCalledWith({
      type: 'article:upserted',
      data: expect.objectContaining({ id: 'a1', title: 't1', mpId: 'MP_1' }),
    });
    expect(events.emit).toHaveBeenCalledWith({
      type: 'article:upserted',
      data: expect.objectContaining({ id: 'a2', title: 't2', mpId: 'MP_1' }),
    });
  });
});
